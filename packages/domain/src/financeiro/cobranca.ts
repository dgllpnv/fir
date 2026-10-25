/**
 * A mensagem de cobrança — montada no servidor, e **sem valor nenhum**.
 *
 * Mora no domínio por duas razões. A primeira é a de sempre: o protótipo monta
 * o texto no navegador (`msgCobranca`), e tudo que o front monta sobre dado da
 * clínica é uma segunda implementação esperando divergir. A segunda é a que
 * importa mais: **o valor não entra no texto**, e isso é uma regra, não um
 * descuido de redação. Mensagem de cobrança com o número escrito vira print, e
 * o print circula — saldo de paciente é dado da relação entre a clínica e ela,
 * não um recado de grupo de família.
 *
 * Por isso a função **não recebe valor algum**. Não é "lembre-se de não
 * interpolar o saldo": não há saldo aqui para interpolar.
 */

/** O modelo do protótipo, palavra por palavra. A clínica pode trocar. */
export const MENSAGEM_DE_COBRANCA_PADRAO =
  'Olá, {nome}! Tudo bem? Aqui é {eu}, da {clinica}. Passando para lembrar do ' +
  'valor em aberto do seu atendimento. Podemos combinar o pagamento na sua ' +
  'próxima visita ou por Pix?'

export type DadosDaCobranca = {
  /** O modelo da clínica; vazio cai no padrão. */
  readonly modelo: string
  /** Primeiro nome da paciente — é assim que a recepção fala com ela. */
  readonly nome: string
  /** Primeiro nome de quem está mandando. */
  readonly eu: string
  readonly clinica: string
}

/** O primeiro nome, que é o que a conversa de WhatsApp usa. */
export const primeiroNome = (nome: string): string => nome.trim().split(/\s+/)[0] ?? ''

/**
 * `replaceAll` e não `replace`: um modelo que escreva `{nome}` duas vezes
 * ("Olá, {nome}! {nome}, passando para…") deixaria a segunda ocorrência
 * literal na tela da paciente.
 */
export function montarMensagemDeCobranca(d: DadosDaCobranca): string {
  const modelo = d.modelo.trim() === '' ? MENSAGEM_DE_COBRANCA_PADRAO : d.modelo
  return modelo
    .replaceAll('{nome}', primeiroNome(d.nome))
    .replaceAll('{eu}', primeiroNome(d.eu))
    .replaceAll('{clinica}', d.clinica)
}
