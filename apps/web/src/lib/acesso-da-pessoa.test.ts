import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { PessoaNaLista } from '@fir/contracts'
import { describe, expect, it } from 'vitest'
import { caminhoDaSenha, emailParaOPatch, recadoDoEnvio, seloDoAcesso } from './acesso-da-pessoa'
import { CHAVE_DO_ADIAMENTO, adiarFaixa, esquecerAdiamento, faixaAdiada, mostraFaixaDoEmail } from './faixa-do-email'

type Acesso = Pick<
  PessoaNaLista,
  'situacaoDoAcesso' | 'emailConfirmado' | 'email' | 'emailPendente' | 'ativo' | 'euMesma'
>
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

describe('o caminho da senha (spec 2.7): o link primeiro, a provisória como saída', () => {
  it('envio ligado e e-mail CONFIRMADO: o principal é o link de redefinição', () => {
    expect(caminhoDaSenha(base, true)).toEqual({ tipo: 'link', finalidade: 'redefinicao' })
  })

  it('convidada com e-mail pendente: o principal é reenviar o convite', () => {
    for (const situacaoDoAcesso of ['convite_pendente', 'convite_vencido'] as const) {
      expect(
        caminhoDaSenha(com({ situacaoDoAcesso, emailConfirmado: false, email: null, emailPendente: 'x@y.co' }), true),
      ).toEqual({ tipo: 'link', finalidade: 'convite' })
    }
  })

  it('envio DESLIGADO: o caminho de hoje, a provisória, sem explicação a mais', () => {
    expect(caminhoDaSenha(base, false)).toEqual({ tipo: 'provisoria', motivo: null })
    expect(
      caminhoDaSenha(com({ situacaoDoAcesso: 'convite_pendente', email: null, emailPendente: 'x@y.co' }), false),
    ).toEqual({ tipo: 'provisoria', motivo: null })
  })

  it('sem e-mail nenhum: a provisória, sem explicação a mais', () => {
    expect(caminhoDaSenha(com({ emailConfirmado: false, email: null }), true)).toEqual({
      tipo: 'provisoria',
      motivo: null,
    })
  })

  it('só o PENDENTE, já com senha: a provisória, e diz por quê (appsec 4 — o link não vai para e-mail não confirmado)', () => {
    const r = caminhoDaSenha(com({ emailConfirmado: false, email: null, emailPendente: 'x@y.co' }), true)
    expect(r.tipo).toBe('provisoria')
    expect(r.tipo === 'provisoria' ? r.motivo : null).toMatch(/não confirmou/)
  })

  it('convidada SEM e-mail: a provisória, e diz o que falta', () => {
    const r = caminhoDaSenha(com({ situacaoDoAcesso: 'convite_vencido', email: null, emailPendente: null }), true)
    expect(r.tipo === 'provisoria' ? r.motivo : null).toMatch(/Cadastre o e-mail/)
  })

  it('desativada: a provisória (o link não serviria, spec 3.9)', () => {
    const r = caminhoDaSenha(com({ ativo: false }), true)
    expect(r.tipo).toBe('provisoria')
    expect(r.tipo === 'provisoria' ? r.motivo : null).toMatch(/desativada/)
  })

  it('a própria pessoa: nada de link (a própria senha se troca em Trocar senha)', () => {
    expect(caminhoDaSenha(com({ euMesma: true }), true)).toEqual({ tipo: 'provisoria', motivo: null })
  })

  it('a ficha do PAINEL (sem `euMesma` nem `emailConfirmado`) segue a mesma regra: confirmado é `email !== null`', () => {
    const doPainel = { situacaoDoAcesso: 'ativo' as const, email: 'a@b.co', emailPendente: null, ativo: true }
    expect(caminhoDaSenha(doPainel, true)).toEqual({ tipo: 'link', finalidade: 'redefinicao' })
    expect(caminhoDaSenha({ ...doPainel, email: null, emailPendente: 'a@b.co' }, true).tipo).toBe('provisoria')
  })
})

describe('o recado depois do envio: o endereço mascarado, nunca a senha', () => {
  it('convite e redefinição dizem o que aconteceu e por quanto tempo vale', () => {
    expect(recadoDoEnvio('convite', 'a***@b***.co')).toBe(
      'Convite reenviado para a***@b***.co. O anterior deixou de valer.',
    )
    expect(recadoDoEnvio('redefinicao', 'a***@b***.co')).toBe(
      'Link para redefinir a senha enviado para a***@b***.co. Vale por 1 hora.',
    )
    expect(recadoDoEnvio('redefinicao', null)).toMatch(/o e-mail dela/)
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

  /**
   * Spec 2.7: com o envio ligado e e-mail que recebe, o principal é o LINK, e
   * a provisória vira saída rotulada. A varredura pega a regressão que a
   * lógica pura não vê: a tela voltar a oferecer "Redefinir senha" (a
   * provisória) como a ação de sempre, ao lado de um link escondido embaixo.
   */
  it('Usuários e acessos: o link é o principal, e a provisória só aparece como saída nesse caso', () => {
    const tela = ler('..', 'components', 'tela-usuarios.tsx')
    expect(tela).toMatch(/caminhoDaSenha\(p, envioDeEmail\)/)
    expect(tela).toMatch(/Sem acesso ao e-mail\? Gerar senha provisória/)
    expect(tela).toMatch(/caminho\.tipo === 'provisoria'[\s\S]{0,400}Redefinir senha/)
    expect(tela).toMatch(/recadoDoEnvio\(finalidade, r\.enviadoPara\)/)
  })

  it('o painel › Pessoas: a mesma regra, com o caminho do painel', () => {
    const tela = ler('..', 'app', 'gestao', 'clinicas', '[id]', 'pessoas', 'page.tsx')
    expect(tela).toMatch(/v1\/acesso\/config/)
    expect(tela).toMatch(/caminhoDaSenha\(p, envioDeEmail\)/)
    expect(tela).toMatch(/\$\{base\}\/\$\{p\.id\}\/\$\{finalidade\}/)
    expect(tela).toMatch(/Sem acesso ao e-mail\? Gerar senha provisória/)
    expect(tela).toMatch(/recadoDoEnvio\(finalidade, r\.enviadoPara\)/)
  })
})
