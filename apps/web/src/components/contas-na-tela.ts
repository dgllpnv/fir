import type { ContaNaLista, ListaDeContas, ResultadoDoPagamento } from '@fir/contracts'

/**
 * **Contas a pagar: os grupos da tela e o efeito do "Paguei".**
 *
 * Fora do componente para ser testável sem DOM. Nada aqui soma valor: os
 * grupos são POR DATA (contra o `hoje` do servidor) e o pagamento aplicado é a
 * conta que o SERVIDOR devolveu, não uma conta montada na tela.
 */

export type GrupoDeContas = {
  readonly titulo: string
  readonly lista: readonly ContaNaLista[]
  readonly atrasado?: true
  /** O grupo das já pagas — fica recolhido fora do modo filtrado. */
  readonly pagas?: true
}

export function gruposDeContas({
  itens,
  mes,
  limite,
  tituloDasPagas,
}: {
  itens: readonly ContaNaLista[]
  /** O mês corrente da clínica (`aaaa-mm`), do servidor. */
  mes: string
  /** `hoje + 7`, em dia civil da clínica. */
  limite: string
  tituloDasPagas: string
}): GrupoDeContas[] {
  const abertas = itens.filter((c) => c.pagoEm === null)
  return [
    { titulo: 'Vencidas', lista: abertas.filter((c) => c.vencida), atrasado: true },
    {
      titulo: 'Próximos 7 dias',
      lista: abertas.filter((c) => !c.vencida && c.vencimento <= limite),
    },
    {
      titulo: 'Ainda neste mês',
      lista: abertas.filter(
        (c) => !c.vencida && c.vencimento > limite && c.vencimento.slice(0, 7) === mes,
      ),
    },
    /*
      **Depois deste mês** — grupo que o protótipo NÃO tem, e a falta dele é
      um defeito medido: pagar uma conta mensal cria a do mês seguinte, a tela
      avisa "a conta de 25/11 já foi criada" — e ela não aparecia em lugar
      nenhum, porque os três grupos de abertas param no fim do mês corrente.
    */
    {
      titulo: 'Depois deste mês',
      lista: abertas.filter((c) => c.vencimento.slice(0, 7) > mes),
    },
    { titulo: tituloDasPagas, lista: itens.filter((c) => c.pagoEm !== null), pagas: true },
  ]
}

/**
 * A lista DEPOIS do "Paguei", com o que o servidor devolveu — sem esperar a
 * releitura.
 *
 * **Por que existe** (produção, 2026-11-08: "diz pagamento registrado, mas a
 * conta não some de Contas a pagar"): a tela só relia a lista e, enquanto a
 * releitura não voltava, trocava a lista inteira pelo esqueleto; se ela
 * falhasse, a conta paga continuava desenhada como aberta, com o botão
 * "Paguei" ativo. Agora a conta paga sai das abertas no mesmo quadro do aviso.
 *
 * `total` sai: ele é a soma das pagas feita pelo SERVIDOR, e a tela não o
 * refaz — a releitura que vem logo atrás traz o novo.
 */
export function aplicarPagamento(lista: ListaDeContas, r: ResultadoDoPagamento): ListaDeContas {
  const itens = lista.itens.map((c) => (c.id === r.conta.id ? r.conta : c))
  if (r.proxima !== null && !itens.some((c) => c.id === r.proxima?.id)) itens.push(r.proxima)
  return { itens }
}
