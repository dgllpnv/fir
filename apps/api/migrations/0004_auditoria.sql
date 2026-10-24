-- ---------------------------------------------------------------------------
-- A trilha de auditoria: quem, quando, de → para.
--
-- Regra 20 do CLAUDE.md. O registro de ESCRITA é trigger no Postgres, não
-- chamada no handler, e a diferença é o ponto inteiro desta migration:
-- nenhum caminho escapa. Nem um `psql` manual, nem um job, nem a rota que o
-- programador esqueceu de instrumentar.
--
-- Em tabela append-only não existe gravar depois o que não foi gravado na
-- hora. É por isso que isto vem ANTES de todo plano que escreve dado.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- O ATOR DA TRANSAÇÃO, no mesmo espírito de `app_clinica_id()`.
--
-- Três estados, e distingui-los é o que faz a trilha valer:
--
--   não declarado  → a escrita é RECUSADA (ver `registrar_auditoria`)
--   'sistema'      → semente, job, migration de dados: ninguém humano
--   um uuid        → a pessoa autenticada
--
-- POR QUE A SENTINELA LITERAL `'sistema'`, E NÃO A STRING VAZIA:
--
-- O desenho original distinguia "sistema" de "esqueceram" pela string vazia:
-- `''` seria sistema, `NULL` (parâmetro nunca definido) seria o esquecimento.
-- Medido contra o Postgres 17 deste container, isso não funciona:
--
--   antes  do SET LOCAL:  current_setting('app.x', true) IS NULL → t
--   dentro do SET LOCAL:  current_setting('app.x', true)         → 'abc'
--   DEPOIS do COMMIT:     current_setting('app.x', true)         → ''
--
-- Um parâmetro personalizado, uma vez definido na sessão, nunca volta a ser
-- NULL — ele volta a `''`. Com pool de conexões, toda conexão que já serviu
-- uma requisição passaria a relatar `''` para sempre, e o esquecimento seria
-- classificado como "sistema" em silêncio. Seria a falha calada que a regra
-- 20 existe para impedir, escondida justamente no mecanismo que a impede.
--
-- Com a sentinela, `''` e "nunca definido" são a MESMA coisa — ausência — e
-- declarar o sistema é um ato explícito que alguém escreveu.
-- ---------------------------------------------------------------------------
CREATE FUNCTION app_pessoa_id() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(nullif(current_setting('app.pessoa_id', true), ''), 'sistema')::uuid $$;

COMMENT ON FUNCTION app_pessoa_id() IS
  'A pessoa que é o ator da transação atual. NULL quando o ator é o sistema '
  'OU quando ninguém declarou ator — quem precisa distinguir os dois lê '
  'current_setting(''app.pessoa_id'', true) direto.';

CREATE TABLE auditoria (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  clinica_id    uuid NOT NULL REFERENCES clinicas(id),
  em            timestamptz NOT NULL DEFAULT now(),
  -- 'operador' ainda não existe: é o superadmin do épico 12, e ele NÃO é uma
  -- `pessoa` (decisão D-5, restrição 1). A coluna nasce com os três valores
  -- para que aquele épico não precise de migration que reescreva o passado —
  -- e para que ninguém seja tentado a representar o superadmin como pessoa de
  -- alguma clínica.
  ator_tipo     text NOT NULL CHECK (ator_tipo IN ('pessoa', 'operador', 'sistema')),
  ator_id       uuid,
  acao          text NOT NULL CHECK (acao IN ('criou', 'alterou', 'removeu', 'acessou')),
  entidade      text NOT NULL,
  -- `text`, não `uuid`: as chaves primárias variam de tipo. `tentativas_login`
  -- é `bigserial`, e o épico de importação vai registrar entidades cuja chave
  -- é a chave de acesso da NF-e.
  entidade_id   text NOT NULL,
  de            jsonb,
  para          jsonb,
  motivo        text,
  requisicao_id text,
  -- 'pessoa' e 'operador' sem id dizem "alguém alterou" — que é exatamente a
  -- pergunta da LGPD deixada sem resposta. Só o sistema é anônimo, porque só
  -- ele não é ninguém.
  CONSTRAINT ator_tem_id CHECK (ator_tipo = 'sistema' OR ator_id IS NOT NULL)
);

COMMENT ON TABLE auditoria IS
  'Trilha append-only de escrita e de ACESSO (regra 18). Não é log: é dado, '
  'com controle de acesso próprio. Contém salário em de/para e, no Plano 6, '
  'dose por paciente — atravessa a redação de valores como qualquer saída.';

