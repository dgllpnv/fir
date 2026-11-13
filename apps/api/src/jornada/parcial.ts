/**
 * "ORÇAMENTO PARCIALMENTE FECHADO" EM SQL — o fragmento único.
 *
 * É o par, em SQL, de `situacaoDoFechamento` de `packages/domain`: cartão
 * FECHADO cujo valor fechado (entrada + pagamento em aberto) é MENOR que o
 * oferecido. Fechado antes da coluna (`valor_fechado IS NULL`) não é parcial —
 * "sem informação", nunca parcial por palpite.
 *
 * Três lugares precisam da pergunta no banco (a contagem por atendente, Hoje ›
 * Retomar e a coluna da Jornada), e a regra escrita três vezes é como elas
 * divergem. Aqui ela é escrita uma vez; `parcial.test.ts` cobra que o SQL e o
 * domínio dão a mesma resposta.
 *
 * `alias` vem de constante literal do código, nunca de requisição.
 */
export const sqlParcial = (alias: string): string =>
  `(${alias}.etapa = 'fechado'
    AND ${alias}.valor_orcamento IS NOT NULL
    AND ${alias}.valor_fechado IS NOT NULL
    AND ${alias}.valor_fechado < ${alias}.valor_orcamento)`
