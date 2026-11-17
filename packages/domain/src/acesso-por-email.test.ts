import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  PRAZO_DO_LINK_MS,
  canonizarEmail,
  identificadorEhEmail,
  mascararEmail,
  primeiroNome,
  situacaoDoAcesso,
  situacaoDoLink,
  validarEmail,
} from './acesso-por-email'
import { ehErro } from './resultado'

describe('canonizarEmail e validarEmail', () => {
  it('tira espaço e caixa: o que o teclado do celular entrega vira a forma do banco', () => {
    expect(canonizarEmail('  Juliana.Souza@Gmail.COM ')).toBe('juliana.souza@gmail.com')
  })

  it('recusa o que não tem @, domínio com ponto, ou tem espaço', () => {
    for (const ruim of ['', 'juliana', 'juliana@', 'juliana@gmail', 'ju liana@gmail.com', '@gmail.com']) {
      expect(ehErro(validarEmail(canonizarEmail(ruim)))).toBe(true)
    }
    expect(ehErro(validarEmail('juliana@gmail.com'))).toBe(false)
  })

  it('identificador com @ é e-mail; sem @ é usuário', () => {
    expect(identificadorEhEmail('ana@x.com')).toBe(true)
    expect(identificadorEhEmail('ana.silva')).toBe(false)
  })
})

describe('prazos dos links (backlog 3.2)', () => {
  it('convite 7 dias, redefinição 1 hora, confirmação 24 horas', () => {
    expect(PRAZO_DO_LINK_MS.convite).toBe(604_800_000)
    expect(PRAZO_DO_LINK_MS.redefinicao).toBe(3_600_000)
    expect(PRAZO_DO_LINK_MS.confirmacao_de_email).toBe(86_400_000)
  })
})

describe('situacaoDoLink', () => {
  const expiraEm = new Date('2026-11-16T15:00:00Z')
  const base = { expiraEm, usadoEm: null, invalidadoEm: null }

  it('vale até o instante anterior ao prazo, e no prazo exato já venceu (semiaberto)', () => {
    expect(situacaoDoLink(base, new Date('2026-11-16T14:59:59.999Z'))).toBe('valido')
    expect(situacaoDoLink(base, expiraEm)).toBe('vencido')
  })

  it('usado vence a tudo: a pessoa precisa ouvir "já foi usado", não "venceu"', () => {
    const usado = { ...base, usadoEm: new Date('2026-11-16T14:00:00Z'), invalidadoEm: new Date() }
    expect(situacaoDoLink(usado, new Date('2026-11-17T00:00:00Z'))).toBe('usado')
  })

  it('invalidado por um link mais novo não vale mesmo dentro do prazo', () => {
    const inv = { ...base, invalidadoEm: new Date('2026-11-16T14:10:00Z') }
    expect(situacaoDoLink(inv, new Date('2026-11-16T14:20:00Z'))).toBe('invalidado')
  })

  it('propriedade: só é válido quem não foi usado, não foi invalidado e está antes do prazo', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10_000 }),
        fc.integer({ min: 0, max: 10_000 }),
        fc.boolean(),
        fc.boolean(),
        (prazo, agora, usado, invalidado) => {
          const s = situacaoDoLink(
            {
              expiraEm: new Date(prazo),
              usadoEm: usado ? new Date(0) : null,
              invalidadoEm: invalidado ? new Date(0) : null,
            },
            new Date(agora),
          )
          expect(s === 'valido').toBe(!usado && !invalidado && agora < prazo)
        },
      ),
    )
  })
})

describe('mascararEmail', () => {
  it('mostra a inicial do nome e do domínio, e o sufixo', () => {
    expect(mascararEmail('juliana@gmail.com')).toBe('j***@g***.com')
    expect(mascararEmail('a@clinica.com.br')).toBe('a***@c***.br')
  })

  it('propriedade: a máscara nunca contém o endereço inteiro nem a parte local de 2+ letras', () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[a-z]{2,12}$/),
        fc.stringMatching(/^[a-z]{2,12}$/),
        (local, dominio) => {
          const email = `${local}@${dominio}.com`
          const m = mascararEmail(email)
          expect(m.includes(email)).toBe(false)
          expect(m.includes(`${local}@`)).toBe(false)
        },
      ),
    )
  })

  it('sem @ não vaza nada', () => {
    expect(mascararEmail('semarroba')).toBe('***')
  })
})

describe('primeiroNome', () => {
  it('pega a primeira palavra', () => {
    expect(primeiroNome('  Juliana  Souza ')).toBe('Juliana')
  })
})

describe('situacaoDoAcesso', () => {
  const agora = new Date('2026-11-16T12:00:00Z')

  it('quem já criou a senha é ativo, haja convite ou não', () => {
    expect(situacaoDoAcesso({ aguardandoPrimeiraSenha: false }, null, agora)).toBe('ativo')
    expect(
      situacaoDoAcesso({ aguardandoPrimeiraSenha: false }, { expiraEm: new Date('2026-11-20T00:00:00Z') }, agora),
    ).toBe('ativo')
  })

  it('convidada com convite vivo dentro do prazo: pendente; no prazo exato ou sem convite: vencido', () => {
    const aguardando = { aguardandoPrimeiraSenha: true }
    expect(situacaoDoAcesso(aguardando, { expiraEm: new Date('2026-11-16T12:00:00.001Z') }, agora)).toBe(
      'convite_pendente',
    )
    expect(situacaoDoAcesso(aguardando, { expiraEm: agora }, agora)).toBe('convite_vencido')
    expect(situacaoDoAcesso(aguardando, null, agora)).toBe('convite_vencido')
  })
})