-- A consulta do admin da clínica é sempre "o que aconteceu aqui, do mais
-- recente para trás", e a paginação é por `(em, id)`.
CREATE INDEX auditoria_por_clinica_em ON auditoria (clinica_id, em DESC, id DESC);
-- E a segunda pergunta é sempre "o histórico DESTE registro".
CREATE INDEX auditoria_por_entidade ON auditoria (clinica_id, entidade, entidade_id, em DESC);

ALTER TABLE auditoria ENABLE ROW LEVEL SECURITY;
ALTER TABLE auditoria FORCE  ROW LEVEL SECURITY;
CREATE POLICY auditoria_por_clinica ON auditoria
  USING (clinica_id = app_clinica_id())
  WITH CHECK (clinica_id = app_clinica_id());

-- ---------------------------------------------------------------------------
-- APPEND-ONLY, CAMADA 1: privilégio.
--
-- `fir_app` lê e insere; nunca altera nem apaga. O `GRANT` sozinho não
-- estreita nada (o ALTER DEFAULT PRIVILEGES do bootstrap já concedeu os
-- quatro) — quem faz o trabalho é o REVOKE.
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT ON auditoria TO fir_app;
REVOKE UPDATE, DELETE, TRUNCATE ON auditoria FROM fir_app;

-- ---------------------------------------------------------------------------
-- APPEND-ONLY, CAMADA 2: trigger.
--
-- O REVOKE acima **não alcança o dono da tabela**. `fir_migrate` é dono e tem
-- BYPASSRLS: um `UPDATE auditoria` dele — numa migration de dados, num script
-- de correção, num psql às duas da manhã — passaria sem nenhum aviso. Sozinha,
-- a camada 1 seria teatro. Esta trigger alcança todo mundo.
--
-- `FOR EACH STATEMENT`: a recusa não depende de haver linha afetada. Um
-- `UPDATE … WHERE false` que passasse em silêncio ensinaria que "às vezes
-- dá", e a tentativa seguinte seria com um WHERE que casa.
-- ---------------------------------------------------------------------------
CREATE FUNCTION auditoria_e_append_only() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'auditoria é append-only: % recusado', TG_OP
    USING HINT = 'Corrigir um registro é inserir outro, nunca editar este.';
END $$;

CREATE TRIGGER auditoria_sem_update
  BEFORE UPDATE OR DELETE OR TRUNCATE ON auditoria
  FOR EACH STATEMENT EXECUTE FUNCTION auditoria_e_append_only();

-- ---------------------------------------------------------------------------
-- A DENYLIST: o que nunca atravessa para `de`/`para`.
--
-- O valor é substituído, e a CHAVE FICA. Omitir a coluna esconderia o segredo
-- e também o FATO: "a senha de alguém foi trocada, por quem e quando" é
-- precisamente a pergunta que uma trilha de auditoria existe para responder, e
-- uma troca de senha que não deixa linha nenhuma é um buraco, não uma
-- proteção. O nome da coluna não é segredo; o conteúdo é.
--
-- Acrescente aqui qualquer segredo novo. É o único lugar.
-- ---------------------------------------------------------------------------
CREATE FUNCTION auditoria_sem_segredos(p jsonb) RETURNS jsonb
  LANGUAGE sql IMMUTABLE
  SET search_path = pg_catalog
  AS $$
    SELECT CASE WHEN p IS NULL THEN NULL ELSE coalesce(
      (SELECT jsonb_object_agg(
                k,
                CASE WHEN k = ANY (ARRAY['senha_hash', 'token_hash'])
                     THEN '"[oculto]"'::jsonb
                     ELSE p -> k END)
         FROM jsonb_object_keys(p) k),
      -- `jsonb_object_agg` de zero chaves devolve NULL, e `'{}'` precisa
      -- continuar sendo `'{}'`.
      p) END
  $$;

COMMENT ON FUNCTION auditoria_sem_segredos(jsonb) IS
  'Substitui o VALOR das colunas da denylist por "[oculto]", preservando a '
  'chave. A trilha registra que o segredo mudou, nunca qual era.';

