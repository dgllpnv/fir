import { erro, ok, type ErroDeDominio, type Result } from './resultado'

/**
 * Acesso por e-mail (ADR 2026-11-16): a forma canônica do e-mail, os prazos dos
 * links de uso único e a máscara que o log e a tela usam.
 *
 * O banco é a autoridade sobre a forma (CHECK da migration 0103, que substituiu o da 0097); esta função é
 * a mesma regra para a tela avisar antes do envio e para o contrato canonizar o
 * que o teclado entrega. A comparação das duas está em
 * `teste/identidade-com-email.test.ts`.
 */
export const canonizarEmail = (bruto: string): string => bruto.trim().toLowerCase()

/**
 * Deliberadamente simples — e FECHADA nos caracteres (revisão appsec C1): a
 * parte local só com os caracteres "atext" da RFC 5322 e o ponto, o domínio
 * só com letras, dígitos e hífen em rótulos separados por ponto. Nada de
 * `<>()[]",;:\` nem espaço: o transporte de e-mail lê esses caracteres como
 * lista de endereços e nome de exibição, e `juliana.sol.com<x@mal.example>`
 * era aceito aqui e entregue a `x@mal.example`.
 *
 * Minúsculas, porque a forma que chega aqui é a canônica. A mesma regra do
 * CHECK da migration 0103. Quem prova que o e-mail é da pessoa continua sendo
 * o link de confirmação, não o regex.
 */
export const REGEX_EMAIL = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/

export const EMAIL_MAX = 254

export function validarEmail(canonico: string): Result<string, ErroDeDominio> {
  if (canonico.length === 0) return erro({ codigo: 'VAZIO', mensagem: 'Informe o e-mail.' })
  if (canonico.length > EMAIL_MAX)
    return erro({ codigo: 'LONGO', mensagem: 'O e-mail é longo demais.' })
  if (!REGEX_EMAIL.test(canonico))
    return erro({ codigo: 'FORMA', mensagem: 'Confira o e-mail: falta o @ ou o domínio.' })
  return ok(canonico)
}

/** O identificador da tela de entrada é e-mail quando tem `@`; senão, é usuário. */
export const identificadorEhEmail = (bruto: string): boolean => bruto.includes('@')

export const FINALIDADES_DE_LINK = ['convite', 'redefinicao', 'confirmacao_de_email'] as const
export type FinalidadeDeLink = (typeof FINALIDADES_DE_LINK)[number]

const HORA = 60 * 60 * 1000

/**
 * Quanto cada link vale. Convite e redefinição vêm do backlog da PO (3.2); a
 * confirmação de e-mail não foi pedida, e um dia é o que cobre "abro o e-mail
 * amanhã cedo" sem deixar um link vivo por uma semana.
 */
export const PRAZO_DO_LINK_MS: Readonly<Record<FinalidadeDeLink, number>> = {
  convite: 7 * 24 * HORA,
  redefinicao: 1 * HORA,
  confirmacao_de_email: 24 * HORA,
}

export type SituacaoDoLink = 'valido' | 'usado' | 'vencido' | 'invalidado'

/**
 * O estado de um link num instante. A ordem importa: um link usado e depois
 * vencido responde `usado`, que é o que a pessoa precisa ouvir ("este link já
 * foi usado"), e um invalidado por um link mais novo responde `invalidado`.
 * Vencimento é semiaberto: no instante exato de `expiraEm` ele já não vale.
 */
export function situacaoDoLink(
  link: { expiraEm: Date; usadoEm: Date | null; invalidadoEm: Date | null },
  agora: Date,
): SituacaoDoLink {
  if (link.usadoEm !== null) return 'usado'
  if (link.invalidadoEm !== null) return 'invalidado'
  if (agora.getTime() >= link.expiraEm.getTime()) return 'vencido'
  return 'valido'
}

/**
 * `juliana@gmail.com` → `j***@g***.com`. Para log (regra 21) e para a faixa
 * "enviamos o link para…", que mostra o bastante para a pessoa reconhecer o
 * próprio endereço e não o bastante para quem olha por cima do ombro.
 */
export function mascararEmail(email: string): string {
  const arroba = email.lastIndexOf('@')
  if (arroba <= 0) return '***'
  const local = email.slice(0, arroba)
  const dominio = email.slice(arroba + 1)
  const ponto = dominio.lastIndexOf('.')
  const nomeDoDominio = ponto > 0 ? dominio.slice(0, ponto) : dominio
  const sufixo = ponto > 0 ? dominio.slice(ponto) : ''
  return `${local.slice(0, 1)}***@${nomeDoDominio.slice(0, 1)}***${sufixo}`
}

export const SITUACOES_DO_ACESSO = ['ativo', 'convite_pendente', 'convite_vencido'] as const
export type SituacaoDoAcesso = (typeof SITUACOES_DO_ACESSO)[number]

/**
 * O selo da lista de Usuários e acessos. Quem já criou a senha (pelo convite ou
 * por uma provisória) é `ativo`; quem foi convidada e ainda não criou depende do
 * convite VIVO mais recente: sem convite vivo, ou com ele vencido no instante, o
 * convite está vencido e a admin precisa reenviar. Vencimento semiaberto, como
 * em `situacaoDoLink`.
 */
export function situacaoDoAcesso(
  pessoa: { aguardandoPrimeiraSenha: boolean },
  conviteVivo: { expiraEm: Date } | null,
  agora: Date,
): SituacaoDoAcesso {
  if (!pessoa.aguardandoPrimeiraSenha) return 'ativo'
  if (conviteVivo === null || agora.getTime() >= conviteVivo.expiraEm.getTime()) return 'convite_vencido'
  return 'convite_pendente'
}

/**
 * O primeiro nome, para o "Olá, Juliana" do e-mail e da tela de criar senha. É a
 * MESMA função da mensagem de cobrança (`financeiro/cobranca`): uma regra, uma
 * vez — o índice do pacote a exporta de lá.
 */
export { primeiroNome } from './financeiro/cobranca'
