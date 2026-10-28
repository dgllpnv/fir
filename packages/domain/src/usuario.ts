import { erro, ok, type ErroDeDominio, type Result } from './resultado'

/**
 * A MESMA forma que `normalizar_nome` produz no banco (migration 0006).
 *
 * Por que repetir aqui o que o Postgres já faz: o banco é a autoridade — o
 * `CHECK` da 0012 recusa o que não for canônico, e a consulta de entrada
 * normaliza no SQL. Esta função existe para a TELA avisar antes do envio e
 * para o contrato perdoar a caixa do teclado do tablet. Ela não é uma segunda
 * verdade: `teste/identidade-sem-email.test.ts` compara as duas sobre a mesma
 * amostra, e reprova se divergirem.
 *
 * `\p{M}` (toda marca combinante) e não a faixa `U+0300–U+036F`: decompor em
 * NFD e apagar só o bloco latino deixaria passar a marca de qualquer outro
 * alfabeto, e a função ficaria mais permissiva num caso e mais estrita no
 * outro sem razão. Apagar TODA marca é estritamente mais perdoador, e quem
 * recusa é o regex abaixo, que é o portão de verdade.
 */
export const canonizarUsuario = (bruto: string): string =>
  bruto
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')

/** Letra, depois alfanuméricos, com `.`/`_`/`-` SEPARANDO — nunca abrindo, fechando nem dobrando. */
export const REGEX_USUARIO = /^[a-z][a-z0-9]*([._-][a-z0-9]+)*$/

export const USUARIO_MIN = 3
export const USUARIO_MAX = 32

/**
 * Valida a forma CANÔNICA de um nome de usuário. Quem chama passa o resultado
 * de `canonizarUsuario`; receber `Ana` aqui é defeito de quem chamou, e por
 * isso a resposta é `FORMA` e não um conserto silencioso.
 */
export function validarUsuario(canonico: string): Result<string, ErroDeDominio> {
  if (canonico.length === 0) return erro({ codigo: 'VAZIO', mensagem: 'Informe o usuário.' })
  if (canonico.length < USUARIO_MIN)
    return erro({
      codigo: 'CURTO',
      mensagem: `O usuário precisa de ao menos ${USUARIO_MIN} caracteres.`,
    })
  if (canonico.length > USUARIO_MAX)
    return erro({
      codigo: 'LONGO',
      mensagem: `O usuário tem no máximo ${USUARIO_MAX} caracteres.`,
    })
  if (!REGEX_USUARIO.test(canonico))
    return erro({
      codigo: 'FORMA',
      mensagem: 'Use letras minúsculas, números, ponto, hífen ou sublinhado. Comece por letra.',
    })
  return ok(canonico)
}
