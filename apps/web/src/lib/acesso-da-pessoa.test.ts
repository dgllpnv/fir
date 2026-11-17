import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { PessoaNaLista } from '@fir/contracts'
import { describe, expect, it } from 'vitest'
import { acoesDeEmail, emailParaOPatch, seloDoAcesso } from './acesso-da-pessoa'
import { CHAVE_DO_ADIAMENTO, adiarFaixa, esquecerAdiamento, faixaAdiada, mostraFaixaDoEmail } from './faixa-do-email'

type Acesso = Parameters<typeof acoesDeEmail>[0]
const base: Acesso = {
  situacaoDoAcesso: 'ativo',
  emailConfirmado: true,
  email: 'ana@clinica.com',
  emailPendente: null,
  ativo: true,
  euMesma: false,
}
const com = (p: Partial<Acesso>): Acesso => ({ ...base, ...p })

describe('o selo do acesso', () => {
  it('convite vencido e pendente vêm antes do e-mail não confirmado', () => {
    expect(seloDoAcesso(com({ situacaoDoAcesso: 'convite_vencido', emailConfirmado: false, emailPendente: 'x@y.co' }))?.texto).toBe('Convite vencido')
    expect(seloDoAcesso(com({ situacaoDoAcesso: 'convite_pendente', emailConfirmado: false, emailPendente: 'x@y.co' }))?.texto).toBe('Convite pendente')
    expect(seloDoAcesso(com({ emailConfirmado: false, email: null, emailPendente: 'x@y.co' }))?.texto).toBe('E-mail não confirmado')
  })

  it('confirmado, ou sem e-mail nenhum: sem selo', () => {
    expect(seloDoAcesso(base)).toBeNull()
    expect(seloDoAcesso(com({ emailConfirmado: false, email: null, emailPendente: null }))).toBeNull()
  })
})

describe('Reenviar convite e Enviar link', () => {
  it('envio desligado ou a própria pessoa: nenhuma das duas existe', () => {
    expect(acoesDeEmail(base, false)).toEqual({ convite: null, redefinicao: null })
    expect(acoesDeEmail(com({ euMesma: true }), true)).toEqual({ convite: null, redefinicao: null })
  })

  it('convidada: só Reenviar convite, ligado com e-mail pendente', () => {
    const r = acoesDeEmail(com({ situacaoDoAcesso: 'convite_vencido', emailConfirmado: false, email: null, emailPendente: 'x@y.co' }), true)
    expect(r.redefinicao).toBeNull()
    expect(r.convite).toEqual({ habilitada: true, motivo: null })
  })

  it('redefinição só com e-mail CONFIRMADO (appsec 4)', () => {
    expect(acoesDeEmail(base, true).redefinicao).toEqual({ habilitada: true, motivo: null })
    const sem = acoesDeEmail(com({ emailConfirmado: false, email: null, emailPendente: 'x@y.co' }), true)
    expect(sem.redefinicao?.habilitada).toBe(false)
    expect(sem.redefinicao?.motivo).toMatch(/não confirmou/)
  })

  it('desativada não recebe nada', () => {
    expect(acoesDeEmail(com({ ativo: false }), true).redefinicao?.habilitada).toBe(false)
  })
})

describe('o e-mail no PATCH', () => {
  const p: Pick<PessoaNaLista, 'email' | 'emailPendente'> = { email: 'ana@clinica.com', emailPendente: null }
  it('igual (depois de canonizar) não vai no corpo', () => {
    expect(emailParaOPatch(' Ana@Clinica.com ', p)).toBeUndefined()
  })
  it('vazio retira; vazio sobre vazio não manda nada', () => {
    expect(emailParaOPatch('', p)).toBeNull()
    expect(emailParaOPatch('', { email: null, emailPendente: null })).toBeUndefined()
  })
  it('novo vai canônico; fora da forma volta como erro', () => {
    expect(emailParaOPatch('Nova@Clinica.com', p)).toBe('nova@clinica.com')
    expect(emailParaOPatch('sem-arroba', p)).toMatchObject({ erro: expect.any(String) })
  })
})

