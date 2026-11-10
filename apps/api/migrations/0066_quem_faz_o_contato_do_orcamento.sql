-- ===========================================================================
-- "QUEM FAZ O CONTATO" DA RETOMADA DE ORÇAMENTO (pedido da cliente, 2026-11-10).
-- Divergência de produto aprovada pelo dono: o protótipo só conhece
-- responsável e solicitante da consulta. Ver docs/adr/2026-11-10-quem-faz-o-contato.md
--
-- Forward-only, EXPAND puro: coluna anulável. Sem o campo vale o
-- comportamento anterior.
-- ===========================================================================

-- A FK composta precisa desta chave (a checagem de FK ignora a RLS: uma FK
-- simples por `id` aceitaria a pessoa da clínica vizinha). `id` já é único,
-- então a restrição não altera nenhum dado.
ALTER TABLE pessoas ADD CONSTRAINT pessoas_id_clinica UNIQUE (id, clinica_id);

ALTER TABLE tarefas ADD COLUMN contato_id uuid;

ALTER TABLE tarefas ADD CONSTRAINT tarefa_contato_e_pessoa_da_clinica
  FOREIGN KEY (contato_id, clinica_id) REFERENCES pessoas (id, clinica_id)
  ON DELETE SET NULL (contato_id);
