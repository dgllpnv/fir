/**
 * As PORTAS da carteira — entrar e trocar a senha. Mesma forma de
 * `rota-do-painel.ts`: elas não têm faixa, e o provedor não busca a sessão
 * nelas (cada porta resolve o que precisa sozinha).
 */
export const PORTAS_DA_CARTEIRA: readonly string[] = [
  '/carteira/entrar',
  '/carteira/trocar-senha',
  // G8 0.6 — o cadastro do segundo fator também é porta: sem faixa, e o
  // provedor não o desvia para ele mesmo.
  '/carteira/segundo-fator',
]

export const ehPortaDaCarteira = (caminho: string): boolean =>
  PORTAS_DA_CARTEIRA.includes(caminho.replace(/\/$/, ''))
