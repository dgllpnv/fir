-- ---------------------------------------------------------------------------
-- `tentativas_de_carteira` — limite de tentativas de login, própria da
-- carteira. Mesma forma de `tentativas_de_operador` (0013).
--
-- NÃO reusa `tentativas_login` (0002): aquela é por CLÍNICA
-- (`clinica_id NOT NULL`, RLS por `app_clinica_id()`), e `fir_carteira` não
-- tem acesso a ela nem deveria — o `Usuário de Gestão` não pertence a
-- clínica nenhuma, mesma razão de `operadores`/`tentativas_de_operador`.
-- ---------------------------------------------------------------------------

CREATE TABLE tentativas_de_carteira (
  id            bigserial PRIMARY KEY,
  identificador text NOT NULL,
  em            timestamptz NOT NULL DEFAULT now(),
  sucesso       boolean NOT NULL
);
CREATE INDEX tentativas_de_carteira_recentes ON tentativas_de_carteira (identificador, em DESC);

REVOKE ALL ON tentativas_de_carteira FROM fir_app;
GRANT SELECT, INSERT ON tentativas_de_carteira TO fir_carteira;
GRANT USAGE, SELECT ON SEQUENCE tentativas_de_carteira_id_seq TO fir_carteira;
