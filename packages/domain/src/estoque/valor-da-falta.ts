import { Dinheiro } from '../dinheiro'
import { MEDIDA_INTEIRA } from '../estoque'
import type { Quantidade } from '../quantidade'

/**
 * **Quanto vale o que saiu sem registro** — a "falta" da contagem e da análise.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * UMA FUNÇÃO, DUAS TELAS
 *
 * A tela da contagem concluída e a aba Análise mostravam o mesmo número, cada
 * uma com a sua conta (`falta × custo / 1000`, escrita duas vezes, com
 * divisão inteira — truncando por item). Duas contas para o mesmo número
 * divergem no dia em que uma delas muda; aqui a conta existe uma vez.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * A REGRA DE ARREDONDAMENTO: MEIO-PARA-CIMA, POR ITEM; O TOTAL É A SOMA DOS ITENS
 *
 * `falta` está em milésimos da medida e `custo` em centavos por UMA medida;
 * o produto está em milésimos de centavo, e precisa virar centavo inteiro.
 *
 *  - **Por item, meio-para-cima** (0,5 centavo vira 1). A divisão inteira que
 *    havia antes TRUNCAVA, e truncar uma perda é sempre a favor de esconder:
 *    meia ampola de R$ 0,01 de custo sumia como R$ 0,00 em cada item, e numa
 *    lista de cem itens a perda relatada ficava sistematicamente abaixo da
 *    real. Meio-para-cima erra no máximo meio centavo por item, para os dois
 *    lados.
 *  - **O total é a SOMA dos valores por item já arredondados** — não "somar
 *    antes de dividir". A aba Análise mostra o valor de CADA item e o total
 *    embaixo; quem confere soma a coluna, e a coluna tem de bater com o total
 *    centavo a centavo. Somar os produtos antes de dividir daria um total
 *    mais "exato" que a coluna não reproduz — e o número que não se reproduz
 *    é o número em que ninguém confia.
 *
 * A diferença POSITIVA (sobrou) vale zero: a falta é o que interessa à perda.
 * A sobra continua relatada como quantidade (regra 13), não como dinheiro.
 * ────────────────────────────────────────────────────────────────────────────
 */
export function valorDaFalta(diferenca: Quantidade, custoPorMedida: Dinheiro): Dinheiro {
  const falta = diferenca.milesimos < 0n ? -diferenca.milesimos : 0n
  return Dinheiro.deCentavos(dividirMeioParaCima(falta * custoPorMedida.centavos, MEDIDA_INTEIRA))
}

/** O total da falta: a soma, pelo value object, dos valores por item. */
export function valorTotalDaFalta(
  linhas: readonly { readonly diferenca: Quantidade; readonly custoPorMedida: Dinheiro }[],
): Dinheiro {
  return linhas.reduce(
    (total, l) => total.mais(valorDaFalta(l.diferenca, l.custoPorMedida)),
    Dinheiro.zero(),
  )
}

/**
 * `n / d` arredondado ao inteiro mais próximo, com o meio para LONGE DO ZERO
 * (`d > 0`). Simétrico de propósito: um custo negativo (que o cadastro não
 * deveria ter) não ganha uma regra de arredondamento diferente da do positivo.
 */
function dividirMeioParaCima(n: bigint, d: bigint): bigint {
  const metade = d / 2n
  return n >= 0n ? (n + metade) / d : -((-n + metade) / d)
}
