import { DIGITOS_TOTP } from '@fir/domain'
import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * HOTP (RFC 4226 §5.3) com HMAC-SHA-1 — o TOTP da RFC 6238 é este mesmo
 * cálculo com o contador = passo de 30 s. Implementado aqui, sobre
 * `node:crypto`, em vez de uma dependência: são quinze linhas, e o teste
 * confere contra os vetores das duas RFCs (`totp.test.ts`).
 *
 * `digitos` existe só para os vetores da RFC 6238, que são de 8 dígitos. O
 * produto usa sempre `DIGITOS_TOTP` (6).
 */
export function hotp(segredo: Buffer, contador: number, digitos: number = DIGITOS_TOTP): string {
  const mensagem = Buffer.alloc(8)
  mensagem.writeBigUInt64BE(BigInt(contador))
  const mac = createHmac('sha1', segredo).update(mensagem).digest()
  const deslocamento = mac[mac.length - 1]! & 0x0f
  const binario =
    ((mac[deslocamento]! & 0x7f) << 24) |
    (mac[deslocamento + 1]! << 16) |
    (mac[deslocamento + 2]! << 8) |
    mac[deslocamento + 3]!
  return String(binario % 10 ** digitos).padStart(digitos, '0')
}

/**
 * O passo cujo código casa com `codigo`, ou `null`. Compara contra TODOS os
 * candidatos, sempre, em tempo constante (`timingSafeEqual`): sair no
 * primeiro acerto diria pelo tempo qual passo da janela casou.
 *
 * Quem escolhe os candidatos é `passosAceitaveis` (domínio) — é lá que o
 * passo já usado deixa de ser candidato (anti-replay).
 */
export function verificarTotp(segredo: Buffer, codigo: string, candidatos: readonly number[]): number | null {
  const recebido = Buffer.from(codigo.padEnd(DIGITOS_TOTP, '\0').slice(0, DIGITOS_TOTP), 'utf8')
  const formatoValido = codigo.length === DIGITOS_TOTP
  let casou: number | null = null
  for (const passo of candidatos) {
    const esperado = Buffer.from(hotp(segredo, passo), 'utf8')
    if (timingSafeEqual(esperado, recebido) && casou === null) casou = passo
  }
  return formatoValido ? casou : null
}
