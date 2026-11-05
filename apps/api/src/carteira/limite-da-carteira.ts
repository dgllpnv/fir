import { inteiroDoAmbiente } from '../comum/ambiente'

/**
 * Token de injeção próprio — mesma razão de `LIMITE_DO_PAINEL`: reusar
 * `LimitePorOrigem` faria a carteira e o produto dividirem a mesma janela.
 */
export const LIMITE_DA_CARTEIRA = Symbol('carteira.limite-por-origem')

/**
 * Vinte tentativas por origem em quinze minutos — entre o painel (10, duas
 * pessoas) e o produto (60, uma clínica inteira). A equipe comercial é um
 * time pequeno, maior que o do painel, usando de endereços variados.
 */
export const MAX_CARTEIRA_POR_ORIGEM = inteiroDoAmbiente('MAX_CARTEIRA_POR_ORIGEM', 20, { min: 1 })
export const JANELA_CARTEIRA_POR_ORIGEM_MS = inteiroDoAmbiente(
  'JANELA_CARTEIRA_POR_ORIGEM_MS',
  15 * 60 * 1000,
  { min: 1 },
)
