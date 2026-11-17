-- ===========================================================================
-- OS NOMES DOS STATUS DO MEDX (spec `docs/specs/integracao-medx.md` B.8, D.2;
-- ticket T6).
--
-- O superadmin escolhe quais status do MedX significam "cancelado". Para
-- escolher pelo NOME, e não pelo número, o "Testar conexão" lê
-- `GET /agenda/catalogos` e guarda aqui só `[{id, nome}]` dos status. É
-- catálogo da conta, sem paciente: o worker grava, o painel lê, o balcão não.
-- ===========================================================================
SELECT set_config('app.pessoa_id', 'sistema', true);

ALTER TABLE integracoes_da_clinica
  ADD COLUMN catalogo_de_status jsonb NOT NULL DEFAULT '[]'
    CHECK (jsonb_typeof(catalogo_de_status) = 'array' AND jsonb_array_length(catalogo_de_status) <= 50);

GRANT SELECT (catalogo_de_status) ON integracoes_da_clinica TO fir_painel;
GRANT UPDATE (catalogo_de_status) ON integracoes_da_clinica TO fir_integracoes;
