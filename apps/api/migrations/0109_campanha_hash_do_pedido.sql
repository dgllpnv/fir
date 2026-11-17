-- ===========================================================================
-- INDICADORES & INSIGHTS, T9 — revisão appsec, achado M1
-- (docs/specs/indicadores-e-insights-t9-appsec.md).
--
-- A mesma `Idempotency-Key` com OUTRO pedido devolvia a campanha do primeiro
-- e enxertava nela os pacientes da lista nova. Ao lado da chave fica o hash
-- (sha-256, hex) do pedido lido — relatório, filtros, destino e tarefa em JSON
-- canônico. Repetição com o mesmo hash é a mesma campanha; com outro, 422.
--
-- EXPAND puro: uma coluna anulável. As campanhas existentes ficam com NULL, e
-- a 0106 continua como está (pode já estar aplicada).
-- ===========================================================================
SELECT set_config('app.pessoa_id', 'sistema', true);

ALTER TABLE campanhas ADD COLUMN hash_do_pedido text NULL
  CHECK (hash_do_pedido IS NULL OR hash_do_pedido ~ '^[0-9a-f]{64}$');

COMMENT ON COLUMN campanhas.hash_do_pedido IS
  'sha-256 do pedido de "Criar campanha com esta lista" que gravou a chave_de_idempotencia (T9, appsec M1).';
