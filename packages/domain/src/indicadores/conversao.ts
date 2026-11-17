import { percentualInteiro } from '../financeiro/visao-do-mes'

/**
 * Conversão de orçamentos: fechados ÷ enviados, em percentual inteiro, com o
 * limite de 100 do Painel (números c.1).
 *
 * O limite existe porque o fechamento da janela pode ser de um orçamento
 * enviado ANTES dela — um mês com 3 enviados e 4 fechados daria 133%. É a
 * regra do Painel (`painel.service.ts`), e mora aqui para o Painel e o KPI
 * usarem a mesma: reaplicar o `Math.min` no KPI seria uma segunda regra.
 * Sem envio, `null`.
 */
export function conversaoDeOrcamentos(enviados: number, fechados: number): number | null {
  if (!Number.isInteger(enviados) || !Number.isInteger(fechados) || enviados < 0 || fechados < 0) {
    throw new Error(`conversaoDeOrcamentos: contagens inteiras e não negativas (${enviados}, ${fechados})`)
  }
  if (enviados === 0) return null
  return Math.min(100, percentualInteiro(BigInt(fechados), BigInt(enviados)) ?? 0)
}
