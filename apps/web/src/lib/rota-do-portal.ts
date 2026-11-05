/**
 * As PORTAS do portal do grupo — hoje só "entrar". Mesma forma de
 * `rota-da-carteira.ts`.
 */
export const PORTAS_DO_PORTAL: readonly string[] = ['/portal/entrar']

export const ehPortaDoPortal = (caminho: string): boolean =>
  PORTAS_DO_PORTAL.includes(caminho.replace(/\/$/, ''))
