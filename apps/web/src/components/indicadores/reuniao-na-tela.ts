import type { KpiNaReuniao, ReuniaoDeIndicadores } from '@fir/contracts'
import { diaEMes, emAtencao, ordenarPorSituacao, situacaoDoCartao } from './na-tela'

/**
 * **O Modo reunião, como sequência de slides** (backlog 1.9 F).
 *
 * Ordem: (1) a capa; (2) um slide por OKR ativo, na ordem do servidor (o
 * mais atrasado primeiro); (3) um slide por KPI de saúde em vermelho ou
 * amarelo, o vermelho antes; (4) "Planos de ação da semana".
 *
 * Aqui só se ESCOLHE e se ORDENA o que o servidor mandou. A situação de cada
 * meta chega pronta, e o número da capa também (`capa.prioridades`, revisão
 * P1): é o MESMO objeto da faixa "Prioridades do trimestre", então a tela e a
 * TV dão o mesmo número na mesma semana.
 */
type OkrNaReuniao = ReuniaoDeIndicadores['okrs'][number]

export type Slide =
  | { readonly tipo: 'capa' }
  | { readonly tipo: 'okr'; readonly okr: OkrNaReuniao }
  | { readonly tipo: 'kpi'; readonly kpi: KpiNaReuniao }
  | { readonly tipo: 'planos' }

export function slidesDaReuniao(r: ReuniaoDeIndicadores): Slide[] {
  const kpis = ordenarPorSituacao(r.saude.filter((k) => emAtencao(situacaoDoCartao(k.metaVigente))))
  return [
    { tipo: 'capa' },
    ...r.okrs.map((okr): Slide => ({ tipo: 'okr', okr })),
    ...kpis.map((kpi): Slide => ({ tipo: 'kpi', kpi })),
    { tipo: 'planos' },
  ]
}

/** "Semana de 16/11 a 22/11" — a semana que o servidor mediu, no fuso da clínica. */
export const textoDaSemana = (s: ReuniaoDeIndicadores['semana']): string => `Semana de ${diaEMes(s.de)} a ${diaEMes(s.ate)}`

/**
 * O resumo da capa: "3 OKRs · 62% · 2 metas em vermelho". O servidor manda só
 * contagens (appsec C8) — nenhuma frase pronta —, e a frase nasce aqui. Sem
 * dinheiro: nada nela vem de um `ValorNaTela`.
 */
export function resumoDaCapa(r: Pick<ReuniaoDeIndicadores, 'capa'>): string {
  const partes: string[] = []
  // Sem `prioridades` (servidor antigo), a contagem dos slides e nenhuma média:
  // a média não se refaz aqui.
  const n = r.capa.prioridades?.quantos ?? r.capa.okrsAtivos
  partes.push(`${n} ${n === 1 ? 'OKR' : 'OKRs'}`)
  const media = r.capa.prioridades?.media ?? null
  if (media !== null) partes.push(`${media}%`)
  const v = r.capa.abaixo
  partes.push(v === 0 ? 'nenhuma meta em vermelho' : `${v} ${v === 1 ? 'meta em vermelho' : 'metas em vermelho'}`)
  return partes.join(' · ')
}

export const ROTULO_DO_STATUS_DO_PLANO: Readonly<Record<ReuniaoDeIndicadores['planosDeAcao'][number]['status'], string>> = {
  aberta: 'Aberta',
  concluida: 'Concluída',
  cancelada: 'Cancelada',
}

/** O título que o leitor de tela anuncia e que o contador acompanha. */
export function tituloDoSlide(s: Slide): string {
  switch (s.tipo) {
    case 'capa':
      return 'Capa'
    case 'okr':
      return s.okr.objetivo
    case 'kpi':
      return s.kpi.nome
    case 'planos':
      return 'Planos de ação da semana'
  }
}

/** O próximo índice, preso às pontas: a seta no último slide não volta à capa. */
export const indiceVizinho = (atual: number, total: number, passo: -1 | 1): number =>
  Math.min(Math.max(atual + passo, 0), Math.max(total - 1, 0))
