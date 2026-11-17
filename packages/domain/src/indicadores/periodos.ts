import { percentualInteiro } from '../financeiro/visao-do-mes'
import { diasEntre, ehDiaDoCalendario, fimDoMes, somarDias, somarMeses } from '../relogio'
import { erro, erroDe, ok, type Result } from '../resultado'
import { absoluto } from './aritmetica'
import type { FrequenciaDeKpi } from './catalogo'
import type { NumeroDoKpi } from './unidades'

/**
 * Períodos, baldes, comparação e o corte dos dias que contam.
 *
 * Toda data aqui é DIA CIVIL da clínica (`aaaa-mm-dd`). A conversão para
 * instantes UTC é `janela(de, ate, fuso)` de `relogio.ts`, semiaberta, e é da
 * borda (regras 22 e 23). Nada aqui lê relógio: `hoje` vem do servidor.
 */

const ehUtil = (dia: string): boolean => {
  const d = new Date(`${dia}T00:00:00Z`).getUTCDay()
  return d >= 1 && d <= 5
}

/** Dias úteis (segunda a sexta, sem feriado) de `de` a `ate`, inclusive. A régua de `diasUteisAte`. */
export function diasUteisEntre(de: string, ate: string): number {
  let n = 0
  for (let d = de; d <= ate; d = somarDias(d, 1)) if (ehUtil(d)) n++
  return n
}

/** Dias corridos de `de` a `ate`, inclusive. Zero quando `ate` é anterior. */
export const diasCorridosEntre = (de: string, ate: string): number => Math.max(0, diasEntre(de, ate) + 1)

/** Os dias úteis de um CONJUNTO de dias (o `D` da I-9), dentro de `[de, ate]`. */
export function diasUteisDoConjunto(dias: readonly string[], de: string, ate: string): number {
  return new Set(dias.filter((d) => d >= de && d <= ate && ehUtil(d))).size
}

/** Todos os dias de `de` a `ate`, inclusive. */
export function diasDe(de: string, ate: string): string[] {
  const r: string[] = []
  for (let d = de; d <= ate; d = somarDias(d, 1)) r.push(d)
  return r
}

const mesDe = (dia: string) => dia.slice(0, 7)

// ---------------------------------------------------------------------------
// Janela pedida e agrupamento (I-29)
// ---------------------------------------------------------------------------

/** "De depois de Até" e "Até no futuro" → 422 na borda. */
export function validarJanela(de: string, ate: string, hoje: string): Result<{ de: string; ate: string }> {
  if (!ehDiaDoCalendario(de) || !ehDiaDoCalendario(ate)) {
    return erro(erroDe('JanelaInvalida', 'Escolha datas que existem no calendário.'))
  }
  if (de > ate) return erro(erroDe('JanelaInvertida', 'A data inicial é depois da final.'))
  if (ate > hoje) return erro(erroDe('JanelaNoFuturo', 'Não há dado de dias que ainda não aconteceram.'))
  return ok({ de, ate })
}

export type Agrupamento = 'mes' | 'semana' | 'dia'

/** Mais de um mês civil → `mes`; dentro do mês, KPI semanal → `semana`, os outros → `dia`. */
export function agrupamentoPara(de: string, ate: string, frequencia: FrequenciaDeKpi): Agrupamento {
  if (mesDe(de) !== mesDe(ate)) return 'mes'
  return frequencia === 'semanal' ? 'semana' : 'dia'
}

/** Um balde: `[inicio, fim)` em dias civis. `parcial` = alcança hoje ou o depois de hoje. */
export type Balde = { readonly inicio: string; readonly fim: string; readonly parcial: boolean }

const segundaDa = (dia: string): string => {
  const d = new Date(`${dia}T00:00:00Z`).getUTCDay()
  return somarDias(dia, d === 0 ? -6 : 1 - d)
}

/** Os baldes da janela `[de, ate]` (inclusiva, como a tela pede), cortados nas bordas. */
export function baldes(de: string, ate: string, agrupamento: Agrupamento, hoje: string): Balde[] {
  const fimDaJanela = somarDias(ate, 1)
  const r: Balde[] = []
  let inicio = de
  while (inicio < fimDaJanela) {
    const proximo =
      agrupamento === 'dia'
        ? somarDias(inicio, 1)
        : agrupamento === 'semana'
          ? somarDias(segundaDa(inicio), 7)
          : somarDias(fimDoMes(mesDe(inicio)), 1)
    const fim = proximo < fimDaJanela ? proximo : fimDaJanela
    const periodoInteiro = agrupamento === 'mes' ? somarDias(fimDoMes(mesDe(inicio)), 1) : proximo
    r.push({ inicio, fim, parcial: periodoInteiro > hoje })
    inicio = fim
  }
  return r
}

/** Os `n` meses que terminam no mês de `hoje`, do mais antigo para o atual. */
export function mesesDaSerie(hoje: string, n: number): string[] {
  const atual = `${mesDe(hoje)}-01`
  return Array.from({ length: n }, (_, i) => mesDe(somarMeses(atual, i - (n - 1))))
}

// ---------------------------------------------------------------------------
// Comparação (I-28)
// ---------------------------------------------------------------------------

/**
 * Os dias do período anterior comparáveis ao conjunto `dias` (o `D` da I-9,
 * números B1 — nunca o prefixo até o corte).
 *
 * - **Mensal:** os mesmos NÚMEROS de dia, no mês anterior, até o fim dele.
 *   Propriedade (números c.8): com `D` = 1..k, `|anterior| = min(k, dias do
 *   mês anterior)`. 30/03 e 31/03 → até 28/02 em 2027 e 29/02 em 2028.
 * - **Semanal:** o mesmo dia da semana anterior.
 */
