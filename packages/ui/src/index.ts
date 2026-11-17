import { Dinheiro } from '@fir/domain'

/**
 * O formatador de dinheiro da tela, para quem já recebe centavos em `bigint`.
 * A regra 7 do `CLAUDE.md` é que dinheiro na tela sai de `packages/domain`, e
 * sai: a formatação é `Dinheiro.formatar()`, a ÚNICA implementação. Aqui só
 * mora o que é de tela — `null` vira "—".
 *
 * Já houve duas cópias (esta e a do domínio), corrigidas do mesmo defeito em
 * dias diferentes (o centavo perdido acima de 2^53). Uma só não diverge.
 *
 * `null` significa "você não tem permissão para ver", e é o que o interceptor
 * de redação da API devolve. Mostrar "R$ 0,00" ali seria mentira.
 */
export function formatarDinheiro(centavos: bigint | null | undefined): string {
  if (centavos === null || centavos === undefined) return '—'
  return Dinheiro.deCentavos(centavos).formatar()
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

/**
 * Um `PercentualCentesimos` (`@fir/domain`) na tela: `1000` → `"10,00%"`.
 *
 * Mesmo motivo de `formatarDinheiro` ser dos dois `bigint`: a `Indicador da
 * carteira` de unidade `%` (G3) guarda o percentual em centésimos de ponto —
 * nunca ponto flutuante, regra 8 — e a divisão por 100 para exibir duas casas
 * é FORMATAÇÃO de tela, não a conta que a regra 17 reserva ao servidor.
 *
 * `null` é "sem permissão" ou "ainda sem lançamento", igual aos outros dois
 * formatadores — nunca "0,00%".
 */
export function formatarPercentual(centesimos: bigint | null | undefined): string {
  if (centesimos === null || centesimos === undefined) return '—'
  const negativo = centesimos < 0n
  const abs = negativo ? -centesimos : centesimos
  const inteiros = abs / 100n
  const decimais = (abs % 100n).toString().padStart(2, '0')
  return `${negativo ? '-' : ''}${inteiros},${decimais}%`
}
