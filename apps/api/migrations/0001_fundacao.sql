-- ---------------------------------------------------------------------------
-- Fundação: a clínica é a fronteira de isolamento de todo o sistema.
-- ---------------------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE clinicas (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo     text        NOT NULL UNIQUE,
  nome       text        NOT NULL,
  -- O fuso é PROPRIEDADE DA CLÍNICA. O legado fixou 'America/Bahia' num const,
  -- e isso quebra na primeira clínica de outro estado.
  fuso       text        NOT NULL DEFAULT 'America/Bahia',
  -- Estado, nunca exclusão. Desativar uma clínica precisa ser um UPDATE, não
  -- um procedimento manual por SSH.
  ativa      boolean     NOT NULL DEFAULT true,
  criada_em  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON COLUMN clinicas.fuso IS
  'Fuso IANA usado para calcular dia civil e bordas de período. Nunca global.';

-- ---------------------------------------------------------------------------
-- O alicerce da RLS.
--
-- Toda tabela de negócio ganha `clinica_id NOT NULL` e uma policy que compara
-- com esta função. O middleware da API faz `SET LOCAL app.clinica_id = …` no
-- começo de cada transação.
--
-- `true` no segundo argumento de current_setting: devolve NULL em vez de
-- lançar quando a variável não foi definida. Com NULL, a comparação
-- `clinica_id = NULL` é falsa, e a consulta não devolve nada — que é o modo de
-- falha certo. Uma conexão que esqueceu de fixar a clínica vê um banco vazio,
-- não o banco inteiro.
-- ---------------------------------------------------------------------------
CREATE FUNCTION app_clinica_id() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.clinica_id', true), '')::uuid $$;

COMMENT ON FUNCTION app_clinica_id() IS
  'A clínica da transação atual. NULL quando não fixada: a RLS então nega tudo.';

GRANT SELECT ON clinicas TO fir_app;
