-- ===========================================================================
-- CLÍNICA NOVA ENTRA SOZINHA NO GRUPO FIRMARE.
-- Spec: docs/specs/clinica-nova-entra-no-grupo-firmare.md. Decisão do dono em
-- 2026-11-10 (pedido da cliente). Substitui, na ADR 0011, o item "grupo GERAL
-- contendo todas as clínicas" (ver a ADR 2026-11-10-grupo-firmare-padrao).
--
-- Forward-only, EXPAND: uma coluna nova com default, gatilhos e funções novos.
-- Nenhuma linha existente muda de grupo; nenhuma clínica já cadastrada é movida.
--
-- ## O que existe depois
--  1. `grupos.padrao`: no máximo UM grupo padrão (índice único parcial). A
--     migration cria o grupo `Firmare` como padrão, ou marca o que já tem esse
--     nome — e FALHA ALTO se houver Usuário de Gestão de escopo `grupo` nele.
--  2. O grupo padrão não se desativa, não se apaga e não deixa de ser padrão
--     (renomear pode).
--  3. Usuário de Gestão de escopo `grupo` NUNCA aponta para o grupo padrão:
--     senão ele seria um segundo `geral`, sem a trilha e o perfil da conta do
--     operador. Imposto no banco, nos dois sentidos (appsec, LGPD 5.1).
--  4. `AFTER INSERT ON clinicas`: a clínica nova ganha a linha de histórico de
--     grupo e o `Cliente Firmare` no grupo padrão, na mesma transação.
--
-- ## Por que o ator importa (e o que acontece sem ele)
-- `historico_grupo_da_clinica.mudado_por` é NOT NULL e aponta para um
-- operador. Só se cria a carteira quando `app.pessoa_id` é `operador:<uuid>`
-- de um operador que existe. Sem isso (INSERT cru, fixture, break-glass) a
-- clínica nasce normalmente e fica SEM cliente: o caminho manual continua. A
-- criação de uma clínica nunca depende da carteira para existir. Nada aqui
-- coage o ator.
--
-- ## RLS
-- As funções são SECURITY DEFINER e rodam como o dono da migration, que tem
-- BYPASSRLS — o mesmo padrão de `semear_motivos_de_perda` (0007). O ator vem só
-- de `current_setting('app.pessoa_id')`, nunca de parâmetro.
--
-- ## Log
-- Nenhuma mensagem daqui carrega o nome da clínica (LGPD, exigência d).
-- ===========================================================================

ALTER TABLE grupos ADD COLUMN padrao boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN grupos.padrao IS
  'O Grupo Firmare: onde toda clínica nova nasce. No máximo um. Não se '
  'desativa, não se apaga, não perde a marca (gatilho grupos_padrao_fixo). '
  'Usuário de Gestão de escopo grupo nunca aponta para ele.';

CREATE UNIQUE INDEX grupos_um_so_padrao ON grupos ((true)) WHERE padrao;

-- ---------------------------------------------------------------------------
-- O grupo padrão. Idempotente. Se já existe um grupo chamado Firmare, ele é
-- marcado em vez de duplicado; se alguém de escopo `grupo` já está nele, a
-- migration para (a regra 3 não admite o estado).
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_id uuid;
BEGIN
  SELECT id INTO v_id FROM grupos WHERE lower(btrim(nome)) = 'firmare' ORDER BY criado_em LIMIT 1;
  IF v_id IS NULL THEN
    INSERT INTO grupos (nome, padrao) VALUES ('Firmare', true) RETURNING id INTO v_id;
  ELSE
    IF EXISTS (SELECT 1 FROM usuarios_gestao WHERE escopo = 'grupo' AND grupo_id = v_id) THEN
      RAISE EXCEPTION 'já há Usuário de Gestão de escopo grupo no grupo Firmare existente; resolva antes de marcá-lo como padrão';
    END IF;
    UPDATE grupos SET padrao = true, ativo = true WHERE id = v_id;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- O padrão é fixo. `fir_painel` e `fir_carteira` não ganham privilégio novo:
