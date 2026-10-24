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
  /**
   * Dos DOIS `bigint`, sem `Number` em ponto nenhum — igual ao
   * `Dinheiro.formatar()` do domínio, e pela mesma razão.
   *
   * O que havia antes: `Number(abs / 100n) + Number(abs % 100n) / 100`.
   * Medido: `90071992547409919` centavos saía `R$ 900.719.925.474.099,20` em
   * vez de `...,19`. É a assinatura que a regra 1 do CLAUDE.md barra, no
   * formatador central que existe para centralizar o cuidado.
   *
   * `formatToParts` com `bigint` deixa o `Intl` decidir símbolo,
   * agrupamento e separador decimal; só a parte `fraction` é trocada pelos
   * centavos exatos. `replaceAll` e não `replace`: o U+00A0 (espaço sem
   * quebra) que o `Intl` põe entre "R$" e o número é invisível ao olho e
   * falha comparação exata de string, e a troca de ocorrência única pegava
   * só o primeiro.
   */
  const texto = DINHEIRO.formatToParts(abs / 100n)
    .map((p) => (p.type === 'fraction' ? (abs % 100n).toString().padStart(2, '0') : p.value))
    .join('')
    .replaceAll(' ', ' ')
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
