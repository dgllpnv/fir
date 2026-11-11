-- ===========================================================================
-- Etiqueta de contrato na tarefa interna (decisão P-16, migração do Supabase).
--
-- As tarefas de checklist por contrato que vêm da carteira anterior carregam o
-- código do contrato (`contrato`). Não existe tabela espelho para o modelo de
-- programas por contrato e não vamos recriá-lo: o código vira uma etiqueta de
-- texto curto na própria tarefa, sem tocar em título nem em descrição.
--
-- Forward-only, EXPAND: uma coluna nova, anulável, sem default. Nenhuma linha
-- existente muda e nenhuma política, gatilho ou grant é alterado (o grant de
-- tabela de `fir_carteira` já cobre a coluna nova).
-- ===========================================================================

ALTER TABLE tarefas_internas
  ADD COLUMN contrato text CHECK (length(btrim(contrato)) BETWEEN 1 AND 80);

COMMENT ON COLUMN tarefas_internas.contrato IS
  'Etiqueta do contrato de origem (texto curto, só de leitura/filtro). Vem da '
  'migração da carteira anterior (P-16); NULL em toda tarefa criada aqui.';
