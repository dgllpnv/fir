/**
 * Formatação de TELA do financeiro — e só de tela.
 *
 * O front formata; o front não calcula. Nada aqui soma, divide ou decide:
 * total, percentual, saldo, diferença e "dias sem contato" já chegam prontos
 * do servidor. Dinheiro sai de `formatarDinheiro` (`@fir/ui`), nunca daqui.
 */

const MESES = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
] as const

/** `2026-10` → `Outubro de 2026`. */
export function rotuloDoMes(mes: string): string {
  const nome = MESES[Number(mes.slice(5, 7)) - 1] ?? ''
  return `${nome.charAt(0).toUpperCase()}${nome.slice(1)} de ${mes.slice(0, 4)}`
}

/** `2026-10` → `outubro`, para o meio de uma frase. */
export const nomeDoMes = (mes: string): string => MESES[Number(mes.slice(5, 7)) - 1] ?? ''

/**
 * Os 12 meses até `mes`, do mais recente para o mais antigo.
 *
 * Aritmética de CALENDÁRIO, sem `Date`: `new Date('2026-10')` é meia-noite
 * UTC e em `America/Bahia` cai no mês anterior. O mês de partida vem do
 * servidor (regra 24); isto só desce a lista a partir dele.
 */
export function mesesAte(mes: string): string[] {
  const ano = Number(mes.slice(0, 4))
  const m = Number(mes.slice(5, 7))
  return Array.from({ length: 12 }, (_, i) => {
    const total = ano * 12 + (m - 1) - i
    return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`
  })
}

/**
 * String de centavos → `bigint`. `null` quando a redação já apagou o campo.
 *
 * Converter não é calcular: `formatarDinheiro` precisa de `bigint`, e o
 * transporte é texto justamente para que ninguém some dois valores sem
 * converter de propósito.
 */
export const centavos = (texto: string | null): bigint | null =>
  texto === null ? null : BigInt(texto)

/**
 * A largura da barra, a partir de um percentual que o SERVIDOR calculou.
 *
 * Limitada a 100 porque a barra é um desenho, não o número: uma meta
 * superada mostra "128%" no texto e a barra cheia. `null` (sem meta) não
 * desenha barra nenhuma.
 */
export const larguraDaBarra = (percentual: number | null): string =>
  `${Math.max(0, Math.min(100, percentual ?? 0))}%`
