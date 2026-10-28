-- ---------------------------------------------------------------------------
-- O PAINEL DO SUPERADMIN. Decisões D-5 (restrições 1, 3, 5, 6 e 7) e D-10.
--
-- ELE NÃO É UMA `pessoa`, e nenhuma destas tabelas tem `clinica_id`. Um
-- booleano `superadmin` em `pessoas` já teria perdido o modelo: a mesma
-- sessão passaria a poder sair do próprio tenant, e a RLS que sustenta o
-- produto inteiro dependeria de um `if`.
--
-- Por não terem `clinica_id`, estas tabelas ficam fora da varredura de
-- `teste/auditoria-inescapavel.test.ts` (que cobra trigger de toda tabela COM
-- `clinica_id`). Quem as cobra é `teste/escrita-sem-rls.test.ts`, que exige
-- REVOKE de toda relação sem RLS — e isso é exatamente o controle certo:
-- **`fir_app` não pode nem ler o hash de um operador.**
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- O PAPEL PRECISA EXISTIR, E PRECISA SER COMUM.
--
-- FALHA ALTO, e de propósito: um `IF EXISTS` que pulasse os GRANTs em
-- silêncio deixaria o painel subir sem privilégio e falhar na primeira
-- escrita, em produção, sem ninguém ligar o sintoma à causa.
--
-- O papel não nasce aqui porque `fir_migrate` não tem `CREATEROLE` — e dar-lhe
-- esse privilégio para criar um papel privilegiado seria trocar o problema de
-- lugar.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fir_painel') THEN
    RAISE EXCEPTION 'o papel fir_painel não existe'
      USING HINT = 'Local: rode `fir reset` depois de atualizar '
                   'infra/bootstrap-papeis.sql. Produção: rode '
                   'infra/producao/provisionar-painel.sh ANTES de migrar.';
  END IF;
  IF (SELECT rolbypassrls OR rolsuper FROM pg_roles WHERE rolname = 'fir_painel') THEN
    RAISE EXCEPTION 'fir_painel tem BYPASSRLS ou SUPERUSER'
      USING HINT = 'D-10: o superadmin NUNCA atravessa a RLS — ele fixa '
                   'app.clinica_id da clínica em que opera, como qualquer um. '
                   'Corrija o papel e migre de novo.';
  END IF;
  -- `CREATEROLE` no papel da aplicação é escalada de privilégio de um passo:
  -- quem o tem cria um papel com BYPASSRLS e volta por ele.
  IF (SELECT rolcreaterole FROM pg_roles WHERE rolname = 'fir_painel') THEN
    RAISE EXCEPTION 'fir_painel tem CREATEROLE'
      USING HINT = 'Com CREATEROLE o painel cria um papel com BYPASSRLS e '
                   'volta por ele. Tire o privilégio.';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- OS OPERADORES.
--
-- Mesma forma canônica de `pessoas.usuario` (0012), e aqui o escopo é
-- GLOBAL: não há clínica a que pertencer. O identificador continua tendo de
-- ser DITÁVEL — quem redefine a senha de um operador o faz por telefone com
-- quem tem SSH.
-- ---------------------------------------------------------------------------
CREATE TABLE operadores (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario     text NOT NULL UNIQUE,
  nome        text NOT NULL,
  senha_hash  text NOT NULL,
  -- Estado, nunca exclusão: a trilha do painel aponta para este id.
  ativo       boolean NOT NULL DEFAULT true,
  senha_provisoria boolean NOT NULL DEFAULT false,
  senha_provisoria_expira_em timestamptz,
  criado_em   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT operadores_usuario_canonico CHECK (
    usuario = normalizar_nome(usuario)
    AND usuario ~ '^[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
    AND length(usuario) BETWEEN 3 AND 32
  ),
  CONSTRAINT provisoria_tem_prazo
    CHECK (NOT senha_provisoria OR senha_provisoria_expira_em IS NOT NULL)
);

