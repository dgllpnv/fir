import type { Dinheiro } from '../dinheiro'
import { somarDias } from '../relogio'
import { percentualInteiro } from './visao-do-mes'

/**
 * **CAIXAS SEM DIFERENÇA, corrigida** (spec I-15; números B3; ADR
 * 2026-11-17-correcao-de-caixas-do-mes). Uma regra só, para a Visão do mês e
 * para o KPI `caixas_sem_diferenca`.
 *
 * Os dois defeitos que esta função fecha:
 *
 * - **Passava de 100%.** `fechados` contava o sábado e o denominador
 *   (`diasUteis`) não: seg a sáb fechados davam 6/5. Agora numerador e
 *   denominador saem do MESMO conjunto de dias: os úteis até ontem, mais hoje
 *   se fechado, mais todo dia não útil com caixa.
 * - **Contava errado como certo.** A diferença era a SOMA por caixa: Pix +R$ 50
 *   com Dinheiro −R$ 50 dava zero. "Sem diferença" é TODA linha de
 *   `caixa_por_forma` com `contado = esperado` (`CONTEXT.md`).
 */
export type LinhaDoCaixa = { readonly contado: Dinheiro; readonly esperado: Dinheiro }
export type CaixaDoPeriodo = { readonly dia: string; readonly linhas: readonly LinhaDoCaixa[] }

export const caixaSemDiferenca = (linhas: readonly LinhaDoCaixa[]): boolean =>
  linhas.every((l) => l.contado.menos(l.esperado).ehZero())

const ehUtil = (dia: string): boolean => {
  const d = new Date(`${dia}T00:00:00Z`).getUTCDay()
  return d >= 1 && d <= 5
}

export type CaixasSemDiferenca = {
  /** O conjunto de dias medido (o denominador). */
  readonly dias: number
  /** Caixas do conjunto com toda forma conferida igual (o numerador). */
  readonly semDiferenca: number
  /** Caixas do conjunto com ALGUMA forma diferente. */
  readonly comDiferenca: number
  /** Inteiro, nunca acima de 100. `null` sem dia no conjunto. */
  readonly percentual: number | null
}

/** `[de, ate]` em dias civis da clínica (inclusivos); `hoje` vem do servidor. */
export function caixasSemDiferenca(
  de: string,
  ate: string,
  hoje: string,
  caixas: readonly CaixaDoPeriodo[],
): CaixasSemDiferenca {
  const porDia = new Map(caixas.map((c) => [c.dia, c]))
  let dias = 0
  let semDiferenca = 0
  let comDiferenca = 0
  for (let d = de; d <= ate && d <= hoje; d = somarDias(d, 1)) {
    const caixa = porDia.get(d)
    const entra = caixa !== undefined || (ehUtil(d) && d < hoje)
    if (!entra) continue
    dias++
    if (caixa === undefined) continue
    if (caixaSemDiferenca(caixa.linhas)) semDiferenca++
    else comDiferenca++
  }
  return { dias, semDiferenca, comDiferenca, percentual: percentualInteiro(BigInt(semDiferenca), BigInt(dias)) }
}
