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

/** O que do clique importa para decidir a tela cheia. */
export type GestoDoClique = {
  readonly button: number
  readonly ctrlKey: boolean
  readonly metaKey: boolean
  readonly shiftKey: boolean
  readonly altKey: boolean
}

/**
 * **"Modo reunião" já abre em tela cheia** (spec I-43; validação G.3).
 *
 * O navegador só concede `requestFullscreen` DENTRO de um gesto da pessoa: na
 * página da reunião, depois da navegação, o pedido seria recusado. Por isso
 * o pedido sai no clique do botão, e a navegação é do lado do cliente (o
 * `Link`), que preserva a tela cheia — um `<a>` comum recarregaria a página e
 * a perderia.
 *
 * Clique com Ctrl/Cmd/Shift/Alt ou com o botão do meio abre outra aba ou
 * janela: ali a tela cheia não é desta, e não se pede. A recusa do navegador
 * é ignorada (a reunião abre igual, com o botão "Tela cheia" à vista), e o
 * iPhone, que não tem a API no documento, simplesmente não a ganha.
 * Devolve se pediu.
 */
export function pedirTelaCheia(
  gesto: GestoDoClique,
  raiz: { readonly requestFullscreen?: () => Promise<void> },
  emTelaCheia: unknown,
): boolean {
  if (gesto.button !== 0 || gesto.ctrlKey || gesto.metaKey || gesto.shiftKey || gesto.altKey) return false
  if (emTelaCheia !== null && emTelaCheia !== undefined) return false
  if (typeof raiz.requestFullscreen !== 'function') return false
  try {
    raiz.requestFullscreen().catch(() => undefined)
  } catch {
    // Navegador antigo que lança em vez de rejeitar: a reunião abre igual.
  }
  return true
}

/**
 * **Em tela cheia, o Esc é do navegador**: ele sai da tela cheia e a página
 * nem recebe a tecla. Para o Esc continuar fazendo o que a spec diz — sair do
 * Modo reunião —, a tela cheia que caiu SEM o botão "Sair da tela cheia" é
 * lida como o Esc (ou o gesto de voltar, no celular), e a reunião fecha.
 */
export const saiuDaTelaCheiaPeloEsc = (estavaEmTelaCheia: boolean, estaEmTelaCheia: boolean, peloBotao: boolean): boolean =>
  estavaEmTelaCheia && !estaEmTelaCheia && !peloBotao