COMMENT ON TABLE operadores IS
  'O superadmin. NÃO é uma `pessoa` (D-5 restrição 1): tabela própria, sem '
  'clinica_id, cookie próprio e prefixo de rota próprio. O primeiro nasce '
  'pelo break-glass da VPS — o painel não tem como criar um antes de existir '
  'um.';

CREATE TABLE sessoes_de_operador (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operador_id uuid NOT NULL REFERENCES operadores(id),
  -- Token opaco; o banco guarda só o hash, como em `sessoes`.
  token_hash  text NOT NULL UNIQUE,
  criada_em   timestamptz NOT NULL DEFAULT now(),
  expira_em   timestamptz NOT NULL,
  revogada_em timestamptz
);
CREATE INDEX sessoes_de_operador_vivas ON sessoes_de_operador (operador_id)
  WHERE revogada_em IS NULL;

CREATE TABLE tentativas_de_operador (
  id            bigserial PRIMARY KEY,
  identificador text NOT NULL,
  em            timestamptz NOT NULL DEFAULT now(),
  sucesso       boolean NOT NULL
);
CREATE INDEX tentativas_de_operador_recentes
  ON tentativas_de_operador (identificador, em DESC);

-- ---------------------------------------------------------------------------
-- A SEGUNDA TRILHA, e por que ela precisa existir.
--
-- `auditoria.clinica_id` é NOT NULL, e tem de continuar sendo. Mas "o
-- operador X foi criado", "a senha do operador Y foi redefinida pela VPS" e
-- "o operador Z entrou no painel" não pertencem a clínica nenhuma. A
-- alternativa — uma clínica sentinela — já foi recusada por escrito na 0002,
-- pelas mesmas razões: `clinicas` é a raiz do tenancy, não tem RLS, e a
-- sentinela apareceria em toda listagem de clínicas como um caso especial.
--
-- A REGRA DE REPARTIÇÃO, e ela cabe numa frase: **o que toca dado de uma
-- clínica vai para a `auditoria` daquela clínica, com `ator_tipo =
-- 'operador'`; o que é sobre operadores vai para cá.** Nenhuma ação do painel
-- fica sem registro, e nenhuma clínica deixa de ver o que foi feito dentro
-- dela.
-- ---------------------------------------------------------------------------
CREATE TABLE auditoria_do_painel (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  em          timestamptz NOT NULL DEFAULT now(),
  -- 'vps' é o break-glass: quem tem SSH, sem operador autenticado por trás.
  ator_tipo   text NOT NULL CHECK (ator_tipo IN ('operador', 'vps', 'sistema')),
  ator_id     uuid,
  acao        text NOT NULL CHECK (acao IN ('criou', 'alterou', 'removeu', 'acessou', 'entrou')),
  entidade    text NOT NULL,
  entidade_id text NOT NULL,
  de          jsonb,
  para        jsonb,
  motivo      text,
  -- 'operador' sem id diz "alguém fez" — que é a pergunta deixada sem
  -- resposta. 'vps' e 'sistema' são anônimos porque de fato não são ninguém:
  -- quem os operou se identifica pelo acesso SSH, fora deste banco.
  CONSTRAINT ator_do_painel_tem_id CHECK (ator_tipo <> 'operador' OR ator_id IS NOT NULL)
);
CREATE INDEX auditoria_do_painel_em ON auditoria_do_painel (em DESC, id DESC);

COMMENT ON TABLE auditoria_do_painel IS
  'A trilha do que é SOBRE operadores. O que o operador faz DENTRO de uma '
  'clínica vai para a `auditoria` daquela clínica, com ator_tipo = operador — '
  'é a trilha que a clínica enxerga, e é isso que, com o DPA, separa acesso '
  'de operador de acesso arbitrário (D-10).';

-- Append-only nas DUAS camadas, como a `auditoria`: o REVOKE não alcança o
-- dono da tabela, e sozinho seria teatro.
CREATE TRIGGER auditoria_do_painel_sem_update
  BEFORE UPDATE OR DELETE OR TRUNCATE ON auditoria_do_painel
  FOR EACH STATEMENT EXECUTE FUNCTION auditoria_e_append_only();

