/**
 * As PORTAS da carteira — hoje só "entrar" (não há troca de senha provisória
 * ainda nesta fatia). Mesma forma de `rota-do-painel.ts`.
 */
export const PORTAS_DA_CARTEIRA: readonly string[] = ['/carteira/entrar']

export const ehPortaDaCarteira = (caminho: string): boolean =>
  PORTAS_DA_CARTEIRA.includes(caminho.replace(/\/$/, ''))
