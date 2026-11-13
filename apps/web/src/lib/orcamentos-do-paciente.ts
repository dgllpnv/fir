import type { SituacaoDoItem, SituacaoDoOrcamento } from '@fir/contracts'

/** Os nomes do selo — os mesmos da faixa da jornada (a UI unificou o selo). */
export const ROTULO_DA_SITUACAO: Readonly<Record<SituacaoDoOrcamento, string>> = {
  aberto: 'Aberto',
  fechado: 'Fechado',
  parcial: 'Orçamento parcialmente fechado',
  perdido: 'Perdido',
}

export const TOM_DA_SITUACAO: Readonly<Record<SituacaoDoOrcamento, string>> = {
  aberto: 'alerta',
  fechado: 'bom',
  parcial: 'alerta',
  perdido: 'mau',
}

/** Marca em TEXTO (nunca só cor) de cada procedimento. `orcado` não leva marca: ainda não foi decidido. */
export const MARCA_DO_ITEM: Readonly<Record<SituacaoDoItem, { sinal: string; texto: string }>> = {
  orcado: { sinal: '·', texto: 'orçado' },
  fechado: { sinal: '✓', texto: 'fechado' },
  nao_fechado: { sinal: '✕', texto: 'não fechado' },
  sem_detalhamento: { sinal: '?', texto: 'sem detalhamento' },
}

/** "fechou X de Y procedimentos" — `null` = fechado antes do detalhamento. */
export function fechouXdeY(fechados: number | null | undefined, total: number | null | undefined): string {
  if (fechados == null || total == null || total === 0) return 'sem detalhamento'
  return `fechou ${fechados} de ${total} ${total === 1 ? 'procedimento' : 'procedimentos'}`
}

/** A ordem das abas da ficha: sem `jornada`, só o Histórico existe. */
export type AbaDaFicha = 'historico' | 'orcamentos'
export const abasDaFicha = (podeJornada: boolean): readonly AbaDaFicha[] =>
  podeJornada ? ['historico', 'orcamentos'] : ['historico']

/** Setas/Home/End nas abas (padrão WAI-ARIA, ativação automática). */
export function proximaAba(
  abas: readonly AbaDaFicha[],
  atual: AbaDaFicha,
  tecla: string,
): AbaDaFicha | null {
  const i = abas.indexOf(atual)
  if (i < 0) return null
  if (tecla === 'ArrowRight') return abas[(i + 1) % abas.length] ?? null
  if (tecla === 'ArrowLeft') return abas[(i - 1 + abas.length) % abas.length] ?? null
  if (tecla === 'Home') return abas[0] ?? null
  if (tecla === 'End') return abas[abas.length - 1] ?? null
  return null
}
