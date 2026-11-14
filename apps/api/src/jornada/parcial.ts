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

/**
 * "ESTE EVENTO FOI DESFEITO" EM SQL — o fragmento único.
 *
 * O histórico é append-only: reabrir ou excluir o orçamento NÃO apaga o evento
 * `fechar`/`perder`/`registrarOrcamento`, acrescenta um evento depois dele. Quem
 * conta eventos (o funil, a contagem por atendente) precisa ignorar o que já foi
 * desfeito, senão "Fechados" soma um negócio que não existe mais.
 *
 *  - `excluirOrcamento` desfaz tudo o que veio antes dele;
 *  - `reabrirOrcamento` desfaz só o `fechar` e o `perder` anteriores — o
 *    orçamento enviado continua sendo um orçamento enviado.
 *
 * `ev` e `ord` são o evento e a posição dele (`WITH ORDINALITY`), nomes
 * literais do código, nunca de requisição. O par em TypeScript é
 * `orcadoNaJanela`, em `packages/domain`.
 */
export const sqlEventoDesfeito = (alias: string, ev: string, ord: string): string =>
  `EXISTS (SELECT 1 FROM jsonb_array_elements(${alias}.historico) WITH ORDINALITY AS z(v, o)
            WHERE z.o > ${ord}
              AND (z.v->>'acao' = 'excluirOrcamento'
                   OR (z.v->>'acao' = 'reabrirOrcamento' AND ${ev}->>'acao' IN ('fechar', 'perder'))))`
