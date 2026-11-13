/**
 * "Concluir e criar nova tarefa": a URL de `/nova` montada a partir da tarefa
 * que acabou de ser concluída. Só pré-preenche (paciente e campanha); tipo,
 * responsável e prazo ficam para quem cria, porque o próximo passo (enviar
 * exame, marcar retorno) raramente é do mesmo tipo. Nenhuma regra de servidor.
 */
export function urlDaProximaTarefa(t: {
  readonly pacienteId: string | null
  readonly campanhaId?: string | null
}): string {
  const p = new URLSearchParams()
  if (t.pacienteId !== null) p.set('pacienteId', t.pacienteId)
  if (t.campanhaId !== undefined && t.campanhaId !== null) p.set('campanhaId', t.campanhaId)
  const q = p.toString()
  return q === '' ? '/nova' : `/nova?${q}`
}
