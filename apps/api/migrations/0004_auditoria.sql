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
