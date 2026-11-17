import { percentualInteiro } from '../financeiro/visao-do-mes'

/**
 * Conversas 1:1 em dia (I-14): fichas ativas no fim do mês com conversa no
 * mês ÷ fichas ativas no fim do mês, em percentual inteiro. A conversa de uma
 * ficha que não está ativa no fim do mês não entra no numerador, senão a
 * razão passaria de 100%. Sem ficha ativa, `null`: não há equipe para medir.
 */
export function umAUmEmDia(
  fichasAtivasNoFimDoMes: readonly string[],
  fichasComConversaNoMes: readonly string[],
): number | null {
  const ativas = new Set(fichasAtivasNoFimDoMes)
  const comConversa = new Set(fichasComConversaNoMes.filter((f) => ativas.has(f)))
  return percentualInteiro(BigInt(comConversa.size), BigInt(ativas.size))
}
