import { PRAZO_DO_LINK_MS, primeiroNome } from '@fir/domain'

/**
 * Os cinco e-mails do acesso, como TEXTO PURO e HTML simples.
 *
 * O corpo é o mínimo da LGPD L1: o nome da clínica, o PRIMEIRO nome, a
 * finalidade, o link e o prazo. Nunca o usuário, o sobrenome, o perfil, quem
 * enviou, uma senha ou dado de paciente — o `usuario` só aparece em
 * `/criar-senha`, depois de `consultar`.
 *
 * Sem imagem remota e sem pixel (L2): a identidade "papel e dourado" vai em
 * cor e tipografia de sistema, inline. Todo `href` é o link montado com
 * `URL_PUBLICA`, e mais nenhum.
 *
 * Nome da clínica e nome da pessoa são escritos pela admin: entram ESCAPADOS
 * no HTML e numa linha só (appsec 19). Os assuntos são constantes — nenhum
 * dado do usuário entra num cabeçalho.
 */
export type TipoDeMensagem =
  | 'convite'
  | 'redefinicao'
  | 'confirmacao_de_email'
  | 'senha_alterada'
  | 'email_trocado'
  | 'troca_de_email_pedida'

export const ASSUNTOS: Readonly<Record<TipoDeMensagem, string>> = {
  convite: 'Seu acesso à FIR Clinic',
  redefinicao: 'Crie uma senha nova na FIR Clinic',
  confirmacao_de_email: 'Confirme seu e-mail na FIR Clinic',
  senha_alterada: 'Sua senha da FIR Clinic foi alterada',
  email_trocado: 'Seu e-mail na FIR Clinic foi trocado',
  troca_de_email_pedida: 'Pedido de troca do seu e-mail na FIR Clinic',
}

export type MensagemDeEmail = {
  readonly tipo: TipoDeMensagem
  readonly para: string
  readonly assunto: string
  readonly texto: string
  readonly html: string
}

export const escaparHtml = (s: string): string =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

/** Uma linha só: quebra de linha num nome não vira cabeçalho nem parágrafo forjado. */
export const numaLinha = (s: string): string =>
  s.replace(/[\r\n\t\u2028\u2029\u0085]+/g, ' ').trim()

const HORA = 60 * 60 * 1000

/** `7 dias`, `1 hora`, `24 horas` — do prazo do domínio, nunca um número escrito aqui. */
export function prazoEmTexto(ms: number): string {
  if (ms % (24 * HORA) === 0 && ms >= 48 * HORA) return `${ms / (24 * HORA)} dias`
  const horas = Math.round(ms / HORA)
  return horas === 1 ? '1 hora' : `${horas} horas`
}

type Conteudo = {
  readonly paragrafos: readonly string[]
  readonly botao?: { readonly rotulo: string; readonly href: string }
  readonly rodape: string
}

function conteudoDe(
  tipo: TipoDeMensagem,
  clinica: string,
  link: string | null,
): Conteudo {
  const exigeLink = (): string => {
    if (link === null) throw new Error(`a mensagem ${tipo} precisa de link`)
    return link
  }
  switch (tipo) {
    case 'convite':
      return {
        paragrafos: [
          `A clínica ${clinica} criou o seu acesso à FIR Clinic. Para começar, crie a sua senha.`,
          `O link vale por ${prazoEmTexto(PRAZO_DO_LINK_MS.convite)} e serve uma vez.`,
        ],
        botao: { rotulo: 'Criar minha senha', href: exigeLink() },
        rodape: 'Se você não esperava este e-mail, pode ignorá-lo.',
      }
    case 'redefinicao':
      return {
        paragrafos: [
          `Recebemos um pedido para criar uma senha nova para o seu acesso à FIR Clinic na clínica ${clinica}.`,
          `O link vale por ${prazoEmTexto(PRAZO_DO_LINK_MS.redefinicao)} e serve uma vez.`,
        ],
        botao: { rotulo: 'Criar uma senha nova', href: exigeLink() },
        rodape: 'Se não foi você, ignore este e-mail: a sua senha atual continua valendo.',
      }
    case 'confirmacao_de_email':
      return {
        paragrafos: [
          `Confirme que este e-mail é seu para entrar e redefinir a senha da FIR Clinic na clínica ${clinica}.`,
          `O link vale por ${prazoEmTexto(PRAZO_DO_LINK_MS.confirmacao_de_email)} e serve uma vez.`,
        ],
        botao: { rotulo: 'Confirmar e-mail', href: exigeLink() },
        rodape: 'Se não foi você, ignore este e-mail: nada muda no seu acesso.',
      }
    case 'senha_alterada':
      return {
        paragrafos: [`A senha do seu acesso à FIR Clinic na clínica ${clinica} foi alterada agora.`],
        rodape: 'Se não foi você, fale com a administradora da clínica.',
      }
    case 'email_trocado':
      return {
        paragrafos: [
          `O e-mail do seu acesso à FIR Clinic na clínica ${clinica} foi trocado, e este endereço deixou de receber os avisos de acesso.`,
        ],
        rodape: 'Se não foi você, fale com a administradora da clínica.',
      }
    // No MOMENTO do pedido (revisão appsec M2): quem pediu a troca não precisa
    // da caixa antiga, e a dona dela fica sabendo antes que o novo valha.
    case 'troca_de_email_pedida':
      return {
        paragrafos: [
          `Foi pedida a troca do e-mail do seu acesso à FIR Clinic na clínica ${clinica}. Este endereço continua valendo até o novo ser confirmado.`,
        ],
        rodape: 'Se não foi você, fale com a administradora da clínica.',
      }
  }
}

