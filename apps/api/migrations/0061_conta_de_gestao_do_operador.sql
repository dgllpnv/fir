-- ===========================================================================
-- D-23 ITEM 6 — UM LOGIN SÓ PARA A FIRMARE: A CONTA DE GESTÃO DO OPERADOR.
-- ADR 0024 (substitui a parte de "nenhum dinheiro atravessa o painel" da
-- ADR 0011 para o superadmin).
--
-- Todo `Operador` tem, automaticamente, UMA `Conta de gestão do operador`: um
-- `Usuário de Gestão` do Grupo Firmare (`escopo='geral'`), perfil Diretoria
-- (todas as telas, `valores`, `carteira.todos`, `carteira.administrar`), SEM
-- senha própria. Ele nunca entra por `/carteira/entrar`: a sessão dele nasce
-- do login do painel (`PainelService.entrar`) e morre com a saída do painel.
--
-- Forward-only, EXPAND puro: uma tabela nova, funções e gatilhos novos.
-- Nenhuma coluna existente muda.
--
-- ## Por que o vínculo é provisionado NO BANCO, por gatilho
--
-- Operador nasce por dois caminhos, e nenhum é código da API: o break-glass
-- da VPS (`infra/producao/redefinir-superadmin.sh`, `psql` como `fir`) e o
-- `INSERT` direto dos testes. Provisionar na aplicação deixaria o primeiro
-- operador de cada ambiente SEM conta — justamente o `firmare.admin` de
-- produção. O gatilho `AFTER INSERT ON operadores` cobre os dois, na mesma
-- transação que cria o operador: ou nascem juntos, ou nenhum nasce.
--
-- ## F-1 continua valendo (identidade só pelo painel)
--
-- `fir_carteira` — o papel da sessão que a conta usa — só LÊ o vínculo. A
-- escrita é de funções `SECURITY DEFINER` deste arquivo, disparadas pela
-- escrita em `operadores`, que é identidade do painel (`fir_painel` ou o
-- break-glass). Ninguém recebe INSERT/UPDATE/DELETE no vínculo.
--
-- ## O perfil é FIXO enquanto o vínculo existir
--
-- Um gatilho `BEFORE UPDATE ON usuarios_gestao` recusa, para a conta
-- vinculada, qualquer mudança de privilégio (escopo, grupo, valores,
-- carteira, módulos, administrar), de senha, e `ativo` diferente do
-- `ativo` do operador. Sem isso, a tela de usuários de gestão rebaixaria a
-- conta do superadmin para um grupo com um clique — ou daria a ela uma
-- senha provisória, e a conta sem senha passaria a entrar pela porta da
-- carteira, contornando o painel (allowlist de IP, ADR 0008). A recusa usa
-- `check_violation` com a constraint `conta_de_gestao_do_operador_fixa`,
-- para a API poder traduzir para 409 sem casar texto.
--
-- ## A senha que não existe
--
-- `senha_hash` é NOT NULL (0025). A conta recebe um hash Argon2id BEM
-- FORMADO de bytes aleatórios: não é hash de senha nenhuma, então nenhuma
-- senha confere — e o login da carteira roda o Argon2 inteiro, como para
-- qualquer outra conta (sem caminho rápido que o relógio denuncie, e sem o
-- log de "conferirSenha falhou" que um texto inválido dispararia). O gatilho
-- acima impede que alguém lhe dê uma senha depois.
--
-- ## Módulos
--
-- A lista das nove telas é a do CHECK da 0050. A migration que acrescentar
-- uma tela nova precisa acrescentá-la também às contas vinculadas e a
-- `conta_de_gestao_do_operador_fixa()` (CREATE OR REPLACE) — senão a conta
-- do superadmin fica sem a tela nova, e o gatilho recusa a correção.
-- ===========================================================================

CREATE TABLE contas_de_gestao_do_operador (
  operador_id       uuid NOT NULL UNIQUE REFERENCES operadores(id) ON DELETE CASCADE,
  usuario_gestao_id uuid NOT NULL UNIQUE REFERENCES usuarios_gestao(id),
  criada_em         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (operador_id, usuario_gestao_id)
);

