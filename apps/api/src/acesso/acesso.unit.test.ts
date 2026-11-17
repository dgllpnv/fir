import { describe, expect, it } from 'vitest'
import { ChaveDeEmail } from './chave-de-email'
import { CorreioSmtp, envioDoAmbiente, envioLigado, FalhaDeEnvio } from './correio'
import { ASSUNTOS, linkDoToken, montarMensagem, numaLinha, prazoEmTexto, type TipoDeMensagem } from './mensagens'

const TOKEN = 'A'.repeat(43)
const URL_PUBLICA = 'https://fir.teste'
const TIPOS: readonly TipoDeMensagem[] = [
  'convite',
  'redefinicao',
  'confirmacao_de_email',
  'senha_alterada',
  'email_trocado',
]
const comLink = (t: TipoDeMensagem) =>
  t === 'convite' || t === 'redefinicao' || t === 'confirmacao_de_email'

describe('mensagens do acesso (LGPD L1, L2; appsec 14, 19)', () => {
  it('o link vai só para URL_PUBLICA, com o token no fragmento', () => {
    expect(linkDoToken(URL_PUBLICA, 'convite', TOKEN)).toBe(`${URL_PUBLICA}/criar-senha#t=${TOKEN}`)
    expect(linkDoToken(URL_PUBLICA, 'redefinicao', TOKEN)).toBe(`${URL_PUBLICA}/criar-senha#t=${TOKEN}`)
    expect(linkDoToken(URL_PUBLICA, 'confirmacao_de_email', TOKEN)).toBe(
      `${URL_PUBLICA}/confirmar-email#t=${TOKEN}`,
    )
  })

  it('cada tipo tem o assunto fixo, sem dado do usuário', () => {
    for (const t of TIPOS) {
      const m = montarMensagem(t, {
        para: 'ana@x.com',
        clinicaNome: 'Clínica\r\nBcc: x@y.com',
        nomeDaPessoa: 'Ana Souza',
        ...(comLink(t) ? { link: linkDoToken(URL_PUBLICA, 'convite', TOKEN) } : {}),
      })
      expect(m.assunto).toBe(ASSUNTOS[t])
      expect(m.assunto).not.toMatch(/Ana|Clínica/)
    }
  })

  it('primeiro nome só, sem sobrenome e sem usuário; nenhum href fora da URL pública; nenhuma imagem', () => {
    for (const t of TIPOS) {
      const m = montarMensagem(t, {
        para: 'ana@x.com',
        clinicaNome: 'Clínica Sol',
        nomeDaPessoa: 'Ana Souza Lima',
        ...(comLink(t) ? { link: linkDoToken(URL_PUBLICA, 'redefinicao', TOKEN) } : {}),
      })
      for (const corpo of [m.texto, m.html]) {
        expect(corpo).toContain('Ana')
        expect(corpo).not.toContain('Souza')
        expect(corpo).not.toContain('ana@x.com')
      }
      expect(m.html).not.toMatch(/<img|url\(|<script|<link /i)
      const hrefs = [...m.html.matchAll(/href="([^"]*)"/g)].map((x) => x[1])
      if (comLink(t)) {
        expect(hrefs.length).toBe(1)
        expect(hrefs[0]!.startsWith(`${URL_PUBLICA}/`)).toBe(true)
      } else {
        // Os avisos (L11) não levam link: é o formato do phishing que denunciam.
        expect(hrefs).toEqual([])
        expect(m.texto).not.toContain('http')
      }
    }
  })

  it('o nome da clínica e da pessoa entram ESCAPADOS e numa linha só', () => {
    const m = montarMensagem('convite', {
      para: 'ana@x.com',
      clinicaNome: '<b>Sol</b>\n<a href="https://mal.example">clique</a>',
      nomeDaPessoa: '<script>alert(1)</script>',
      link: linkDoToken(URL_PUBLICA, 'convite', TOKEN),
    })
    expect(m.html).not.toContain('<b>')
    expect(m.html).not.toContain('<script>')
    expect(m.html).not.toContain('href="https://mal.example"')
    expect(m.html).toContain('&lt;b&gt;Sol&lt;/b&gt;')
    expect(numaLinha('a\r\nb c\td')).toBe('a b c d')
  })

  it('o prazo do texto vem do domínio', () => {
    expect(prazoEmTexto(7 * 24 * 3_600_000)).toBe('7 dias')
    expect(prazoEmTexto(3_600_000)).toBe('1 hora')
    expect(prazoEmTexto(24 * 3_600_000)).toBe('24 horas')
  })
})

describe('CorreioSmtp — o log nunca leva endereço, token nem erro cru (L3)', () => {
  const mensagem = montarMensagem('redefinicao', {
    para: 'juliana.souza@gmail.com',
    clinicaNome: 'Sol',
    nomeDaPessoa: 'Juliana',
    link: linkDoToken(URL_PUBLICA, 'redefinicao', TOKEN),
  })

  it('enviado: tipo e destinatário mascarado', async () => {
    const linhas: string[] = []
    const enviados: Record<string, unknown>[] = []
    const c = new CorreioSmtp(
      { sendMail: async (o) => void enviados.push(o) },
      'FIR <x@y.com>',
      (l) => linhas.push(l),
    )
    await c.enviar(mensagem)
    expect(enviados[0]).toMatchObject({ to: 'juliana.souza@gmail.com', from: 'FIR <x@y.com>' })
    expect(linhas).toEqual(['[correio] redefinicao: enviado para j***@g***.com'])
  })

  it('falhou: só o código, e a exceção não carrega a mensagem do provedor', async () => {
    const linhas: string[] = []
    const cru = Object.assign(new Error('550 5.1.1 <juliana.souza@gmail.com>: user unknown'), {
      responseCode: 550,
      response: '550 5.1.1 <juliana.souza@gmail.com>',
    })
    const c = new CorreioSmtp({ sendMail: () => Promise.reject(cru) }, 'x', (l) => linhas.push(l))
    const e = await c.enviar(mensagem).catch((x: unknown) => x)
    expect(e).toBeInstanceOf(FalhaDeEnvio)
    expect(String((e as Error).message)).not.toContain('juliana')
    expect(linhas).toEqual(['[correio] redefinicao: falhou (550) para j***@g***.com'])
    for (const l of linhas) {
      expect(l).not.toContain(TOKEN)
      expect(l).not.toContain(URL_PUBLICA)
      expect(l).not.toContain('juliana.souza')
    }
  })
})

describe('envioDoAmbiente — ligado só com SMTP_HOST e URL_PUBLICA', () => {
  it('falta um dos dois: desligado', () => {
    expect(envioLigado(envioDoAmbiente({ SMTP_HOST: 'smtp.x.com' }))).toBe(false)
    expect(envioLigado(envioDoAmbiente({ URL_PUBLICA: 'https://fir.x' }))).toBe(false)
    expect(envioLigado(envioDoAmbiente({ SMTP_HOST: 'smtp.x.com', URL_PUBLICA: 'não é url' }))).toBe(
      false,
    )
  })

  it('os dois: ligado, e a URL sem barra final', () => {
    const e = envioDoAmbiente({ SMTP_HOST: 'smtp.x.com', URL_PUBLICA: 'https://fir.x/' })
    expect(envioLigado(e)).toBe(true)
    expect(e.urlPublica).toBe('https://fir.x')
  })
})

describe('ChaveDeEmail — HMAC, nunca o endereço (L7)', () => {
  it('determinístico por chave, e outra chave dá outro valor', () => {
    const a = new ChaveDeEmail('pepper-um-com-tamanho-suficiente-para-hkdf')
    const b = new ChaveDeEmail('pepper-dois-com-tamanho-suficiente-para-hkdf')
    expect(a.hmac('ana@x.com')).toMatch(/^[0-9a-f]{64}$/)
    expect(a.hmac('ana@x.com')).toBe(a.hmac('ana@x.com'))
    expect(a.hmac('ana@x.com')).not.toBe(b.hmac('ana@x.com'))
    expect(a.hmac('ana@x.com')).not.toContain('ana')
  })

  it('confere só o mesmo endereço', () => {
    const a = new ChaveDeEmail('pepper-um-com-tamanho-suficiente-para-hkdf')
    const h = a.hmac('ana@x.com')
    expect(a.confere('ana@x.com', h)).toBe(true)
    expect(a.confere('bia@x.com', h)).toBe(false)
    expect(a.confere(null, h)).toBe(false)
  })
})
