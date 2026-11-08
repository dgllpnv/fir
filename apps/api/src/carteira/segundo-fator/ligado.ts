/**
 * A CHAVE QUE LIGA O SEGUNDO FATOR DA CARTEIRA (ADR 0023, D-23 item 3).
 *
 * O dono desligou a exigência de TOTP "por enquanto", com o código
 * preservado. Desligada (o padrão), a senha sozinha abre a sessão, inclusive
 * para quem já tem TOTP ativo; o `SegundoFatorDaCarteiraGuard` deixa tudo
 * passar; as rotas de cadastro respondem 404. Ligada, o comportamento é
 * EXATAMENTE o da ADR 0022.
 *
 * Lida a cada requisição, e não guardada na subida, para o e2e do segundo
 * fator poder ligá-la para si sem subir outro processo. A subida também a
 * lê (`conferirChaveDoSegundoFator`, no módulo): um valor mal escrito
 * ("ture", "sim") derruba a API no segundo 0 em vez de desligar a proteção
 * em silêncio, que é o mesmo modo de falha que `inteiroDoAmbiente` fecha.
 *
 * `FIR_CHAVE_SEGUNDO_FATOR_CARTEIRA` continua obrigatória com a chave
 * desligada: os segredos já cifrados dependem dela, e religar não pode
 * exigir recadastrar todo mundo.
 */
export const CHAVE_SEGUNDO_FATOR_LIGADO = 'SEGUNDO_FATOR_CARTEIRA_LIGADO'

const LIGADO = new Set(['true', '1'])
const DESLIGADO = new Set(['false', '0', ''])

export function segundoFatorLigado(ambiente: NodeJS.ProcessEnv = process.env): boolean {
  const bruto = ambiente[CHAVE_SEGUNDO_FATOR_LIGADO]
  if (bruto === undefined) return false
  const v = bruto.trim().toLowerCase()
  if (LIGADO.has(v)) return true
  if (DESLIGADO.has(v)) return false
  throw new Error(
    `Variável de ambiente ${CHAVE_SEGUNDO_FATOR_LIGADO}="${bruto}" não é booleana. Esperado "true" ou "false".`,
  )
}
