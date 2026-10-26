import { Dinheiro } from './dinheiro'

/**
 * O RATEIO DO VALOR NEGOCIADO ENTRE OS ITENS DO PROGRAMA.
 *
 * A clínica negocia "R$ 3.600 pelo programa", e o programa tem Tirzepatida
 * (12 × R$ 300) e Drenagem (3 × R$ 150). O desconto não se divide meio a meio
 * — divide-se proporcionalmente. E a soma dos itens tem de ser EXATAMENTE
 * R$ 3.600, senão a página do programa mostra uma decomposição que não bate
 * com o que a paciente deve, e a recepção não consegue cobrar.
 *
 * Ratear até a SESSÃO criaria um número por linha de agenda que ninguém
 * confere e que o legado nunca teve (decisão P-3).
 */

/**
 * Reparte `total` entre as partes, proporcionalmente a `pesos`, de modo que a
 * soma seja EXATAMENTE `total`.
 *
 * MAIOR RESTO (Hare), e NUNCA arredondamento por parte.
 *
 * `Math.round(total * peso / soma)` em cada parte é a implementação que todo
 * mundo escreve primeiro, e ela não soma o total: com 10 centavos em 3 partes
 * iguais ela dá 3+3+3 = 9, e o centavo desaparece. Aqui o piso é exato em
 * `bigint` e o resto é distribuído, um centavo por parte, nas de maior resto —
 * desempate pela ORDEM, que é o que mantém a equivalência com `ratear`.
 *
 * Com pesos todos IGUAIS, é idêntico a `Dinheiro.ratear(n)`, e a propriedade
 * que exige isso é o que impede o sistema de ter duas regras de rateio de
 * dinheiro — que é precisamente como um centavo some entre duas telas.
 */
export function ratearPrograma(total: Dinheiro, pesos: readonly bigint[]): readonly Dinheiro[] {
  if (pesos.length === 0) {
    throw new Error('Rateio precisa de pelo menos uma parte, recebeu nenhuma.')
  }
  if (pesos.some((p) => p < 0n)) {
    throw new Error('Peso de rateio não pode ser negativo.')
  }

  const soma = pesos.reduce((s, p) => s + p, 0n)
  // Nenhum item traz valor de referência: não há proporção a respeitar, e o
  // rateio igual é a única resposta que não inventa uma.
  if (soma === 0n) return total.ratear(pesos.length)

  // Sinal tratado como em `ratear`: a aritmética roda no absoluto e o sinal
  // volta no fim. Um total negativo não acontece hoje (não existe item de
  // preço negativo), mas duas regras de sinal para a mesma operação é como
  // uma delas passa a arredondar para o lado errado.
  const negativo = total.centavos < 0n
  const bruto = negativo ? -total.centavos : total.centavos

  const base = pesos.map((p) => (bruto * p) / soma)
  const resto = pesos.map((p) => (bruto * p) % soma)
  let sobra = bruto - base.reduce((s, x) => s + x, 0n)

  // As de MAIOR RESTO primeiro; empate resolve pela ORDEM. Uma parte de peso
  // zero tem resto zero e fica no fim — e nunca alcança a sobra, porque a
  // sobra é sempre menor que a quantidade de restos não-nulos.
  const ordem = pesos
    .map((_, i) => i)
    .sort((a, b) => (resto[b]! > resto[a]! ? 1 : resto[b]! < resto[a]! ? -1 : a - b))

  const partes = base.slice()
  for (const i of ordem) {
    if (sobra <= 0n) break
    partes[i] = partes[i]! + 1n
    sobra -= 1n
  }

  return partes.map((v) => Dinheiro.deCentavos(negativo ? -v : v))
}

/**
 * `valor por sessão × sessões`, somado. O ponto de partida que a tela sugere
 * quando a recepção abre o montador — nunca um preço gravado.
 *
 * `null` apenas quando NENHUM item tem valor de referência. Um item sem preço
 * no catálogo contribui zero: devolver `null` porque um dos cinco itens está
 * sem preço esconderia a conta inteira de quem a usa para negociar.
 */
export function valorSugerido(
  itens: readonly { readonly valorPorSessao: Dinheiro | null; readonly sessoes: number }[],
): Dinheiro | null {
  if (!itens.some((i) => i.valorPorSessao !== null)) return null
  return itens.reduce(
    (s, i) => (i.valorPorSessao === null ? s : s.mais(i.valorPorSessao.vezes(BigInt(i.sessoes)))),
    Dinheiro.zero(),
  )
}