COMMENT ON TABLE contas_de_gestao_do_operador IS
  'D-23 item 6, ADR 0024: o Operador e a sua Conta de gestão (Usuário de Gestão '
  'do Grupo Firmare, escopo geral, perfil Diretoria, sem senha própria). Um para '
  'um, nos dois lados. Escrita só pelas funções SECURITY DEFINER da 0061.';

-- O bootstrap dá DML a `fir_app` em toda tabela nova (ver
-- `teste/escrita-sem-rls.test.ts`): tirar primeiro, conceder linha a linha.
REVOKE ALL ON contas_de_gestao_do_operador FROM fir_app;
GRANT SELECT ON contas_de_gestao_do_operador TO fir_painel;
GRANT SELECT ON contas_de_gestao_do_operador TO fir_carteira;

-- As nove telas, num lugar só deste arquivo.
CREATE FUNCTION modulos_da_conta_do_operador() RETURNS text[]
  LANGUAGE sql IMMUTABLE AS $$
  SELECT ARRAY['painel','rotina','clientes','firclinic','metas','campanhas','resumo','prospeccao','cadastros']::text[]
$$;

-- Um hash Argon2id bem formado de bytes aleatórios (formato PHC, base64 sem
-- `=`). Os parâmetros são os de `apps/api/src/autenticacao/senha.ts`.
CREATE FUNCTION hash_sem_senha() RETURNS text
  LANGUAGE sql VOLATILE SET search_path = pg_catalog, public AS $$
  SELECT '$argon2id$v=19$m=19456,t=2,p=1$'
         || rtrim(encode(gen_random_bytes(16), 'base64'), '=')
         || '$'
         || rtrim(encode(gen_random_bytes(32), 'base64'), '=')
$$;

-- ---------------------------------------------------------------------------
-- O PROVISIONAMENTO. Idempotente: com o vínculo já feito, devolve o que há.
-- ---------------------------------------------------------------------------
CREATE FUNCTION provisionar_conta_de_gestao_do_operador(p_operador uuid) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_existente uuid;
  v_usuario   text;
  v_nome      text;
  v_ativo     boolean;
  v_candidato text;
  v_id        uuid;
  i           integer := 0;
