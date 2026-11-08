/**
 * As PORTAS do portal do grupo — entrar e trocar a senha. Mesma forma de
 * `rota-da-carteira.ts`.
 */
export const PORTAS_DO_PORTAL: readonly string[] = ['/portal/entrar', '/portal/trocar-senha']

export const ehPortaDoPortal = (caminho: string): boolean =>
  PORTAS_DO_PORTAL.includes(caminho.replace(/\/$/, ''))
