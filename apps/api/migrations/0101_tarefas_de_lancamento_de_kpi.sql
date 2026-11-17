-- ===========================================================================
-- INDICADORES & INSIGHTS, T3 — a tarefa "Lançar [KPI]" (spec I-30, I-31).
--
-- EXPAND puro: uma coluna nula e um CHECK mais largo. Nenhuma linha existente
-- muda, e a versão anterior da API continua escrevendo do mesmo jeito.
-- ===========================================================================
SELECT set_config('app.pessoa_id', 'sistema', true);

-- 1. O marcador `lancamento-kpi:<uuid>` tem 51 caracteres; a 0009 limitou a 40
--    ("fechamento-do-mes", "pessoas-conversas-1a1"). Alargar é compatível:
--    todo valor que passava continua passando.
ALTER TABLE tarefas DROP CONSTRAINT tarefas_marcador_check;
ALTER TABLE tarefas ADD CONSTRAINT tarefas_marcador_check CHECK (length(marcador) <= 60);

-- 2. A REFERÊNCIA do lançamento que a tarefa pede (a segunda ou o dia 1º).
--    Coluna, e não derivada do prazo: a recepção pode adiar a tarefa para a
--    semana seguinte, e o lançamento continua sendo o da semana dela — derivar
--    do prazo editado lançaria a semana errada, ou uma futura.
--
--    Sem CHECK ligando-a a `kpi_id`: arquivar KPI não apaga nada, e a
--    referência é só um dado da tarefa. A unicidade por período já vem do
--    índice `tarefa_de_rotina (clinica_id, marcador, prazo)` da 0009 — os
--    prazos de um KPI são estritamente crescentes (`lancamentosAGerar`).
ALTER TABLE tarefas ADD COLUMN kpi_referencia date;

CREATE INDEX tarefas_de_lancamento_abertas ON tarefas (clinica_id, kpi_id, kpi_referencia)
  WHERE kpi_referencia IS NOT NULL AND status = 'aberta' AND excluida_em IS NULL;

COMMENT ON COLUMN tarefas.kpi_referencia IS
  'Só na tarefa "Lançar [KPI]" (marcador lancamento-kpi:<id>, escrito SÓ pelo servidor): '
  'a referência do período que o PUT …/lancamentos/:referencia conclui.';
