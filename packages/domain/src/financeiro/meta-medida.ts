import { Dinheiro } from '../dinheiro'
import { percentualInteiro } from './visao-do-mes'

/**
 * **COM QUE RÉGUA A META DO MÊS É MEDIDA** (spec integracao-medx C.10; parecer
 * de números N-B6).
 *
 * `fir`: o que entrou na FIR (`recebidoNoMes`). `medx`: o faturamento lido do
 * MedX. A régua é gravada COM a meta (`metas_do_mes.medida_por`): trocar a
 * configuração da clínica muda o padrão dos meses novos, nunca o atingimento
 * de um mês que já tem meta.
 */
export const MEDIDAS_DA_META = ['fir', 'medx'] as const
export type MedidaDaMeta = (typeof MEDIDAS_DA_META)[number]

export type EntradaDaMedida = {
  readonly medidaPor: MedidaDaMeta
  readonly recebidoFir: Dinheiro
  /** `null`: a clínica não tem leitura do MedX para o mês. */
  readonly faturamentoMedx: Dinheiro | null
  /** Todo dia do mês até hoje tem linha lida (N-B3: linha existe ⇔ dia lido). */
  readonly coberturaMedxCompleta: boolean
}

/**
 * O valor contra o qual a meta é medida. **O único lugar que escolhe a fonte**:
 * a Visão do mês e a rota `/meta` chamam esta função, e por isso o percentual
 * das duas é o mesmo.
 *
 * Devolve UM dos dois, ou `null` — nunca a soma. MedX com leitura incompleta
 * (ou sem leitura) é `null`, não zero: "0% da meta" diria que a clínica não
 * faturou nada, quando o que falta é a leitura.
 */
export function medidoParaAMeta(e: EntradaDaMedida): Dinheiro | null {
  if (e.medidaPor === 'fir') return e.recebidoFir
  return e.coberturaMedxCompleta ? e.faturamentoMedx : null
}

export type AtingimentoDaMetaDoMes = {
  /** `meta − medido`, limitado a zero: o "faltam R$ X" da barra. */
  readonly metaRestante: Dinheiro | null
  readonly percentual: number | null
}

/** Percentual e restante a partir da meta e do medido. Sem um dos dois, nenhum. */
export function atingimentoDaMetaDoMes(meta: Dinheiro | null, medido: Dinheiro | null): AtingimentoDaMetaDoMes {
  if (meta === null || medido === null) return { metaRestante: null, percentual: null }
  const restante = meta.menos(medido)
  return {
    metaRestante: restante.ehNegativo() ? Dinheiro.zero() : restante,
    percentual: percentualInteiro(medido.centavos, meta.centavos),
  }
}
