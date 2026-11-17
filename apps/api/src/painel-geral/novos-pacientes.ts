/**
 * **"PACIENTE NOVO" — escrito uma vez**, para a tabela "Novos pacientes" do
 * Painel e para o KPI `novos_pacientes` (spec I-7: mover, nunca copiar).
 *
 * Cadastro em `[$2, $3)` e paciente ativo, na clínica `$1`. Pressupõe
 * `pacientes` como `pa`.
 */
export const PACIENTE_NOVO_NA_JANELA = `pa.clinica_id = $1 AND pa.ativo AND pa.criado_em >= $2 AND pa.criado_em < $3`

/** O rótulo da origem: a linha do Painel e o filtro `origem` do KPI. */
export const ORIGEM_DO_PACIENTE = `CASE WHEN pa.origem = '' THEN 'Não informada' ELSE pa.origem END`
