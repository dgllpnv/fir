import { createHash, randomBytes } from 'node:crypto'

/** Trinta dias. O balcão não pode relogar a cada hora — ver pendência P-1. */
export const DURACAO_SESSAO_MS = 30 * 24 * 60 * 60 * 1000

/**
 * TRINTA MINUTOS — a sessão de suporte do operador (D-13).
 *
 * Mil e quatrocentas vezes mais curta que a do balcão, e a razão é que elas
 * resolvem problemas opostos. A do balcão existe para a recepcionista **não**
 * relogar: ela abre o sistema de manhã e trabalha o dia inteiro, e um prazo
 * curto ali é o pior tipo de atrito. A de suporte existe para o operador
 * **olhar uma coisa**: alguém ligou, ele abre a clínica, confere, resolve, e
 * fecha. Medida em minutos, não em dias.
 *
 * Por que trinta e não oito horas, como a do painel: o painel trata
 * IDENTIDADE (cria clínica, cria administradora) e não vê paciente nem dose.
 * A sessão de suporte vê **paciente, dose e valor** — é o que a D-13 escreveu
 * ao cruzar a linha da P-10. A credencial mais sensível do produto é a que
 * fica aberta por menos tempo.
 *
 * E por que trinta e não cinco: renovar custa **um clique** na aba do painel,
 * que já está aberta ao lado — mas um prazo que expira no meio da conferência
 * de um caixa transforma "abrir de novo" em hábito, e hábito de reabrir é
 * como a sessão volta a ficar aberta o dia inteiro. Trinta minutos cobrem um
 * atendimento de telefone inteiro.
 *
 * **Não há renovação por uso.** Deslizar o prazo a cada requisição é
 * exatamente como uma sessão de trinta minutos fica viva oito horas, com uma
 * aba esquecida recarregando sozinha.
 */
export const DURACAO_SESSAO_DE_SUPORTE_MS = 30 * 60 * 1000

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
