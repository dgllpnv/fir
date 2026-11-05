import { inteiroDoAmbiente } from '../../comum/ambiente'

/**
 * Token de injeção próprio — mesma razão de `LIMITE_DA_CARTEIRA`: reusar
 * `LimitePorOrigem` faria o portal e o produto (ou a carteira) dividirem a
 * mesma janela, e um ataque contra uma população consumiria a cota da outra
 * (ADR 0018, "Alternativas rejeitadas").
 */
export const LIMITE_DO_PORTAL = Symbol('portal.limite-por-origem')

/**
 * Trinta tentativas por origem em quinze minutos — maior que o da carteira
 * (20, equipe comercial pequena) porque a população do portal é o cliente
 * EXTERNO de cada clínica, de endereços mais variados (ADR 0018 §3 item 3:
 * "o comparável mais próximo é o teto de Pessoa/produto, não o de Operador/
 * painel").
 */
export const MAX_PORTAL_POR_ORIGEM = inteiroDoAmbiente('MAX_PORTAL_POR_ORIGEM', 30, { min: 1 })
export const JANELA_PORTAL_POR_ORIGEM_MS = inteiroDoAmbiente(
  'JANELA_PORTAL_POR_ORIGEM_MS',
  15 * 60 * 1000,
  { min: 1 },
)