export function janelaComparavel(dias: readonly string[], frequencia: FrequenciaDeKpi): string[] {
  const r = new Set<string>()
  for (const d of dias) {
    if (frequencia === 'semanal') {
      r.add(somarDias(d, -7))
      continue
    }
    const anterior = mesDe(somarMeses(`${mesDe(d)}-01`, -1))
    const ultimo = fimDoMes(anterior)
    const candidato = `${anterior}-${d.slice(8, 10)}`
    if (candidato <= ultimo) r.add(candidato)
  }
  return [...r].sort()
}

/**
 * A variação contra o período anterior: percentual em pontos (centésimos de
 * p.p.), as outras unidades em variação relativa inteira; anterior zero é
 * "novo". `null` quando um dos dois não tem dado.
 */
export type Variacao =
  | { readonly tipo: 'pontos'; readonly emCentesimos: bigint }
  | { readonly tipo: 'relativa'; readonly percentual: number }
  | { readonly tipo: 'novo' }

export function variacao(atual: NumeroDoKpi | null, anterior: NumeroDoKpi | null): Variacao | null {
  if (atual === null || anterior === null) return null
  const diferenca = atual.menos(anterior).emMenorUnidade
  if (atual.unidade === 'percentual') return { tipo: 'pontos', emCentesimos: diferenca }
  if (anterior.emMenorUnidade === 0n) return { tipo: 'novo' }
  return { tipo: 'relativa', percentual: percentualInteiro(diferenca, absoluto(anterior.emMenorUnidade))! }
}

// ---------------------------------------------------------------------------
// Lançamento de KPI manual (I-30)
// ---------------------------------------------------------------------------

/** A referência do período que contém `dia`: a segunda (semanal) ou o dia 1º (mensal). */
export function referenciaDoPeriodo(frequencia: FrequenciaDeKpi, dia: string): string {
  return frequencia === 'semanal' ? segundaDa(dia) : `${mesDe(dia)}-01`
}

/** A referência que está aberta hoje: a do período corrente. Lançar à frente dela é 422. */
export const referenciaPendente = (frequencia: FrequenciaDeKpi, hoje: string): string =>
  referenciaDoPeriodo(frequencia, hoje)

export const ehReferencia = (frequencia: FrequenciaDeKpi, dia: string): boolean =>
  ehDiaDoCalendario(dia) && referenciaDoPeriodo(frequencia, dia) === dia

/**
 * O prazo da tarefa "Lançar [nome]" da referência. Semanal: o dia 1–7 da
 * semana (1 = segunda). Mensal: o dia 1–31, e o que não existe no mês cai no
 * último dia (regra 25).
 */
export function prazoDoLancamento(
  frequencia: FrequenciaDeKpi,
  referencia: string,
  diaEscolhido: number,
): Result<string> {
  if (!ehReferencia(frequencia, referencia)) {
    return erro(erroDe('ReferenciaInvalida', 'A referência é a segunda-feira da semana ou o dia 1º do mês.'))
  }
  const max = frequencia === 'semanal' ? 7 : 31
  if (!Number.isInteger(diaEscolhido) || diaEscolhido < 1 || diaEscolhido > max) {
    return erro(erroDe('DiaDeLancamentoInvalido', `O dia de lançamento vai de 1 a ${max}.`))
  }
  if (frequencia === 'semanal') return ok(somarDias(referencia, diaEscolhido - 1))
  const ultimo = fimDoMes(mesDe(referencia))
  const dia = `${mesDe(referencia)}-${String(diaEscolhido).padStart(2, '0')}`
  return ok(ehDiaDoCalendario(dia) && dia <= ultimo ? dia : ultimo)
}

// ---------------------------------------------------------------------------
// O regime do dia e o corte do faturamento conferido (I-9, números B1 e B6)
// ---------------------------------------------------------------------------

/**
 * - `anterior`: antes de `conferencia_desde` (ou sem ela), e não é hoje.
 *   Conta todo o recebido — a medida que a Visão do mês sempre teve.
 * - `conferencia`: a partir de `conferencia_desde`, **e hoje em qualquer
 *   regime** (regra 6). Conta só com caixa fechado.
 */
export type RegimeDoDia = 'anterior' | 'conferencia'

export function regimeDoDia(dia: string, conferenciaDesde: string | null, hoje: string): RegimeDoDia {
  if (dia > hoje) throw new Error(`regimeDoDia: ${dia} está depois de hoje (${hoje})`)
  if (dia === hoje) return 'conferencia'
  return conferenciaDesde === null || dia < conferenciaDesde ? 'anterior' : 'conferencia'
}

/** O dia conta para o faturamento conferido? Senão, está aguardando fechamento. */
export const diaConta = (regime: RegimeDoDia, temCaixaFechado: boolean): boolean =>
  regime === 'anterior' || temCaixaFechado

/**
 * O corte de ritmo e projeção (números B1): `L` é o último dia que conta, e
 * `D` são os dias até `L` que contam. Um dia aberto no MEIO fica fora de `D`
 * — e é por isso que os decorridos são os úteis de `D`, nunca os úteis até o
 * primeiro dia aberto.
 */
export type CorteDosDias = { readonly ultimo: string | null; readonly dias: readonly string[] }

export function corteDosDiasQueContam(
  dias: readonly { readonly dia: string; readonly conta: boolean }[],
): CorteDosDias {
  const contam = dias.filter((d) => d.conta).map((d) => d.dia).sort()
  return { ultimo: contam.at(-1) ?? null, dias: contam }
}