BEGIN
  SELECT usuario_gestao_id INTO v_existente
    FROM contas_de_gestao_do_operador WHERE operador_id = p_operador;
  IF v_existente IS NOT NULL THEN
    RETURN v_existente;
  END IF;

  SELECT usuario, nome, ativo INTO v_usuario, v_nome, v_ativo
    FROM operadores WHERE id = p_operador;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'operador % não existe', p_operador;
  END IF;

  -- O usuário de gestão leva o MESMO nome de usuário do operador. Se ele já
  -- é de outra pessoa da carteira, `.op1`, `.op2`… — nunca toma a conta
  -- alheia. Os dois formatos satisfazem `usuarios_gestao_usuario_canonico`.
  LOOP
    v_candidato := CASE
      WHEN i = 0 THEN v_usuario
      ELSE rtrim(left(v_usuario, 32 - length('.op' || i)), '._-') || '.op' || i
    END;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM usuarios_gestao WHERE usuario = v_candidato);
    i := i + 1;
  END LOOP;

  INSERT INTO usuarios_gestao
    (usuario, nome, senha_hash, escopo, grupo_id, ativo,
     valores, carteira, modulos, administrar, setor)
  VALUES
    (v_candidato, v_nome, hash_sem_senha(), 'geral', NULL, v_ativo,
     true, 'todos', modulos_da_conta_do_operador(), true, 'diretoria')
  RETURNING id INTO v_id;

  INSERT INTO contas_de_gestao_do_operador (operador_id, usuario_gestao_id)
  VALUES (p_operador, v_id);

  -- Identidade fora de clínica: trilha do painel. `sistema`, porque quem
  -- provisiona é a regra, não uma pessoa — a pessoa que criou o operador já
  -- está na linha dela (`vps` ou `operador`).
  INSERT INTO auditoria_do_painel (ator_tipo, ator_id, acao, entidade, entidade_id, para, motivo)
  VALUES ('sistema', NULL, 'criou', 'usuarios_gestao', v_id::text,
          auditoria_sem_segredos(jsonb_build_object(
            'operador_id', p_operador, 'usuario', v_candidato, 'escopo', 'geral',
            'valores', true, 'administrar', true, 'ativo', v_ativo)),
          'conta de gestão do operador (D-23, ADR 0024)');

  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION provisionar_conta_de_gestao_do_operador(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION hash_sem_senha() FROM PUBLIC;

CREATE FUNCTION operador_provisiona_conta_de_gestao() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  PERFORM provisionar_conta_de_gestao_do_operador(NEW.id);
  RETURN NULL;
END $$;

CREATE TRIGGER operador_provisiona_conta_de_gestao
  AFTER INSERT ON operadores
  FOR EACH ROW EXECUTE FUNCTION operador_provisiona_conta_de_gestao();

-- ---------------------------------------------------------------------------
-- DESATIVAR O OPERADOR DESATIVA A CONTA — e derruba as sessões dela agora.
-- Reativar (o break-glass reativa) reativa. O nome acompanha.
-- ---------------------------------------------------------------------------
CREATE FUNCTION operador_sincroniza_conta_de_gestao() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_conta uuid;
  v_antes boolean;
BEGIN
  SELECT c.usuario_gestao_id, u.ativo INTO v_conta, v_antes
    FROM contas_de_gestao_do_operador c JOIN usuarios_gestao u ON u.id = c.usuario_gestao_id
   WHERE c.operador_id = NEW.id;
  IF v_conta IS NULL THEN
    RETURN NULL;
  END IF;

  UPDATE usuarios_gestao SET ativo = NEW.ativo, nome = NEW.nome
   WHERE id = v_conta AND (ativo IS DISTINCT FROM NEW.ativo OR nome IS DISTINCT FROM NEW.nome);

  IF NOT NEW.ativo THEN
    UPDATE sessoes_de_carteira SET revogada_em = now()
     WHERE usuario_gestao_id = v_conta AND revogada_em IS NULL;
  END IF;

  IF v_antes IS DISTINCT FROM NEW.ativo THEN
    INSERT INTO auditoria_do_painel (ator_tipo, ator_id, acao, entidade, entidade_id, de, para, motivo)
    VALUES ('sistema', NULL, 'alterou', 'usuarios_gestao', v_conta::text,
            jsonb_build_object('ativo', v_antes), jsonb_build_object('ativo', NEW.ativo),
            'acompanha o operador (D-23, ADR 0024)');
  END IF;
  RETURN NULL;
END $$;

CREATE TRIGGER operador_sincroniza_conta_de_gestao
  AFTER UPDATE OF ativo, nome ON operadores
  FOR EACH ROW EXECUTE FUNCTION operador_sincroniza_conta_de_gestao();

-- Operador não se apaga em produção (estado, regra 20; `fir_painel` não tem
-- DELETE). Se um teste apaga, o vínculo cai em cascata e a conta que sobra
-- fica DESATIVADA — nunca uma conta geral, ativa e órfã.
CREATE FUNCTION vinculo_removido_desativa_conta() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  UPDATE usuarios_gestao SET ativo = false WHERE id = OLD.usuario_gestao_id AND ativo;
  UPDATE sessoes_de_carteira SET revogada_em = now()
   WHERE usuario_gestao_id = OLD.usuario_gestao_id AND revogada_em IS NULL;
  RETURN NULL;
END $$;

CREATE TRIGGER vinculo_removido_desativa_conta
  AFTER DELETE ON contas_de_gestao_do_operador
  FOR EACH ROW EXECUTE FUNCTION vinculo_removido_desativa_conta();

-- ---------------------------------------------------------------------------
-- O PERFIL FIXO. `SECURITY DEFINER` porque quem atualiza `usuarios_gestao`
-- pode ser `fir_carteira` (troca da própria senha), que não lê `operadores`.
-- ---------------------------------------------------------------------------
CREATE FUNCTION conta_de_gestao_do_operador_fixa() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_ativo_do_operador boolean;
BEGIN
  SELECT o.ativo INTO v_ativo_do_operador
    FROM contas_de_gestao_do_operador c JOIN operadores o ON o.id = c.operador_id
   WHERE c.usuario_gestao_id = OLD.id;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  IF NEW.escopo <> 'geral'
     OR NEW.grupo_id IS NOT NULL
     OR NOT NEW.valores
     OR NEW.carteira <> 'todos'
     OR NOT NEW.administrar
     OR NOT (NEW.modulos @> modulos_da_conta_do_operador() AND NEW.modulos <@ modulos_da_conta_do_operador())
     OR NEW.senha_hash IS DISTINCT FROM OLD.senha_hash
     OR NEW.senha_provisoria
     OR NEW.ativo IS DISTINCT FROM v_ativo_do_operador
  THEN
    RAISE EXCEPTION 'a conta de gestão do operador acompanha o operador: perfil, senha e estado não se editam'
      USING ERRCODE = 'check_violation',
            CONSTRAINT = 'conta_de_gestao_do_operador_fixa',
            HINT = 'D-23 item 6, ADR 0024. Desative o operador para desativar a conta.';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER conta_de_gestao_do_operador_fixa
  BEFORE UPDATE ON usuarios_gestao
  FOR EACH ROW EXECUTE FUNCTION conta_de_gestao_do_operador_fixa();

-- ---------------------------------------------------------------------------
-- BACKFILL: todo operador que já existe (o `firmare.admin` de produção)
-- ganha a conta agora, inclusive o desativado (que nasce desativado).
-- ---------------------------------------------------------------------------
SELECT provisionar_conta_de_gestao_do_operador(id) FROM operadores ORDER BY criado_em, id;

-- GUARDA: conferido, não presumido.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM operadores o
              WHERE NOT EXISTS (SELECT 1 FROM contas_de_gestao_do_operador c WHERE c.operador_id = o.id)) THEN
    RAISE EXCEPTION 'operador sem conta de gestão depois do backfill';
  END IF;
  IF has_table_privilege('fir_carteira', 'contas_de_gestao_do_operador', 'INSERT')
     OR has_table_privilege('fir_carteira', 'contas_de_gestao_do_operador', 'UPDATE')
     OR has_table_privilege('fir_carteira', 'contas_de_gestao_do_operador', 'DELETE')
     OR has_table_privilege('fir_painel', 'contas_de_gestao_do_operador', 'INSERT')
     OR has_table_privilege('fir_painel', 'contas_de_gestao_do_operador', 'UPDATE')
     OR has_table_privilege('fir_painel', 'contas_de_gestao_do_operador', 'DELETE')
     OR has_table_privilege('fir_app', 'contas_de_gestao_do_operador', 'SELECT')
  THEN
    RAISE EXCEPTION 'privilégio a mais no vínculo do operador com a conta de gestão'
      USING HINT = 'G8 F-1: o vínculo só é escrito pelas funções da 0061.';
  END IF;
  IF has_function_privilege('fir_painel', 'provisionar_conta_de_gestao_do_operador(uuid)', 'EXECUTE')
     OR has_function_privilege('fir_carteira', 'provisionar_conta_de_gestao_do_operador(uuid)', 'EXECUTE')
  THEN
    RAISE EXCEPTION 'provisionar_conta_de_gestao_do_operador é chamável pela aplicação';
  END IF;
  -- A sessão da carteira continua nascendo SÓ por `fir_carteira` (0055).
  IF has_table_privilege('fir_painel', 'sessoes_de_carteira', 'INSERT') THEN
    RAISE EXCEPTION 'fir_painel não cria sessão de carteira';
  END IF;
END $$;