/**
 * Monta a mensagem. `link` só nos três tipos que levam botão; os dois avisos
 * (L11) não levam link nenhum, de propósito: um aviso de "sua senha foi
 * alterada" com botão é o formato exato do phishing que ele quer denunciar.
 */
export function montarMensagem(
  tipo: TipoDeMensagem,
  dados: { para: string; clinicaNome: string; nomeDaPessoa: string; link?: string },
): MensagemDeEmail {
  const clinica = numaLinha(dados.clinicaNome)
  const nome = numaLinha(primeiroNome(numaLinha(dados.nomeDaPessoa)))
  const c = conteudoDe(tipo, clinica, dados.link ?? null)
  const saudacao = nome === '' ? 'Olá.' : `Olá, ${nome}.`

  const texto = [
    saudacao,
    '',
    ...c.paragrafos.flatMap((p) => [p, '']),
    ...(c.botao ? [`${c.botao.rotulo}: ${c.botao.href}`, ''] : []),
    c.rodape,
    '',
    'FIR Clinic · Firmare Rotinas de Gestão',
  ].join('\n')

  const p = (s: string) =>
    `<p style="margin:0 0 16px;font-size:16px;line-height:1.5;color:#2E1F0E">${escaparHtml(s)}</p>`
  const botao = c.botao
    ? `<p style="margin:24px 0"><a href="${escaparHtml(c.botao.href)}" style="display:inline-block;background:#86672E;color:#FFFFFF;text-decoration:none;padding:12px 20px;border-radius:6px;font-weight:600;font-size:16px">${escaparHtml(c.botao.rotulo)}</a></p>` +
      `<p style="margin:0 0 16px;font-size:13px;line-height:1.5;color:#6B5A44">Se o botão não abrir, copie este endereço no navegador:<br>${escaparHtml(c.botao.href)}</p>`
    : ''
  const html =
    '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>' +
    '<body style="margin:0;padding:0;background:#F9F7F2">' +
    '<div style="max-width:520px;margin:0 auto;padding:32px 24px;font-family:Inter,Segoe UI,Helvetica,Arial,sans-serif">' +
    '<div style="font-family:Lora,Georgia,serif;font-size:20px;color:#86672E;margin-bottom:24px">FIR Clinic</div>' +
    p(saudacao) +
    c.paragrafos.map(p).join('') +
    botao +
    `<p style="margin:24px 0 0;font-size:13px;line-height:1.5;color:#6B5A44">${escaparHtml(c.rodape)}</p>` +
    '<hr style="border:none;border-top:1px solid #C5A467;margin:24px 0 12px">' +
    '<p style="margin:0;font-size:12px;color:#6B5A44">FIR Clinic · Firmare Rotinas de Gestão</p>' +
    '</div></body></html>'

  return { tipo, para: dados.para, assunto: ASSUNTOS[tipo], texto, html }
}

/** O link do e-mail: SÓ `URL_PUBLICA` (appsec 14), e o token no FRAGMENTO (spec 3.2). */
export function linkDoToken(
  urlPublica: string,
  finalidade: 'convite' | 'redefinicao' | 'confirmacao_de_email',
  token: string,
): string {
  const pagina = finalidade === 'confirmacao_de_email' ? 'confirmar-email' : 'criar-senha'
  return `${urlPublica}/${pagina}#t=${token}`
}
