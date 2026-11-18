import type { CampanhaDaListaCriada } from '@fir/contracts'

/**
 * **Depois de "Criar campanha com esta lista", a tela vai para a campanha**
 * (spec I-42, T9). O id é o que o servidor devolveu — a campanha nova ou a
 * escolhida —, e as duas contagens seguem na URL só para a campanha confirmar
 * o que aconteceu: são números, nunca nome de paciente nem filtro.
 *
 * Módulo sem React: a página da campanha (componente de servidor) lê as
 * contagens daqui, e o formulário (cliente) monta o endereço daqui.
 */
export function enderecoDaCampanhaCriada(r: Pick<CampanhaDaListaCriada, 'campanhaId' | 'criadas' | 'ignoradas'>): string {
  const q = new URLSearchParams({ criadas: String(r.criadas), ignoradas: String(r.ignoradas) })
  return `/campanhas/${encodeURIComponent(r.campanhaId)}?${q.toString()}`
}

const plural = (n: number, um: string, varios: string): string => `${n.toLocaleString('pt-BR')} ${n === 1 ? um : varios}`

/** O texto do resultado. `campanha` vazio quando a tela já é a da campanha. */
export function textoDoResultado(r: Pick<CampanhaDaListaCriada, 'criadas' | 'ignoradas'>, campanha: string): string {
  const onde = campanha === '' ? 'na campanha' : `em "${campanha}"`
  const criadas = `${plural(r.criadas, 'tarefa criada', 'tarefas criadas')} ${onde}`
  return r.ignoradas === 0
    ? `${criadas}.`
    : `${criadas}. ${plural(r.ignoradas, 'paciente já tinha', 'pacientes já tinham')} a tarefa aberta e ${r.ignoradas === 1 ? 'ficou' : 'ficaram'} de fora.`
}

const CONTAGEM = /^\d{1,6}$/

/** O recado que a campanha mostra ao chegar da lista; `null` sem as contagens, ou com lixo na URL. */
export function recadoDaCampanhaCriada(q: Readonly<Record<string, string | string[] | undefined>>): string | null {
  const criadas = q['criadas']
  const ignoradas = q['ignoradas']
  if (typeof criadas !== 'string' || typeof ignoradas !== 'string') return null
  if (!CONTAGEM.test(criadas) || !CONTAGEM.test(ignoradas)) return null
  return textoDoResultado({ criadas: Number(criadas), ignoradas: Number(ignoradas) }, '')
}
