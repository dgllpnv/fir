/**
 * As rotas que tocam **um dia cujo caixa pode estar aberto**.
 *
 * Existe porque a regra 6 não é uma propriedade de `GET /v1/caixa`: é uma
 * propriedade do SISTEMA. Um agregado por forma de pagamento de um dia aberto
 * **é o esperado com outra etiqueta**, venha ele da rota do caixa, da lista de
 * recebimentos, da tela Hoje ou da Visão do mês filtrada por hoje.
 *
 * `transporte-as-cegas.test.ts` varre esta lista. **Todo plano que acrescentar
 * uma rota que receba `dia`, `de`/`ate` ou que leia "hoje" acrescenta aqui** —
 * e esquecer é exatamente o que aquele teste existe para pegar.
 *
 * `:dia` é substituído pelo dia sob teste.
 */
export type RotaDeConferencia = {
  readonly caminho: string
  /** Por que esta rota toca o dia. Escrita para quem for acrescentar a próxima. */
  readonly razao: string
}

export const ROTAS_DE_CONFERENCIA: readonly RotaDeConferencia[] = [
  {
    caminho: '/v1/recebimentos?dia=:dia',
    razao:
      'Devolve os recebimentos do dia, um a um. A lista individual é o instrumento de trabalho e fica; o que não pode é um AGREGADO por forma — o servidor nunca faz a soma por quem vai contar a gaveta.',
  },
  {
    caminho: '/v1/hoje',
    razao:
      'A tela do dia. O épico 4 lhe acrescenta o bloco financeiro ("fechar o caixa de hoje"), e ele é BOOLEANO: um valor ali seria o esperado chegando pela porta dos fundos.',
  },
  // Task 9 acrescenta `/v1/caixa?dia=:dia`. Task 11 acrescenta
  // `/v1/visao-do-mes?mes=:mes` — o mês CORRENTE contém o dia de hoje, e o
  // "recebido por forma" dele de um mês em curso é o esperado somado com
  // outro nome.
]
