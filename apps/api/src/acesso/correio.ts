import { mascararEmail } from '@fir/domain'
import nodemailer from 'nodemailer'
import type { MensagemDeEmail } from './mensagens'

/**
 * O SEAM `Correio` (ADR 2026-11-16, decisão 4): mandar UMA mensagem já montada.
 *
 * Dois adaptadores e nada mais: SMTP por nodemailer (Resend, SendGrid e SES
 * falam SMTP comum) e o que captura, para os testes. Nenhuma regra mora aqui —
 * nem o link, nem o texto, nem quem recebe.
 *
 * `enviar` rejeita com `FalhaDeEnvio` e NUNCA com o erro cru do provedor: o
 * 550 ecoa o destinatário (LGPD L3), e quem chama só precisa saber que falhou.
 */
export interface Correio {
  enviar(m: MensagemDeEmail): Promise<void>
}

export class FalhaDeEnvio extends Error {
  constructor(readonly codigo: string) {
    super(`envio de e-mail falhou (${codigo})`)
  }
}

/**
 * O envio está LIGADO só com `SMTP_HOST` e `URL_PUBLICA` (spec 2.1, appsec 14):
 * sem a URL pública, o link teria de ser montado com o `Host` da requisição, e
 * um cabeçalho forjado envenenaria o link de redefinição.
 */
export type ConfiguracaoDoEnvio = {
  readonly urlPublica: string | null
  readonly correio: Correio | null
}

/** Token de injeção. O teste o substitui pelo capturador, ligado ou desligado. */
export const ENVIO = Symbol('fir.envio-de-email')

export const envioLigado = (
  e: ConfiguracaoDoEnvio,
): e is { readonly urlPublica: string; readonly correio: Correio } =>
  e.urlPublica !== null && e.correio !== null

export const REMETENTE_PADRAO = 'FIR Clinic <nao-responda@firmaregestao.com.br>'

/** O que se registra de um envio: tipo, resultado, código e o destinatário MASCARADO. */
export type RegistroDeEnvio = (linha: string) => void

type Transporte = { sendMail(opcoes: Record<string, unknown>): Promise<unknown> }

/**
 * O código que o log pode levar: o `code` do nodemailer (`EAUTH`,
 * `ECONNECTION`…) ou o `responseCode` SMTP (`550`). Nunca `message` nem
 * `response`, que ecoam o endereço.
 */
function codigoDoErro(e: unknown): string {
  // Estreitamento por `in`, sem `as`: o erro do nodemailer é um `Error` com
  // campos a mais, e qualquer outra coisa que chegue aqui cai em 'desconhecido'.
  if (typeof e === 'object' && e !== null) {
    if ('responseCode' in e && typeof e.responseCode === 'number') return String(e.responseCode)
    if ('code' in e && typeof e.code === 'string' && /^[A-Z_]{2,40}$/.test(e.code)) return e.code
  }
  return 'desconhecido'
}

export class CorreioSmtp implements Correio {
  constructor(
    private readonly transporte: Transporte,
    private readonly remetente: string,
    private readonly registrar: RegistroDeEnvio = (l) => console.log(l),
  ) {}

  async enviar(m: MensagemDeEmail): Promise<void> {
    const para = mascararEmail(m.para)
    try {
      await this.transporte.sendMail({
        from: this.remetente,
        to: m.para,
        subject: m.assunto,
        text: m.texto,
        html: m.html,
      })
      this.registrar(`[correio] ${m.tipo}: enviado para ${para}`)
    } catch (e) {
      const codigo = codigoDoErro(e)
      this.registrar(`[correio] ${m.tipo}: falhou (${codigo}) para ${para}`)
      throw new FalhaDeEnvio(codigo)
    }
  }
}

/** O adaptador dos testes: guarda cada mensagem, e falha quando mandado. */
export class CorreioCapturador implements Correio {
  readonly mensagens: MensagemDeEmail[] = []
  falhar = false

  enviar(m: MensagemDeEmail): Promise<void> {
    if (this.falhar) return Promise.reject(new FalhaDeEnvio('teste'))
    this.mensagens.push(m)
    return Promise.resolve()
  }
}

function urlPublicaDe(bruta: string | undefined): string | null {
  const v = bruta?.trim() ?? ''
  if (v === '') return null
  try {
    const u = new URL(v)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
    return `${u.origin}${u.pathname}`.replace(/\/+$/, '')
  } catch {
    return null
  }
}

/** O envio de produção, das variáveis de ambiente (spec 7). */
export function envioDoAmbiente(ambiente: NodeJS.ProcessEnv = process.env): ConfiguracaoDoEnvio {
  const host = ambiente['SMTP_HOST']?.trim() ?? ''
  const urlPublica = urlPublicaDe(ambiente['URL_PUBLICA'])
  if (host === '' || urlPublica === null) return { urlPublica: null, correio: null }

  const porta = Number(ambiente['SMTP_PORTA'] ?? '587')
  const usuario = ambiente['SMTP_USUARIO'] ?? ''
  // O Mailpit local (127.0.0.1:4826) não fala TLS; fora da máquina, sempre.
  const local = host === '127.0.0.1' || host === 'localhost' || host === 'mailpit'
  const transporte = nodemailer.createTransport({
    host,
    port: Number.isInteger(porta) && porta > 0 ? porta : 587,
    // 465 é TLS implícito; 587 e 25 sobem para TLS por STARTTLS, que o
    // nodemailer EXIGE com `requireTLS` — credencial não viaja em claro.
    secure: porta === 465,
    requireTLS: porta !== 465 && !local,
    ...(usuario === '' ? {} : { auth: { user: usuario, pass: ambiente['SMTP_SENHA'] ?? '' } }),
    // Nada do nodemailer no log: o `logger` dele imprime destinatários.
    logger: false,
    debug: false,
  })
  const remetente = ambiente['EMAIL_REMETENTE']?.trim() || REMETENTE_PADRAO
  return { urlPublica, correio: new CorreioSmtp(transporte, remetente) }
}
