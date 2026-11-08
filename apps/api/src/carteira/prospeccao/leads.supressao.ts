import { normalizarTelefoneDoLead } from '@fir/domain'
import { createHmac } from 'node:crypto'

/**
 * O hash do telefone na lista de supressão (LGPD A37).
 *
 * HMAC-SHA-256, e não SHA-256 puro: telefone brasileiro tem uns 10⁹
 * valores possíveis, e um hash sem chave se desfaz por força bruta em
 * minutos — a "lista de supressão" viraria a lista dos telefones de quem
 * pediu para sair. A chave mora fora do banco (`FIR_CHAVE_SUPRESSAO_DE_CONTATO`,
 * segredo do deploy); quem tem só o banco não reverte nada.
 *
 * Em produção a chave é obrigatória e a ausência FALHA na primeira
 * exclusão, alto; fora de produção há uma chave fixa de desenvolvimento, para
 * os testes e o ambiente local funcionarem sem configuração.
 *
 * Trocar a chave invalida a lista inteira (os hashes antigos deixam de
 * casar). Rotação, se um dia for preciso, é recalcular — e para isso o
 * telefone teria de existir, o que de propósito não acontece. Registrado no
 * relatório do ticket.
 */
const CHAVE_DE_DESENVOLVIMENTO = 'fir-desenvolvimento-supressao-de-contato-nao-usar-em-producao'

function chave(): string {
  const doAmbiente = process.env['FIR_CHAVE_SUPRESSAO_DE_CONTATO']
  if (doAmbiente !== undefined && doAmbiente.length >= 32) return doAmbiente
  if (process.env['NODE_ENV'] === 'production') {
    throw new Error('FIR_CHAVE_SUPRESSAO_DE_CONTATO ausente ou curta (mínimo 32 caracteres).')
  }
  return CHAVE_DE_DESENVOLVIMENTO
}

/** `null` quando o texto não é telefone (`normalizarTelefoneDoLead`). */
export function hashDoTelefoneParaSupressao(telefone: string | null | undefined): string | null {
  const n = normalizarTelefoneDoLead(telefone)
  if (n === null) return null
  return createHmac('sha256', chave()).update(n).digest('hex')
}
