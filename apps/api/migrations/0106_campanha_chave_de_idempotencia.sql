-- ===========================================================================
-- INDICADORES & INSIGHTS, T9 — "Criar campanha com esta lista" idempotente
-- também no destino `nova` (spec I-42; appsec C21).
--
-- O ticket chamava esta migration de 0102; a 0102 foi tomada pelo T4. O
-- conteúdo é o do ticket.
--
-- O índice `tarefa_viva_da_campanha` (0020) já impede a mesma tarefa duas
-- vezes, mas não a CAMPANHA: um duplo clique em "nova" criaria duas campanhas,
-- cada uma com a lista inteira. A tela gera um uuid ao abrir o formulário e o
-- manda no cabeçalho `Idempotency-Key`; a repetição devolve a mesma campanha.
--
-- EXPAND puro: uma coluna anulável e uma UNIQUE. Toda campanha existente fica
-- com NULL, e NULL não colide com NULL num UNIQUE — a versão anterior da API
-- continua criando campanha sem a chave.
-- ===========================================================================
SELECT set_config('app.pessoa_id', 'sistema', true);

ALTER TABLE campanhas ADD COLUMN chave_de_idempotencia uuid NULL;

-- `(clinica_id, chave)` e não só a chave: a mesma chave em duas clínicas são
-- duas campanhas, e a recusa nunca diz a uma clínica que a outra existe.
ALTER TABLE campanhas
  ADD CONSTRAINT campanha_por_chave_de_idempotencia UNIQUE (clinica_id, chave_de_idempotencia);

COMMENT ON COLUMN campanhas.chave_de_idempotencia IS
  'O Idempotency-Key de "Criar campanha com esta lista" (T9, appsec C21). '
  'NULL nas campanhas criadas pelo formulário comum.';
