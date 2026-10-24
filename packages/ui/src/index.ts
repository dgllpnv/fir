const DINHEIRO = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

/**
 * O formatador central. A regra do `CLAUDE.md` é que dinheiro na tela sai
 * daqui — nunca `toFixed(2)` solto, nunca `Intl` chamado direto na página.
 *
 * `null` significa "você não tem permissão para ver", e é o que o interceptor
 * de redação da API devolve. Mostrar "R$ 0,00" ali seria mentira.
 */
export function formatarDinheiro(centavos: bigint | null | undefined): string {
  if (centavos === null || centavos === undefined) return '—'
  const negativo = centavos < 0n
  const abs = negativo ? -centavos : centavos
  // `Intl.NumberFormat` separa "R$" do valor com U+00A0 (espaço sem quebra),
  // não com espaço comum — invisível ao olho, mas falha comparação exata de
  // string. Normaliza para espaço comum (U+0020), igual ao `Dinheiro.formatar()`
  // do domínio.
  const texto = DINHEIRO.format(Number(abs / 100n) + Number(abs % 100n) / 100).replace(
    ' ',
    ' ',
  )
  return negativo ? `-${texto}` : texto
}

export function formatarQuantidade(
  milesimos: bigint | null | undefined,
  unidade: string,
): string {
  if (milesimos === null || milesimos === undefined) return '—'
  const negativa = milesimos < 0n
  const abs = negativa ? -milesimos : milesimos
  const inteiros = abs / 1000n
  const decimais = (abs % 1000n).toString().padStart(3, '0').replace(/0+$/, '')
  const numero = decimais === '' ? `${inteiros}` : `${inteiros},${decimais}`
  return `${negativa ? '-' : ''}${numero} ${unidade}`
}
