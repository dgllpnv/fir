/**
 * "Concluir e criar nova tarefa": a URL de `/nova` montada a partir da tarefa
 * que acabou de ser concluída. Pré-preenche paciente e campanha e leva a tarefa
 * de ORIGEM (`origem`), que a Nova tarefa devolve como `tarefaOrigemId` — é
 * assim que a cadeia aparece na linha do tempo do fluxo. Tipo, responsável e
 * prazo ficam para quem cria, porque o próximo passo (enviar exame, marcar
 * retorno) raramente é do mesmo tipo. Nenhuma regra de servidor: quem confere
 * se a origem vale (mesmo paciente ou sem paciente) é o servidor.
 */
export function urlDaProximaTarefa(t: {
  readonly id?: string
  readonly pacienteId: string | null
  readonly campanhaId?: string | null
}): string {
  const p = new URLSearchParams()
  if (t.pacienteId !== null) p.set('pacienteId', t.pacienteId)
  if (t.campanhaId !== undefined && t.campanhaId !== null) p.set('campanhaId', t.campanhaId)
  if (t.id !== undefined) p.set('origem', t.id)
  const q = p.toString()
  return q === '' ? '/nova' : `/nova?${q}`
}