-- ---------------------------------------------------------------------------
-- PRIVILÉGIOS, parte 1: `fir_app` não toca em NADA do painel — nem SELECT.
--
-- O `ALTER DEFAULT PRIVILEGES` do bootstrap concede os quatro verbos a
-- `fir_app` em toda tabela que `fir_migrate` criar. Sem este REVOKE, a API do
-- balcão leria o hash de senha do superadmin.
-- ---------------------------------------------------------------------------
REVOKE ALL ON operadores, sessoes_de_operador, tentativas_de_operador,
              auditoria_do_painel FROM fir_app;
REVOKE ALL ON SEQUENCE tentativas_de_operador_id_seq FROM fir_app;

-- ---------------------------------------------------------------------------
-- PRIVILÉGIOS, parte 2: o que `fir_painel` alcança.
--
-- Nada de `ALTER DEFAULT PRIVILEGES` para ele: concessão por omissão é como o
-- painel ganharia acesso a toda tabela que os épicos 2 a 8 criarem, sem
-- ninguém decidir. Aqui cada linha é uma decisão.
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE ON operadores, sessoes_de_operador TO fir_painel;
GRANT SELECT, INSERT ON tentativas_de_operador, auditoria_do_painel TO fir_painel;
GRANT USAGE, SELECT ON SEQUENCE tentativas_de_operador_id_seq TO fir_painel;
-- Nem o painel reescreve a própria trilha.
REVOKE UPDATE, DELETE, TRUNCATE ON auditoria_do_painel FROM fir_painel;

-- `fir_painel` opera DENTRO das clínicas, sujeito à RLS delas — ele não tem
-- BYPASSRLS, então cada um destes GRANTs só vale para a clínica fixada em
-- `app.clinica_id`.
GRANT SELECT, INSERT, UPDATE ON pessoas, perfis, sessoes TO fir_painel;
GRANT SELECT, INSERT ON auditoria TO fir_painel;
-- E é o único papel da aplicação que cria clínica. `fir_app` continua sem
-- INSERT em `clinicas` (REVOKE da 0001), e isso não muda.
GRANT SELECT, INSERT, UPDATE ON clinicas TO fir_painel;

-- ---------------------------------------------------------------------------
-- O ATOR 'operador' PASSA A SER EMITIDO.
--
-- A 0004 já criou `auditoria.ator_tipo` com os três valores, exatamente para
-- que este dia não precisasse de migration que reescrevesse o passado. Falta
-- o produtor.
--
-- A sentinela é `operador:<uuid>` em `app.pessoa_id`, ao lado de `sistema` e
-- do uuid cru. `CREATE OR REPLACE`, nunca edição da 0004.
-- ---------------------------------------------------------------------------

-- `app_pessoa_id()` ESTOURAVA com `operador:<uuid>` (`invalid input syntax for
-- type uuid`) — reproduzido antes desta migration. A função é chamada em
-- teste e pode entrar numa policy amanhã; um ator legítimo que derruba toda
-- consulta que a chame é um defeito, não uma proteção.
--
-- O regex é o de um uuid de verdade, e não `[0-9a-fA-F-]{36}`: aquele casaria
-- trinta e seis hífens e o `::uuid` estouraria mesmo assim — trocaria o
-- buraco de lugar em vez de tapá-lo.
CREATE OR REPLACE FUNCTION app_pessoa_id() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$
    SELECT CASE
             WHEN current_setting('app.pessoa_id', true) ~*
                  '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
             THEN current_setting('app.pessoa_id', true)::uuid
           END
  $$;

COMMENT ON FUNCTION app_pessoa_id() IS
  'A PESSOA que é o ator da transação. NULL quando o ator é o sistema, um '
  'OPERADOR do painel, ou quando ninguém declarou — quem precisa distinguir '
  'lê current_setting(''app.pessoa_id'', true) direto, como a trigger faz.';

