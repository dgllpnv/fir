/**
 * O CATÁLOGO FIXO de falhas do MedX (gate appsec S-8, LGPD A2).
 *
 * `ultimo_erro` (que o superadmin e a clínica veem), o log e o `failedReason`
 * do job saem SÓ daqui. Nunca o corpo da resposta, a URL com query, o objeto
 * de erro do cliente HTTP, o token nem o JWT: uma mensagem de validação do
 * MedX pode trazer o nome do paciente, e um erro do cliente HTTP carrega o
 * cabeçalho `Authorization`.
 */
export const MENSAGENS_DO_MEDX = {
  chave_invalida: 'A chave guardada não abre. Cole a chave do MedX de novo.',
  recusada: 'O MedX recusou a chave. Gere outra no MedX e cole aqui.',
  sem_permissao: 'O usuário do MedX não tem a permissão que esta leitura exige.',
  limite: 'O MedX pediu para esperar (limite de chamadas). A próxima leitura tenta de novo.',
  indisponivel: 'O MedX está fora do ar ou respondeu com erro. A próxima leitura tenta de novo.',
  nao_json: 'O MedX respondeu algo que não é dado (página de manutenção?). Nada foi alterado.',
  contrato: 'O MedX respondeu num formato inesperado. Nada foi alterado.',
  tempo: 'O MedX demorou demais para responder. A próxima leitura tenta de novo.',
  redirecionou: 'O MedX tentou redirecionar a chamada. Por segurança, nada foi seguido.',
  grande_demais: 'A resposta do MedX passou do tamanho esperado. Nada foi alterado.',
  rede: 'Não foi possível conectar ao MedX.',
} as const

export type CodigoDoMedx = keyof typeof MENSAGENS_DO_MEDX

export class ErroDoMedx extends Error {
  constructor(readonly codigo: CodigoDoMedx) {
    super(MENSAGENS_DO_MEDX[codigo])
    this.name = 'ErroDoMedx'
  }
}
