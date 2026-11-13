import { centavosDoTextoBrasileiro } from '@fir/domain'

/**
 * O que a recepção DIGITOU → centavos, como inteiro.
 *
 * Nenhum `parseFloat`, nenhum `Number(x) * 100`, nenhum `toFixed`: a regra 1
 * proíbe ponto flutuante perto de dinheiro, e a conversão ingênua erra no
 * centavo em valores comuns — `19.99 * 100` é `1998.9999999999998` em
 * JavaScript, e `Math.round` disfarça o erro até o dia em que ele cai para o
 * outro lado.
 *
 * Aqui a string é lida como DÍGITOS: "1.234,56" vira `123456n`. A vírgula é o
 * separador decimal e o ponto é milhar, porque é assim que se digita no
 * balcão. Um formato que não case é `null` — recusado na tela, nunca
 * convertido em silêncio.
 *
 * Esta é a ÚNICA leitura de dinheiro digitado do front. Sair daqui para
 * dentro de um componente é como ela ganha uma segunda versão, e a segunda é
 * a que usa `parseFloat`.
 */
export const centavosDoTexto = centavosDoTextoBrasileiro

/** Centavos → o texto do campo, para reabrir um valor já lançado. */
export function textoDeCentavos(centavos: bigint): string {
  const negativo = centavos < 0n
  const abs = negativo ? -centavos : centavos
  return `${negativo ? '-' : ''}${abs / 100n},${(abs % 100n).toString().padStart(2, '0')}`
}