-- a trava é do gatilho, que vale para qualquer papel.
-- ---------------------------------------------------------------------------
CREATE FUNCTION grupos_padrao_fixo() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.padrao THEN
      RAISE EXCEPTION 'o grupo padrão não se apaga'
        USING ERRCODE = '23514', CONSTRAINT = 'grupo_padrao_fixo';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.padrao AND (NOT NEW.padrao OR NOT NEW.ativo) THEN
    RAISE EXCEPTION 'o grupo padrão não se desativa nem deixa de ser padrão'
      USING ERRCODE = '23514', CONSTRAINT = 'grupo_padrao_fixo';
  END IF;

  IF NEW.padrao AND NOT OLD.padrao
     AND EXISTS (SELECT 1 FROM usuarios_gestao WHERE escopo = 'grupo' AND grupo_id = NEW.id) THEN
    RAISE EXCEPTION 'há Usuário de Gestão de escopo grupo neste grupo; ele não pode ser o padrão'
      USING ERRCODE = '23514', CONSTRAINT = 'usuario_de_gestao_do_grupo_padrao';
  END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION grupos_padrao_fixo() FROM PUBLIC;

CREATE TRIGGER grupos_padrao_fixo
  BEFORE UPDATE OR DELETE ON grupos
  FOR EACH ROW EXECUTE FUNCTION grupos_padrao_fixo();

-- ---------------------------------------------------------------------------
-- Usuário de Gestão de escopo `grupo` nunca é do grupo padrão.
-- ---------------------------------------------------------------------------
CREATE FUNCTION usuario_de_gestao_nao_e_do_grupo_padrao() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.escopo = 'grupo' AND NEW.grupo_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM grupos WHERE id = NEW.grupo_id AND padrao) THEN
    RAISE EXCEPTION 'Usuário de Gestão de escopo grupo não pode ser do grupo padrão'
      USING ERRCODE = '23514', CONSTRAINT = 'usuario_de_gestao_do_grupo_padrao';
  END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION usuario_de_gestao_nao_e_do_grupo_padrao() FROM PUBLIC;

CREATE TRIGGER usuario_de_gestao_nao_e_do_grupo_padrao
  BEFORE INSERT OR UPDATE ON usuarios_gestao
  FOR EACH ROW EXECUTE FUNCTION usuario_de_gestao_nao_e_do_grupo_padrao();

-- ---------------------------------------------------------------------------
-- A CLÍNICA NOVA. Ordem fixa: histórico ANTES do cliente — o gatilho de
-- vínculos da 0047 confere o grupo da clínica pela última linha do histórico.
-- `ON CONFLICT DO NOTHING` no cliente: a criação da clínica não falha por um
-- vínculo que já exista.
-- ---------------------------------------------------------------------------
CREATE FUNCTION clinica_nova_entra_no_grupo_padrao() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_ator     text := coalesce(current_setting('app.pessoa_id', true), '');
  v_operador uuid;
  v_grupo    uuid;
BEGIN
  -- Só `operador:<uuid>` válido. Regex ANTES do cast: nunca exceção de cast.
  IF v_ator !~ '^operador:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN NULL;
  END IF;
  SELECT id INTO v_operador FROM operadores WHERE id = substr(v_ator, 10)::uuid;
  IF v_operador IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT id INTO v_grupo FROM grupos WHERE padrao AND ativo;
  IF v_grupo IS NULL THEN
    RETURN NULL;
  END IF;

  INSERT INTO historico_grupo_da_clinica (clinica_id, grupo_anterior_id, grupo_novo_id, mudado_por, motivo)
  VALUES (NEW.id, NULL, v_grupo, v_operador, 'clínica nova');

  INSERT INTO clientes_carteira (grupo_id, clinica_id, nome, produto)
  VALUES (v_grupo, NEW.id, NEW.nome, 'FIR Clinic')
  ON CONFLICT (clinica_id) DO NOTHING;

  RETURN NULL;
END $$;

REVOKE ALL ON FUNCTION clinica_nova_entra_no_grupo_padrao() FROM PUBLIC;

CREATE TRIGGER clinica_nova_entra_no_grupo_padrao
  AFTER INSERT ON clinicas
  FOR EACH ROW EXECUTE FUNCTION clinica_nova_entra_no_grupo_padrao();

-- ---------------------------------------------------------------------------
-- Guarda pós-migration, como a 0061: exatamente um padrão e funções fechadas.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_n integer;
BEGIN
  SELECT count(*) INTO v_n FROM grupos WHERE padrao;
  IF v_n <> 1 THEN
    RAISE EXCEPTION '0067: esperava exatamente 1 grupo padrão, há %', v_n;
  END IF;
  IF has_function_privilege('fir_painel', 'clinica_nova_entra_no_grupo_padrao()', 'EXECUTE')
     OR has_function_privilege('fir_carteira', 'clinica_nova_entra_no_grupo_padrao()', 'EXECUTE') THEN
    RAISE EXCEPTION '0067: a função do gatilho não pode ser chamável pelos papéis da aplicação';
  END IF;
END $$;
