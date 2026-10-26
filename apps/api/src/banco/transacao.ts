import type pg from 'pg'

/**
 * O que `BancoService.naClinica` entrega ao callback.
 *
 * Existe como alias porque os DOIS seams do épico 5 — `MontadorDePrograma` e
 * `BaixaDeInsumos` — recebem a transação de QUEM CHAMA, e "a atomicidade é de
 * quem chama" é mais fácil de ler em `montar(tx: Transacao, …)` do que em
 * `montar(c: pg.PoolClient, …)`.
 *
 * A atomicidade ser de quem chama não é detalhe de estilo: `fechar` precisa
 * que o recebimento, a etapa e o programa vivam ou morram juntos. Senão a
 * paciente paga, o cartão fecha, e as doze aplicações não existem.
 */
export type Transacao = pg.PoolClient
