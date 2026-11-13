import { diaCurto } from './formato'
import { fechouXdeY } from './orcamentos-do-paciente'

/** "retomar 24/10", com "(atrasado)" quando o dia já passou; `''` sem data. */
export function textoDeRetomar(proximoPassoEm: string | null, hoje: string): string {
  if (proximoPassoEm === null) return ''
  return `retomar ${diaCurto(proximoPassoEm)}${proximoPassoEm < hoje ? ' (atrasado)' : ''}`
}

/** As linhas do mini-cartão da coluna "Orçamento parcialmente fechado". */
export function linhasDoParcial(
  x: { itensFechados?: number | null | undefined; itensTotal?: number | null | undefined; proximoPassoEm: string | null },
  hoje: string,
): { fechou: string; retomar: string } {
  return { fechou: fechouXdeY(x.itensFechados, x.itensTotal), retomar: textoDeRetomar(x.proximoPassoEm, hoje) }
}
