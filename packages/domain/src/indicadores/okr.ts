import { diasEntre, ehDiaDoCalendario, fimDoMes, somarDias } from '../relogio'
import { erro, erroDe, ok, type Result } from '../resultado'
import type { SituacaoDaMeta } from './meta'
import { ESCALA_DA_UNIDADE, NumeroDoKpi } from './unidades'

/**
 * OKR: progresso, situação e ordem (CONTEXT.md, `OKR`).
 *
 * O progresso do OKR é a média, meio para cima, dos progressos **inteiros
 * exibidos** dos KRs (números c.12): quem soma a tela chega ao número.
 * 10,5 / 10,5 / 10,4 aparecem como 11 / 11 / 10, e a média deles é 11 — a
 * média exata daria 10, e a tela contradiria a própria conta.
 */
export function progressoDoOkr(progressosExibidos: readonly (number | null)[]): number | null {
  const xs = progressosExibidos.filter((p): p is number => p !== null)
  for (const p of xs) {
    if (!Number.isInteger(p) || p < 0 || p > 100) {
      throw new Error(`progressoDoOkr: progresso exibido é inteiro de 0 a 100, recebeu ${p}`)
    }
  }
  if (xs.length === 0) return null
  const soma = xs.reduce((s, p) => s + p, 0)
  return Math.floor((2 * soma + xs.length) / (2 * xs.length))
}

/** Da pior para a melhor. `sem_dado` não piora nem melhora: só vale quando é tudo o que há. */
const ORDEM: readonly SituacaoDaMeta[] = ['abaixo', 'atencao', 'no_ritmo', 'atingida']

/** A situação do OKR é a PIOR entre os KRs. */
export function situacaoDoOkr(situacoes: readonly SituacaoDaMeta[]): SituacaoDaMeta {
  const comDado: readonly SituacaoDaMeta[] = situacoes.filter((s) => s !== 'sem_dado')
  if (comDado.length === 0) return 'sem_dado'
  return ORDEM.find((s) => comDado.includes(s)) ?? 'sem_dado'
}

/** A lista vai do menor progresso para o maior; sem progresso vai para o fim; empate pelo objetivo. */
export function ordenarOkrs<T extends { readonly progresso: number | null; readonly objetivo: string }>(
  okrs: readonly T[],
): T[] {
  return [...okrs].sort((a, b) => {
    if (a.progresso === null && b.progresso === null) return a.objetivo.localeCompare(b.objetivo, 'pt-BR')
    if (a.progresso === null) return 1
    if (b.progresso === null) return -1
    return a.progresso - b.progresso || a.objetivo.localeCompare(b.objetivo, 'pt-BR')
  })
}

// ---------------------------------------------------------------------------
// Período do OKR (spec E.2): trimestre civil por padrão, ou datas livres.
// ---------------------------------------------------------------------------

export const TIPOS_DE_PERIODO_DO_OKR = ['trimestre', 'datas'] as const
export type TipoDePeriodoDoOkr = (typeof TIPOS_DE_PERIODO_DO_OKR)[number]

/** `fim` inclusivo, como o prazo da meta: o dia que a pessoa vê. */
export type PeriodoDoOkr = { readonly tipo: TipoDePeriodoDoOkr; readonly inicio: string; readonly fim: string }

export type PeriodoPedido =
  | { readonly tipo: 'trimestre'; readonly inicio?: string | undefined }
  | { readonly tipo: 'datas'; readonly inicio: string; readonly fim: string }

/** O trimestre civil (jan–mar, abr–jun, jul–set, out–dez) que contém o dia. */
export function trimestreDe(dia: string): PeriodoDoOkr {
  const ano = dia.slice(0, 4)
  const mes = Number(dia.slice(5, 7))
  const primeiro = Math.floor((mes - 1) / 3) * 3 + 1
  const mm = (m: number) => String(m).padStart(2, '0')
  return { tipo: 'trimestre', inicio: `${ano}-${mm(primeiro)}-01`, fim: fimDoMes(`${ano}-${mm(primeiro + 2)}`) }
}

