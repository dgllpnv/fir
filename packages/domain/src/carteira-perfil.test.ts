import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  CHAVES_DE_MODULO,
  PERFIL_DE_COLABORADORA_NOVA,
  PERMS_CARTEIRA,
  type ChaveDaCarteira,
  type PerfilDaCarteira,
  ehAcessoTotal,
  perfilDeAcessoTotal,
  responsavelImpostoPeloPerfil,
  temPermCarteira,
} from './carteira'

/**
 * G8 0.5 — `temPermCarteira`, a função única de autorização da carteira
 * (appsec A-2, A-4, A-5). Seam: `packages/domain` puro.
 */

const base: PerfilDaCarteira = {
  escopo: 'geral',
  valores: false,
  carteira: 'todos',
  modulos: [],
  administrar: false,
}

const chaves = PERMS_CARTEIRA.map((p) => p[0]) as ChaveDaCarteira[]

const perfilArb: fc.Arbitrary<PerfilDaCarteira> = fc.record({
  escopo: fc.constantFrom('geral' as const, 'grupo' as const),
  valores: fc.boolean(),
  carteira: fc.constantFrom('minha' as const, 'todos' as const),
  modulos: fc.subarray([...CHAVES_DE_MODULO, 'inexistente', 'valores']),
  administrar: fc.boolean(),
})

describe('temPermCarteira: valores', () => {
  it('com o bit `valores`, vê; sem, não vê', () => {
    expect(temPermCarteira({ ...base, valores: true }, 'valores')).toBe(true)
    expect(temPermCarteira({ ...base, valores: false }, 'valores')).toBe(false)
  })

  it('sem perfil, nega toda chave (falha fechada)', () => {
    for (const k of chaves) {
      expect(temPermCarteira(null, k)).toBe(false)
      expect(temPermCarteira(undefined, k)).toBe(false)
    }
  })

  it('`valores` gravado como módulo não concede valores: a origem é o bit, nunca a lista', () => {
    expect(temPermCarteira({ ...base, modulos: ['valores'] }, 'valores')).toBe(false)
  })
})

describe('temPermCarteira: dependências vivem na tabela (A-4)', () => {
  it('`mensalidades` sem `valores` não entra; com `valores` entra', () => {
    expect(temPermCarteira({ ...base, valores: false }, 'mensalidades')).toBe(false)
    expect(temPermCarteira({ ...base, valores: true }, 'mensalidades')).toBe(true)
  })

  it('propriedade: toda chave concedida tem todas as dependências concedidas', () => {
    fc.assert(
      fc.property(perfilArb, (perfil) => {
        for (const linha of PERMS_CARTEIRA) {
          if (!temPermCarteira(perfil, linha[0])) continue
          for (const dep of linha[3] as readonly ChaveDaCarteira[]) {
            expect(temPermCarteira(perfil, dep)).toBe(true)
          }
        }
      }),
    )
  })
})

describe('temPermCarteira: módulos são negação por padrão', () => {
  it('módulo fora da lista é negado; dentro, concedido', () => {
    expect(temPermCarteira({ ...base, modulos: ['clientes'] }, 'clientes')).toBe(true)
    expect(temPermCarteira({ ...base, modulos: ['clientes'] }, 'rotina')).toBe(false)
  })

  it('o Método vale para toda sessão ativa, como no protótipo (`can`, L1116)', () => {
    expect(temPermCarteira({ ...base, modulos: [] }, 'metodo')).toBe(true)
  })
})

describe('temPermCarteira: escopo grupo nunca recebe chave "só geral" (A-5)', () => {
  it('acesso total gravado para escopo grupo não inclui painel, resumo, Administração nem administrar', () => {
    const grupo: PerfilDaCarteira = {
      escopo: 'grupo',
      valores: true,
      carteira: 'todos',
      modulos: [...CHAVES_DE_MODULO],
      administrar: true,
    }
    expect(temPermCarteira(grupo, 'painel')).toBe(false)
    expect(temPermCarteira(grupo, 'resumo')).toBe(false)
    expect(temPermCarteira(grupo, 'cadastros')).toBe(false)
    expect(temPermCarteira(grupo, 'carteira.administrar')).toBe(false)
    expect(temPermCarteira(grupo, 'clientes')).toBe(true)
    expect(temPermCarteira(grupo, 'valores')).toBe(true)
  })

  it('propriedade: para escopo grupo, nenhuma chave marcada "só geral" é concedida', () => {
    fc.assert(
      fc.property(perfilArb, (perfil) => {
        const g = { ...perfil, escopo: 'grupo' as const }
        for (const linha of PERMS_CARTEIRA) {
          if (linha[4]) expect(temPermCarteira(g, linha[0])).toBe(false)
        }
      }),
    )
  })
})

describe('"acesso total" é o conjunto de chaves, não um atalho (A-2)', () => {
  it('o perfil de acesso total concede toda chave, no escopo geral', () => {
    const total = { escopo: 'geral' as const, ...perfilDeAcessoTotal('geral') }
    for (const k of chaves) expect(temPermCarteira(total, k)).toBe(true)
    expect(ehAcessoTotal(total)).toBe(true)
  })

  it('tirar um único módulo do acesso total tira exatamente aquela tela', () => {
    const total = { escopo: 'geral' as const, ...perfilDeAcessoTotal('geral') }
    const semMetas = { ...total, modulos: total.modulos.filter((m) => m !== 'metas') }
    expect(temPermCarteira(semMetas, 'metas')).toBe(false)
    expect(temPermCarteira(semMetas, 'clientes')).toBe(true)
    expect(ehAcessoTotal(semMetas)).toBe(false)
  })

  it('a colaboradora nova do protótipo (L2965): clientes e rotina, só a própria carteira, sem valores', () => {
    const nova = { escopo: 'geral' as const, ...PERFIL_DE_COLABORADORA_NOVA }
    expect(temPermCarteira(nova, 'clientes')).toBe(true)
    expect(temPermCarteira(nova, 'rotina')).toBe(true)
    expect(temPermCarteira(nova, 'metas')).toBe(false)
    expect(temPermCarteira(nova, 'valores')).toBe(false)
    expect(temPermCarteira(nova, 'carteira.todos')).toBe(false)
  })
})

describe('"só a minha carteira" (A-3)', () => {
  it('`minha` impõe o próprio id; `todos` não restringe', () => {
    expect(responsavelImpostoPeloPerfil({ ...base, id: 'u1', carteira: 'minha' })).toBe('u1')
    expect(responsavelImpostoPeloPerfil({ ...base, id: 'u1', carteira: 'todos' })).toBeNull()
  })

  it('propriedade: a restrição depende só de `carteira`, nunca de módulo, valores ou administrar', () => {
    fc.assert(
      fc.property(perfilArb, (perfil) => {
        const r = responsavelImpostoPeloPerfil({ ...perfil, id: 'eu' })
        expect(r).toBe(perfil.carteira === 'minha' ? 'eu' : null)
      }),
    )
  })
})

describe('setor nunca é autorização (A-4)', () => {
  it('um campo `setor` a mais no objeto não muda nenhuma decisão', () => {
    fc.assert(
      fc.property(perfilArb, fc.constantFrom('diretoria', 'comercial', 'administrativo', 'financeiro'), (perfil, setor) => {
        const comSetor = { ...perfil, setor } as PerfilDaCarteira
        for (const k of chaves) expect(temPermCarteira(comSetor, k)).toBe(temPermCarteira(perfil, k))
      }),
    )
  })
})
