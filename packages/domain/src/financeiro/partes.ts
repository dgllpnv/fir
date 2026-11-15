import { Dinheiro } from '../dinheiro'
import { erro, erroDe, ok, type Result } from '../resultado'
import { FORA_DA_CONFERENCIA, FORMAS_DE_CONFERENCIA } from './caixa'

/**
 * **A PARTE DO PAGAMENTO** (`CONTEXT.md`): uma forma e o valor dela dentro de
 * UM recebimento. Pix 300 + Dinheiro 200 = recebimento de 500.
 *
 * Nada aqui divide valor: a pessoa digita cada parte e a soma tem de fechar
 * com o total. Por isso a propriedade que vale é a de FECHAMENTO (Σ partes =
 * valor, qualquer ordem), não `max − min <= 1`, que só existe onde um todo é
 * repartido. Se um dia houver rateio automático, ele passa por
 * `Dinheiro.ratear` (regra 2).
 */
export const FORMAS_DE_RECEBIMENTO = [...FORMAS_DE_CONFERENCIA, FORA_DA_CONFERENCIA] as const

/** Uma forma por parte, e cinco formas existem: o teto é a lista inteira. */
export const MAX_PARTES = 5

export type ParteDoPagamento = { readonly forma: string; readonly valor: Dinheiro }

const EH_FORMA = new Set<string>(FORMAS_DE_RECEBIMENTO)

export const somaDasPartes = (partes: readonly ParteDoPagamento[]): Dinheiro =>
  partes.reduce((s, p) => s.mais(p.valor), Dinheiro.zero())

/**
 * O "falta R$ X" do formulário: `valor − Σ partes`. Positivo é falta, negativo
 * é sobra, zero fecha. O front mostra; quem decide é `validarPartes`.
 */
export const quantoFalta = (valor: Dinheiro, partes: readonly ParteDoPagamento[]): Dinheiro =>
  valor.menos(somaDasPartes(partes))

/**
 * Valida as partes de um recebimento de `valor`. Os códigos são estáveis: a
 * tela casa o código e escreve o texto.
 *
 * `aceitaFormaVazia` existe só para o recebimento LEGADO migrado da v20, cuja
 * forma nunca foi perguntada (migration 0021): `''` entra na receita e fica
 * fora do caixa. Valem só como parte única; o formulário nunca a oferece.
 */
export function validarPartes(
  valor: Dinheiro,
  partes: readonly ParteDoPagamento[],
  opcoes: { readonly aceitaFormaVazia?: boolean } = {},
): Result<readonly ParteDoPagamento[]> {
  if (valor.ehNegativo()) return erro(erroDe('ValorNegativo', 'O valor do recebimento não pode ser negativo.'))

  if (valor.ehZero()) {
    // Venda a prazo: dinheiro que não se moveu não tem forma, e portanto não tem parte.
    return partes.length === 0
      ? ok(partes)
      : erro(erroDe('PartesEmValorZero', 'Um recebimento sem dinheiro recebido não tem forma de pagamento.'))
  }

  if (partes.length === 0) {
    return erro(erroDe('PartesAusentes', 'Informe a forma de pagamento.'))
  }
  if (partes.length > MAX_PARTES) {
    return erro(erroDe('PartesDemais', `No máximo ${MAX_PARTES} formas de pagamento por recebimento.`))
  }

  const unica = partes.length === 1
  for (const p of partes) {
    const vazia = p.forma === '' && opcoes.aceitaFormaVazia === true && unica
    if (!vazia && !EH_FORMA.has(p.forma)) {
      return erro(erroDe('FormaDesconhecida', 'Escolha uma forma de pagamento da lista.'))
    }
    if (p.valor.centavos <= 0n) {
      return erro(erroDe('ParteInvalida', 'Cada forma de pagamento precisa de um valor maior que zero.'))
    }
  }

  if (new Set(partes.map((p) => p.forma)).size !== partes.length) {
    return erro(erroDe('FormaRepetida', 'Cada forma de pagamento aparece uma vez só.'))
  }
  if (!unica && partes.some((p) => p.forma === FORA_DA_CONFERENCIA)) {
    return erro(
      erroDe('PromissoriaMisturada', 'Nota promissória não se mistura com outra forma de pagamento.'),
    )
  }
  if (somaDasPartes(partes).centavos !== valor.centavos) {
    return erro(erroDe('PartesNaoFecham', 'A soma das formas de pagamento precisa ser igual ao valor.'))
  }
  return ok(partes)
}

/**
 * A forma que o legado `recebimentos.forma` recebe: a da MAIOR parte; no
 * empate, a primeira da lista. Nunca "Mista" — uma forma que o caixa não
 * conhece é um dinheiro que o caixa não espera. Nenhum leitor novo a lê.
 *
 * "A primeira" é a primeira DIGITADA: a parte é gravada com `ordem` = posição
 * na lista, e o SQL (`PARTES_EM_JSON`) desempata por ela — mesmo critério.
 */
export function formaPrincipal(partes: readonly ParteDoPagamento[]): string {
  let melhor: ParteDoPagamento | undefined
  for (const p of partes) {
    if (melhor === undefined || p.valor.centavos > melhor.valor.centavos) melhor = p
  }
  return melhor?.forma ?? ''
}

/** Mesmas formas com os mesmos valores, em qualquer ordem — o reenvio da mesma requisição. */
export function mesmasPartes(
  a: readonly ParteDoPagamento[],
  b: readonly ParteDoPagamento[],
): boolean {
  if (a.length !== b.length) return false
  const porForma = new Map(b.map((p) => [p.forma, p.valor.centavos]))
  return a.every((p) => porForma.get(p.forma) === p.valor.centavos)
}
