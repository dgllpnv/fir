/**
 * As PORTAS da carteira — entrar e trocar a senha. Mesma forma de
 * `rota-do-painel.ts`: elas não têm faixa, e o provedor não busca a sessão
 * nelas (cada porta resolve o que precisa sozinha).
 */
export const PORTAS_DA_CARTEIRA: readonly string[] = ['/carteira/entrar', '/carteira/trocar-senha']

export const ehPortaDaCarteira = (caminho: string): boolean =>
  PORTAS_DA_CARTEIRA.includes(caminho.replace(/\/$/, ''))
