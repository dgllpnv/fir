import type { ItemNaLista } from '@fir/contracts'
import { type CodigoLido, gtinCanonico, interpretarCodigo } from '@fir/domain'

type DoCatalogo = Pick<ItemNaLista, 'id' | 'gtin' | 'codigoQr'>

/**
 * O CÓDIGO DA CLÍNICA da sessão, como o servidor o imprime nas etiquetas —
 * lido do `codigoQr` que o próprio servidor monta para cada item. `null` com o
 * catálogo vazio: aí não há etiqueta desta clínica que possa ser lida.
 */
function clinicaDoCatalogo(itens: readonly DoCatalogo[]): string | null {
  const primeira = itens[0]
  if (primeira === undefined) return null
  const c = interpretarCodigo(primeira.codigoQr)
  return c.tipo === 'etiqueta' ? c.clinica : null
}

/**
 * A etiqueta lida é de OUTRA clínica (S-20/AB-A4-3).
 *
 * Decidido aqui, antes de procurar o item e sem consulta nenhuma: a tela diz
 * "etiqueta de outra clínica" e não usa o id impresso para nada — nem para
 * procurar, nem para ligar código. A etiqueta sem código de clínica (a do
 * protótipo) não é recusada: o id dela só é procurado no catálogo desta.
 */
export function etiquetaDeOutraClinica(itens: readonly DoCatalogo[], c: CodigoLido): boolean {
  if (c.tipo !== 'etiqueta' || c.clinica === '') return false
  const daSessao = clinicaDoCatalogo(itens)
  return daSessao !== null && daSessao !== c.clinica
}

/** A frase do balcão, igual nos três leitores. Sem nome nem id do item. */
export const FRASE_DE_OUTRA_CLINICA =
  'Esta é uma etiqueta de outra clínica. Ela não vale para o estoque desta clínica.'

/**
 * O item do catálogo a que o código lido corresponde — ou `null`.
 *
 * Um lugar só para os três leitores (topo do Estoque, entrada/saída e
 * cadastro): a etiqueta pelo id, a caixa pelo GTIN na forma canônica de 14
 * dígitos, a mesma `gtinCanonico` com que o servidor grava. **Código
 * desconhecido nunca vira item novo sozinho** — `null` leva a pessoa a ligar o
 * código a um item que já existe.
 */
export function itemDoCodigo<T extends DoCatalogo>(itens: readonly T[], c: CodigoLido): T | null {
  if (c.tipo === 'etiqueta') {
    if (etiquetaDeOutraClinica(itens, c)) return null
    return itens.find((i) => i.id === c.itemId) ?? null
  }
  if (c.tipo === 'medicamento' || c.tipo === 'barras') {
    const alvo = gtinCanonico(c.gtin)
    return itens.find((i) => i.gtin !== '' && i.gtin === alvo) ?? null
  }
  return null
}

/** O GTIN da caixa como está impresso: o EAN-13 sem o zero da forma de 14. */
export const gtinParaExibir = (gtin: string): string => gtin.replace(/^0+(?=\d{13}$)/, '')