describe('a faixa "Cadastre seu e-mail"', () => {
  it('só para pessoa sem e-mail confirmado, com o envio ligado', () => {
    expect(mostraFaixaDoEmail({ emailConfirmado: false }, true)).toBe(true)
    expect(mostraFaixaDoEmail({ emailConfirmado: true }, true)).toBe(false)
    expect(mostraFaixaDoEmail({ emailConfirmado: false }, false)).toBe(false)
    // Sessão de suporte do operador: não há pessoa.
    expect(mostraFaixaDoEmail(null, true)).toBe(false)
  })

  it('"Agora não" guarda na sessão do navegador, e a entrada esquece', () => {
    const m = new Map<string, string>()
    const a = {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
      removeItem: (k: string) => void m.delete(k),
    }
    expect(faixaAdiada(a)).toBe(false)
    adiarFaixa(a)
    expect(m.get(CHAVE_DO_ADIAMENTO)).toBe('1')
    expect(faixaAdiada(a)).toBe(true)
    esquecerAdiamento(a)
    expect(faixaAdiada(a)).toBe(false)
  })

  it('armazenamento que lança não derruba nada', () => {
    const lanca = {
      getItem: () => {
        throw new Error('bloqueado')
      },
      setItem: () => {
        throw new Error('bloqueado')
      },
      removeItem: () => {
        throw new Error('bloqueado')
      },
    }
    expect(faixaAdiada(lanca)).toBe(false)
    expect(() => adiarFaixa(lanca)).not.toThrow()
    expect(() => esquecerAdiamento(lanca)).not.toThrow()
  })
})

describe('as telas usam o que está acima (varredura de fonte)', () => {
  const AQUI = dirname(fileURLToPath(import.meta.url))
  const ler = (...c: string[]) =>
    readFileSync(join(AQUI, ...c), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')

  it('a entrada diz "Usuário ou e-mail" e mostra o esqueci só com o envio ligado', () => {
    const entrar = ler('..', 'app', 'entrar', 'page.tsx')
    expect(entrar).toMatch(/Usuário ou e-mail/)
    expect(entrar).toMatch(/\{envioDeEmail \? \(\s*<a className="link link-de-acesso" href=\{linkDoEsqueci\(clinica\)\}>\s*Esqueci minha senha/)
    expect(entrar).toMatch(/esquecerAdiamento\(\)/)
  })

  it('a faixa fica no layout logado, decidida no servidor, e nunca para o operador', () => {
    const layout = ler('..', 'app', '(app)', 'layout.tsx')
    expect(layout).toMatch(/mostraFaixaDoEmail\(pessoa, await envioDeEmailLigado\(\)\)/)
    expect(layout).toMatch(/pessoa !== null && !pessoa\.emailConfirmado/)
  })

  it('a faixa e o E-mail da troca de senha exigem a senha atual', () => {
    const meu = ler('..', 'components', 'meu-email.tsx')
    expect(meu).toMatch(/v1\/eu\/email/)
    expect(meu).toMatch(/JSON\.stringify\(\{ email: canonico, senha \}\)/)
    expect(ler('..', 'components', 'faixa-do-email.tsx')).toMatch(/Agora não/)
  })

  it('Usuários e acessos: e-mail obrigatório na criação, e o aviso do envio desligado', () => {
    const tela = ler('..', 'components', 'tela-usuarios.tsx')
    expect(tela).toMatch(/email: canonizarEmail\(email\)/)
    expect(tela).toMatch(
      /O envio de e-mail ainda não está ligado nesta instalação; passe a senha provisória à pessoa\./,
    )
    expect(tela).toMatch(/Convite enviado para \$\{p\.emailPendente\}/)
    expect(tela).toMatch(/v1\/pessoas\/\$\{p\.id\}\/\$\{finalidade\}/)
  })
})
