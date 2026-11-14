import { diaCurto } from './formato'
import { fechouXdeY } from './orcamentos-do-paciente'

/** "retomar 24/10", com "(atrasado)" quando o dia já passou; `''` sem data. */
export function textoDeRetomar(proximoPassoEm: string | null, hoje: string): string {
  if (proximoPassoEm === null) return ''
  return `retomar ${diaCurto(proximoPassoEm)}${proximoPassoEm < hoje ? ' (atrasado)' : ''}`
}

/** As linhas do mini-cartão da coluna "Orçamento parcialmente fechado". */
export function linhasDoParcial(
  x: {
    itensFechados?: number | null | undefined
    itensTotal?: number | null | undefined
    sessoesFechadas?: number | null | undefined
    sessoesTotal?: number | null | undefined
    proximoPassoEm: string | null
  },
  hoje: string,
): { fechou: string; retomar: string } {
  // Fechou todos os procedimentos, mas com menos sessões: "2 de 2 procedimentos"
  // esconderia a redução que a paciente negociou.
  const fechouMenosSessoes =
    x.sessoesFechadas != null &&
    x.sessoesTotal != null &&
    x.sessoesFechadas < x.sessoesTotal &&
    x.itensFechados != null &&
    x.itensFechados === x.itensTotal
  const fechou = fechouMenosSessoes
    ? `fechou ${x.sessoesFechadas} de ${x.sessoesTotal} sessões`
    : fechouXdeY(x.itensFechados, x.itensTotal)
  return { fechou, retomar: textoDeRetomar(x.proximoPassoEm, hoje) }
}
