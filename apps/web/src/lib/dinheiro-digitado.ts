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
export function centavosDoTexto(texto: string): bigint | null {
  const limpo = texto.trim().replace(/\s/g, '')
  if (limpo === '') return null

  // Três formas aceitas: com separador de milhar ("1.234,56"), só com
  // decimal de vírgula ("450,00") e só com decimal de ponto ("450.00", que é
  // o que um teclado numérico de celular produz).
  const comMilhar = /^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(limpo)
  const comVirgula = /^\d+(,\d{1,2})?$/.test(limpo)
  const comPonto = /^\d+(\.\d{1,2})?$/.test(limpo)
  if (!comMilhar && !comVirgula && !comPonto) return null

  const normalizado = comMilhar ? limpo.replace(/\./g, '') : limpo.replace('.', ',')
  const [inteiros, decimais] = normalizado.split(',') as [string, string | undefined]
  if (inteiros === '') return null
  const centavos = (decimais ?? '').padEnd(2, '0')
  return BigInt(inteiros) * 100n + BigInt(centavos)
}

/** Centavos → o texto do campo, para reabrir um valor já lançado. */
export function textoDeCentavos(centavos: bigint): string {
  const negativo = centavos < 0n
  const abs = negativo ? -centavos : centavos
  return `${negativo ? '-' : ''}${abs / 100n},${(abs % 100n).toString().padStart(2, '0')}`
}