/**
 * O período pedido, resolvido. Sem nada: o trimestre de `hoje` — e `hoje` é
 * do servidor, no fuso da clínica (regra 24). Trimestre com início só no 1º
 * dia de um trimestre: outro dia não é "o trimestre", é "datas".
 */
export function periodoDoOkr(pedido: PeriodoPedido | undefined, hoje: string): Result<PeriodoDoOkr> {
  if (pedido === undefined) return ok(trimestreDe(hoje))
  if (pedido.tipo === 'trimestre') {
    if (pedido.inicio === undefined) return ok(trimestreDe(hoje))
    const t = trimestreDe(pedido.inicio)
    if (!ehDiaDoCalendario(pedido.inicio) || t.inicio !== pedido.inicio) {
      return erro(erroDe('TrimestreForaDoInicio', 'O trimestre começa em 1º de janeiro, abril, julho ou outubro.'))
    }
    return ok(t)
  }
  if (!ehDiaDoCalendario(pedido.inicio) || !ehDiaDoCalendario(pedido.fim)) {
    return erro(erroDe('DataInvalida', 'Escolha datas que existem no calendário.'))
  }
  if (pedido.fim < pedido.inicio) return erro(erroDe('FimAntesDoInicio', 'O fim é antes do início.'))
  return ok({ tipo: 'datas', inicio: pedido.inicio, fim: pedido.fim })
}

/** Duplicar: o trimestre seguinte; datas livres começam no dia seguinte ao fim, com a mesma duração. */
export function proximoPeriodoDoOkr(p: PeriodoDoOkr): PeriodoDoOkr {
  const inicio = somarDias(p.fim, 1)
  if (p.tipo === 'trimestre') return trimestreDe(inicio)
  return { tipo: 'datas', inicio, fim: somarDias(inicio, diasEntre(p.inicio, p.fim)) }
}

/**
 * A meta do KR cobre o período do OKR. É "do mês" só quando o período é um mês
 * civil inteiro (o banco exige: `meta_do_mes_e_mes_inteiro`); no resto, "até a
 * data". O KPI que só aceita mês civil (`resultado_do_mes`) recusa a segunda
 * em `validarMeta`.
 */
export function tipoDaMetaDoKr(p: Pick<PeriodoDoOkr, 'inicio' | 'fim'>): 'mes' | 'ate_data' {
  return p.inicio.endsWith('-01') && p.fim === fimDoMes(p.inicio.slice(0, 7)) ? 'mes' : 'ate_data'
}

// ---------------------------------------------------------------------------
// Resultados-chave (spec E.2)
// ---------------------------------------------------------------------------

export const MINIMO_DE_KRS = 1
export const MAXIMO_DE_KRS = 5

/** De 1 a 5 KRs vivos, e o mesmo KPI não aparece duas vezes no mesmo OKR. O banco confere de novo (0102). */
export function validarKrsDoOkr(kpiIds: readonly string[]): Result<readonly string[]> {
  if (kpiIds.length < MINIMO_DE_KRS || kpiIds.length > MAXIMO_DE_KRS) {
    return erro(erroDe('QuantidadeDeKrs', 'Um OKR tem de 1 a 5 resultados-chave.'))
  }
  if (new Set(kpiIds).size !== kpiIds.length) {
    return erro(erroDe('KpiRepetidoNoOkr', 'O mesmo indicador aparece duas vezes neste OKR.'))
  }
  return ok(kpiIds)
}

/** A tela avisa acima de 4: cinco já é o teto, e foco é o ponto do OKR. */
export const avisoDeKrs = (quantidade: number): boolean => quantidade > 4

/**
 * O alvo do KR de campanha é a META DA CAMPANHA, travado (I-27): a campanha
 * guarda um inteiro na escala da métrica — centavos em `receita`, contagem
 * nas outras (0020) —, e o KPI conta na escala da quantidade (centésimos).
 */
export function alvoDaCampanha(metrica: string, meta: bigint): NumeroDoKpi {
  if (metrica === 'receita') return NumeroDoKpi.de('reais', meta)
  return NumeroDoKpi.de('quantidade', meta * ESCALA_DA_UNIDADE.quantidade.porUnidade)
}
