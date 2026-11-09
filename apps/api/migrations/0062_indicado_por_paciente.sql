-- ===========================================================================
-- CORREÇÕES DA PO, B2 — "INDICADO POR" LIGA A UMA PACIENTE CADASTRADA.
-- Spec `docs/specs/correcoes-po-2026-11-09.md` (B2); gates appsec S-31 a S-36,
-- LGPD L-B2-2 e L-B2-3.
--
-- Forward-only, EXPAND puro: uma coluna nova, anulável, e as restrições dela.
-- `indicado_por` (texto) continua: é para quem indicou SEM ser paciente e para
-- o dado migrado da v20. Nada aqui casa o texto antigo com pacientes pelo
-- nome (L-B2-4): homônimo viraria relação falsa entre duas titulares.
-- ===========================================================================

ALTER TABLE pacientes ADD COLUMN indicado_por_id uuid;

/**
 * **A FK é COMPOSTA, e o `SET NULL` diz QUAL coluna anular.**
 *
 * Composta porque a checagem de FK ignora a RLS (S-31): uma FK simples por
 * `id` aceitaria a paciente da clínica vizinha como indicadora. A ordem
 * `(id, clinica_id)` é a da chave única `pacientes_id_clinica` (0010).
 *
 * `ON DELETE SET NULL (indicado_por_id)` e NÃO `SET NULL` puro (S-32,
 * L-B2-2): o puro anula as DUAS colunas da chave, inclusive `clinica_id NOT
 * NULL`, e o `DELETE` da indicadora falharia. Em produção paciente se
 * desativa e não se apaga (ADR 0003); o `DELETE` existe na limpeza da clínica
 * de teste e existirá no job de purga, e é ali que este detalhe morde.
 */
ALTER TABLE pacientes ADD CONSTRAINT paciente_indicada_por_paciente_da_clinica
  FOREIGN KEY (indicado_por_id, clinica_id) REFERENCES pacientes (id, clinica_id)
  ON DELETE SET NULL (indicado_por_id);

-- Ninguém indica a si mesma (S-33). O domínio também recusa; o banco é a
-- camada que não se esquece.
ALTER TABLE pacientes ADD CONSTRAINT paciente_nao_indica_a_si_mesma
  CHECK (indicado_por_id IS DISTINCT FROM id);

/**
 * **Um nome, um lugar** (L-B2-3). Com a indicadora ligada pelo id, o texto
 * fica vazio. Sem isto o nome dela sobreviveria em texto na linha da
 * indicada depois de ela ser anonimizada, e a eliminação ficaria incompleta
 * sem que ninguém percebesse.
 */
ALTER TABLE pacientes ADD CONSTRAINT paciente_indicada_sem_nome_em_texto
  CHECK (indicado_por_id IS NULL OR indicado_por = '');

-- O "Quem mais indica" do Painel agrupa por aqui, e o `SET NULL` da FK
-- procura por aqui.
CREATE INDEX pacientes_por_indicadora ON pacientes (clinica_id, indicado_por_id)
  WHERE indicado_por_id IS NOT NULL;
