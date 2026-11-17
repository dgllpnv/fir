/**
 * O FATURAMENTO LIDO DE UM SISTEMA DE FORA (MedX), por dia.
 *
 * Não é recebimento, não é caixa e não entra em receita, LTV, saldo nem meta da
 * FIR (spec `integracao-medx.md` C.3, decisão D1). É um número ao lado do
 * número da FIR, nunca somado a ele.
 *
 * A regra que esta função carrega é a do parecer de números (N-B3): a leitura
 * de uma janela produz **uma linha para cada dia lido**, inclusive os de zero.
 * Linha existe ⇔ dia lido. Assim o dia cujo único pagamento foi estornado no
 * MedX volta a zero, em vez de guardar o total velho para sempre.
 */
export type PagamentoExterno = {
  readonly dia: string
  readonly centavos: bigint
  readonly exatoEmDezmilesimos: bigint
}

export type TotalDoDia = {
  readonly dia: string
  readonly centavos: bigint
  readonly exatoEmDezmilesimos: bigint
  readonly quantidade: number
}

/**
 * Os totais de cada dia de `dias`, a partir dos pagamentos lidos. Arredonda
 * por pagamento e soma centavos (A9): só assim a soma dos dias fecha
 * exatamente com o total do período. Pagamento de dia fora de `dias` (borda
 * não coberta inteira) não entra.
 */
export function totaisPorDia(pagamentos: readonly PagamentoExterno[], dias: readonly string[]): TotalDoDia[] {
  const porDia = new Map<string, { centavos: bigint; exatoEmDezmilesimos: bigint; quantidade: number }>()
  for (const d of dias) porDia.set(d, { centavos: 0n, exatoEmDezmilesimos: 0n, quantidade: 0 })
  for (const p of pagamentos) {
    const t = porDia.get(p.dia)
    if (t === undefined) continue
    t.centavos += p.centavos
    t.exatoEmDezmilesimos += p.exatoEmDezmilesimos
    t.quantidade += 1
  }
  return [...porDia.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([dia, t]) => ({ dia, ...t }))
}