-- ---------------------------------------------------------------------------
-- A TRIGGER QUE REGISTRA — e que recusa escrever sem ator.
--
-- Por que trigger, e não chamada no serviço:
--
--  1. NENHUM CAMINHO ESCAPA. Nem um `psql` manual, nem um job, nem a rota que
--     o programador esqueceu. Uma chamada no handler é esquecível por
--     construção, e o handler número quarenta não será revisado com o cuidado
--     do primeiro.
--  2. `de → para` SAI DE `OLD`/`NEW`, exato, sem o handler montar o diff —
--     que é o lugar onde um diff montado à mão fica errado em silêncio.
--  3. FALHA FECHADO. Sem ator declarado, a escrita é RECUSADA. O contrário —
--     gravar o dado e não a trilha — seria a falha silenciosa que a regra 20
--     existe para impedir.
--
-- `SECURITY DEFINER`: a função roda como `fir_migrate`, dono da tabela. Sem
-- isso, a trilha dependeria dos privilégios e da RLS de quem fez a escrita, e
-- um `REVOKE INSERT ON auditoria FROM fir_app` futuro passaria a derrubar
-- toda escrita da aplicação em vez de só a da trilha. `search_path` fixo e
-- tudo qualificado por `public.`, pela mesma razão explicada na 0003.
--
-- Não há `REVOKE EXECUTE … FROM PUBLIC` aqui de propósito: quem faz o DML
-- precisa de EXECUTE na função da trigger, e o Postgres recusa chamar uma
-- função `RETURNS trigger` fora de uma trigger — não há superfície a fechar.
-- ---------------------------------------------------------------------------
CREATE FUNCTION registrar_auditoria() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  -- O valor CRU, não `app_pessoa_id()`: a função devolve NULL tanto para
  -- "sistema" quanto para "ninguém declarou", e distinguir os dois é o
  -- trabalho desta trigger.
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
  ELSE
    -- Um valor que não é uuid estoura aqui, e isso é o certo: ator ilegível é
    -- ator ausente.
    v_tipo := 'pessoa';
    v_ator := v_cru::uuid;
  END IF;

  -- `OLD` em trigger de INSERT e `NEW` em trigger de DELETE não estão
  -- atribuídos; tocá-los levanta. Por isso cada um só é materializado onde
  -- existe.
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
    -- SÓ O QUE MUDOU. A trilha fica legível e pequena: ninguém lê um diff de
    -- vinte colunas para descobrir que a função mudou, e trilha que ninguém lê
    -- não é trilha. O diff é calculado no valor CRU e redigido depois — fazer
    -- o contrário tornaria invisível a troca de um segredo, porque os dois
    -- lados viriam já como '[oculto]'.
    SELECT jsonb_object_agg(k, v_old -> k), jsonb_object_agg(k, v_new -> k)
      INTO v_de, v_para
      FROM jsonb_object_keys(v_new) k
     WHERE v_old -> k IS DISTINCT FROM v_new -> k;
    -- UPDATE que não mudou nada: nenhuma linha. Cada salvamento de formulário
    -- sem alteração viraria um "alterou" sem de → para, e o ruído esconde o
    -- que importa.
    IF v_para IS NULL THEN RETURN NULL; END IF;
    v_id := v_new ->> 'id';
    v_clinica := (v_new ->> 'clinica_id')::uuid;
  END IF;

  -- `entidade_id` é NOT NULL: uma tabela futura cuja chave primária não se
  -- chame `id` estoura aqui, na primeira escrita, em vez de produzir trilha
  -- sem o registro a que ela se refere.
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
  'escrita quando ninguém declarou ator: gravar o dado sem a trilha é a falha '
  'silenciosa que a regra 20 existe para impedir.';

-- ---------------------------------------------------------------------------
-- E TODA TABELA DE NEGÓCIO DE HOJE.
--
-- `sessoes` e `tentativas_login` entram junto com `pessoas` e `perfis`: quem
-- entrou, quando e de onde é exatamente o que uma clínica precisa poder
-- perguntar depois de um incidente, e é a pergunta que ninguém faz antes de
-- precisar da resposta.
--
-- A lista aqui é explícita, mas quem a mantém honesta não é a revisão de
-- código: é a varredura de `teste/auditoria-inescapavel.test.ts`, que reprova
-- qualquer tabela com `clinica_id` sem este trigger. Lista mantida à mão
-- envelhece em silêncio; varredura de catálogo não.
--
-- `auditoria` fica fora, e tem de ficar: um `AFTER INSERT` nela que insere
-- nela é recursão infinita. A trilha não se audita — ela é append-only, que é
-- a proteção equivalente.
-- ---------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['pessoas', 'perfis', 'sessoes', 'tentativas_login'] LOOP
    EXECUTE format(
      'CREATE TRIGGER %I_auditoria AFTER INSERT OR UPDATE OR DELETE ON %I '
      'FOR EACH ROW EXECUTE FUNCTION registrar_auditoria()', t, t);
  END LOOP;
END $$;
