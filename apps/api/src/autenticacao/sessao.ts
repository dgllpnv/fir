import { createHash, randomBytes } from 'node:crypto'

/** Trinta dias. O balcão não pode relogar a cada hora — ver pendência P-1. */
export const DURACAO_SESSAO_MS = 30 * 24 * 60 * 60 * 1000

const JANELA_TENTATIVAS_MS = 15 * 60 * 1000
const MAX_FALHAS = 5

/**
 * Token opaco de 32 bytes. O banco guarda só o hash: um dump de `sessoes` não
 * vale por um login.
 *
 * SHA-256 e não Argon2 aqui, de propósito — o token tem 256 bits de entropia,
 * então não há o que um ataque de dicionário adivinhe, e a verificação acontece
 * em toda requisição.
 */
export function novoToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url')
  return { token, hash: hashDoToken(token) }
}

export const hashDoToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex')

export type Tentativa = { readonly em: Date; readonly sucesso: boolean }

/**
 * Cinco falhas em quinze minutos bloqueiam. Um sucesso zera a contagem — quem
 * errou a senha três vezes e acertou não deve ficar perto do bloqueio.
 */
export function limiteExcedido(tentativas: readonly Tentativa[], agora: Date): boolean {
  const corte = agora.getTime() - JANELA_TENTATIVAS_MS
  const naJanela = tentativas
    .filter((t) => t.em.getTime() >= corte)
    .sort((a, b) => a.em.getTime() - b.em.getTime())

  const ultimoSucesso = naJanela.map((t) => t.sucesso).lastIndexOf(true)
  const depoisDoSucesso = ultimoSucesso === -1 ? naJanela : naJanela.slice(ultimoSucesso + 1)
  return depoisDoSucesso.filter((t) => !t.sucesso).length >= MAX_FALHAS
}
