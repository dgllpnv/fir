import { Dinheiro } from '../dinheiro'

/**
 * Um fato do passado que mexeu no saldo do paciente.
 *
 * É sempre um recebimento vivo: ou ele ABRIU valor (`aberto`, o "ficou em
 * aberto" do atendimento), ou ABATEU o que estava aberto (`abatido`, a
 * parcela), ou nenhum dos dois (pagamento à vista, que não cria saldo).
 *
 * Os dois campos são FATOS IMUTÁVEIS do evento, nunca um saldo corrente —
 * regra 5. Um campo `saldo` mutável numa tabela é o que faz uma clínica
 * cobrar o que já recebeu.
 */
export type EventoDeSaldo = {
  /** `null` = fora de programa (o grupo geral). O épico 5 passa a preencher. */
  readonly programaId: string | null
  /** O que ESTE evento deixou em aberto. */
  readonly aberto: Dinheiro
  /** O que ESTE evento abateu do grupo. */
  readonly abatido: Dinheiro
}

export type GrupoDeSaldo = {
  readonly programaId: string | null
  readonly aberto: Dinheiro
  readonly abatido: Dinheiro
  /** `aberto − abatido`, limitado a zero por baixo. É o que a clínica cobra. */
  readonly saldo: Dinheiro
  /** O que o clamp acima engoliu, quando `abatido > aberto`. Zero no caso normal. */
  readonly credito: Dinheiro
}

export type SaldoDoPaciente = {
  readonly grupos: readonly GrupoDeSaldo[]
  /**
   * Soma dos `saldo` dos grupos.
   *
   * **Chama-se `saldo`, e não `total`**, pelo mesmo motivo que o resultado do
   * mês não se chama `resultado`: `CAMPOS_MONETARIOS` apaga por NOME, em
   * qualquer profundidade de qualquer resposta, e `total` já é um INTEIRO DE
   * CONTAGEM em três contratos (`PaginaDePacientes.total`,
   * `ListaDeTarefas.total`, `hoje.pendentes.total`). Registrar `total` como
   * monetário apagaria a contagem de páginas da recepção inteira e quebraria
   * a paginação — sem erro nenhum. Medido.
   */
  readonly saldo: Dinheiro
  /** Soma dos `credito` dos grupos. */
  readonly credito: Dinheiro
  /** Derivado; sobrevive à redação (regra 17) — é o que a equipe sem `valores` recebe. */
  readonly temSaldo: boolean
}

/**
 * Geral primeiro, depois por id de programa.
 *
 * A ordem precisa ser determinística porque é ela que a tela Cobranças mostra
 * e que os testes comparam; `Map` preserva ordem de inserção, que é a ordem
 * em que o `SELECT` devolveu as linhas — ou seja, nenhuma ordem.
 */
function ordenar(a: GrupoDeSaldo, b: GrupoDeSaldo): number {
  if (a.programaId === b.programaId) return 0
  if (a.programaId === null) return -1
  if (b.programaId === null) return 1
  return a.programaId.localeCompare(b.programaId)
}

/**
 * Saldo em aberto do paciente: **derivado**, **agrupado por programa**, com um
 * grupo geral para o que não é de programa.
 *
 * As duas decisões que esta função fixa, e cada uma tem razão:
 *
 * **O clamp é POR GRUPO, nunca no total.** Um programa pago a mais não reduz a
 * dívida de outro: "R$ 2.000 do programa de Tirzepatida" e "R$ 2.000 soltos"
 * exigem conversas diferentes, e um total só perde a informação que a cobrança
 * usa. Clampar o total faria o excedente de um grupo pagar a dívida do outro —
 * e a clínica pararia de cobrar o que lhe é devido.
 *
 * **O excedente não se joga fora.** O protótipo (`calcSaldos`) e o `Code.gs`
 * (`pacientesComSaldo`) fazem `Math.max(0, …)` e descartam o resto. O número
 * clampado é o certo para cobrar; o descarte é que esconde o incidente —
 * paciente que pagou a mais é erro de lançamento ou crédito real, e os dois
 * precisam aparecer. Ele sai como `credito` do grupo.
 */
export function saldoEmAberto(eventos: readonly EventoDeSaldo[]): SaldoDoPaciente {
  const porPrograma = new Map<string | null, { aberto: Dinheiro; abatido: Dinheiro }>()

  for (const e of eventos) {
    const atual = porPrograma.get(e.programaId) ?? { aberto: Dinheiro.zero(), abatido: Dinheiro.zero() }
    porPrograma.set(e.programaId, {
      aberto: atual.aberto.mais(e.aberto),
      abatido: atual.abatido.mais(e.abatido),
    })
  }

  const grupos: GrupoDeSaldo[] = []
  for (const [programaId, { aberto, abatido }] of porPrograma) {
    const liquido = aberto.menos(abatido)
    const devendo = liquido.ehNegativo()
    grupos.push({
      programaId,
      aberto,
      abatido,
      saldo: devendo ? Dinheiro.zero() : liquido,
      credito: devendo ? Dinheiro.zero().menos(liquido) : Dinheiro.zero(),
    })
  }
  grupos.sort(ordenar)

  const total = grupos.reduce((s, g) => s.mais(g.saldo), Dinheiro.zero())
  const credito = grupos.reduce((s, g) => s.mais(g.credito), Dinheiro.zero())

  return { grupos, saldo: total, credito, temSaldo: !total.ehZero() && !total.ehNegativo() }
}