-- ---------------------------------------------------------------------------
-- A TRIGGER, com o ramo novo. Corpo inteiro copiado da 0004, sem outra
-- alteração — `CREATE OR REPLACE` exige o corpo todo, e editar a 0004 seria
-- reescrever uma migration já aplicada.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION registrar_auditoria() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_cru     text := coalesce(current_setting('app.pessoa_id', true), '');
  v_tipo    text;
  v_ator    uuid;
  v_old     jsonb;
  v_new     jsonb;
  v_de      jsonb;
  v_para    jsonb;
  v_id      text;
  v_clinica uuid;
BEGIN
  IF v_cru = '' THEN
    RAISE EXCEPTION 'ator não declarado: escrita em % recusada', TG_TABLE_NAME
      USING HINT = 'Use banco.naClinica(clinica, ator, …). Em job, semente ou '
                   'migration de dados, passe SISTEMA — explicitamente.';
  ELSIF v_cru = 'sistema' THEN
    v_tipo := 'sistema';
    v_ator := NULL;
  ELSIF left(v_cru, 9) = 'operador:' THEN
    -- O superadmin (D-5 restrição 1, D-10). O uuid é de `operadores`, e
    -- `auditoria.ator_id` NÃO tem FK — de propósito: uma FK daqui para
    -- `operadores` cruzaria a fronteira do tenant e tornaria a trilha da
    -- clínica dependente de uma tabela que ela não pode ler.
    v_tipo := 'operador';
    -- Malformado estoura, e isso é o certo: ator ilegível é ator ausente.
    v_ator := substr(v_cru, 10)::uuid;
  ELSE
    -- Um valor que não é uuid estoura aqui, e isso é o certo: ator ilegível é
    -- ator ausente.
    v_tipo := 'pessoa';
    v_ator := v_cru::uuid;
  END IF;

  IF TG_OP <> 'INSERT' THEN v_old := to_jsonb(OLD); END IF;
  IF TG_OP <> 'DELETE' THEN v_new := to_jsonb(NEW); END IF;

  IF TG_OP = 'DELETE' THEN
    v_de := v_old;
    v_para := NULL;
    v_id := v_old ->> 'id';
    v_clinica := (v_old ->> 'clinica_id')::uuid;
  ELSIF TG_OP = 'INSERT' THEN
    v_de := NULL;
    v_para := v_new;
    v_id := v_new ->> 'id';
    v_clinica := (v_new ->> 'clinica_id')::uuid;
  ELSE
    SELECT jsonb_object_agg(k, v_old -> k), jsonb_object_agg(k, v_new -> k)
      INTO v_de, v_para
      FROM jsonb_object_keys(v_new) k
     WHERE v_old -> k IS DISTINCT FROM v_new -> k;
    IF v_para IS NULL THEN RETURN NULL; END IF;
    v_id := v_new ->> 'id';
    v_clinica := (v_new ->> 'clinica_id')::uuid;
  END IF;

  INSERT INTO public.auditoria
    (clinica_id, ator_tipo, ator_id, acao, entidade, entidade_id, de, para)
  VALUES (
    v_clinica,
    v_tipo,
    v_ator,
    CASE TG_OP WHEN 'INSERT' THEN 'criou' WHEN 'UPDATE' THEN 'alterou' ELSE 'removeu' END,
    TG_TABLE_NAME,
    v_id,
    public.auditoria_sem_segredos(v_de),
    public.auditoria_sem_segredos(v_para));

  RETURN NULL;
END $$;

COMMENT ON FUNCTION registrar_auditoria() IS
  'Trigger AFTER INSERT/UPDATE/DELETE de toda tabela de negócio. RECUSA a '
  'escrita quando ninguém declarou ator. Três atores: pessoa (uuid cru), '
  'sistema, e operador do painel (operador:<uuid>) — este último grava '
  'ator_tipo = operador na trilha DA CLÍNICA, que é a que ela enxerga.';
