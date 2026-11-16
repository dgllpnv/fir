import { describe, expect, it } from 'vitest'
import { ErroDoMedx } from './erros'
import { LeitorDoMedx, avaliarEscopos } from './leitor-do-medx'
import type { Pedido, Transporte } from './transporte'

/**
 * O `LeitorDoMedx` (seam declarado): sessão com cache em memória, leitura
 * paginada tudo-ou-nada e a avaliação dos escopos. O transporte é falso.
 */
function falso(respostas: (p: Pedido, n: number) => unknown) {
  const pedidos: Pedido[] = []
  const t: Transporte = async (p) => {
    pedidos.push(p)
    const r = respostas(p, pedidos.length)
    if (r instanceof Error) throw r
    return typeof r === 'string' ? r : JSON.stringify(r)
  }
  return { t, pedidos }
}

const TOKEN_OK = { accessToken: 'jwt-1', tokenType: 'Bearer', expiresInSeconds: 900, scope: 'agenda:read contatos:details:read' }

describe('sessão (gate S-12)', () => {
  it('troca a chave por um JWT uma vez e o reaproveita até perto de expirar', async () => {
    let agora = 0
    const { t, pedidos } = falso((p) => (p.caminho === '/token' ? TOKEN_OK : {}))
    const leitor = new LeitorDoMedx(t, () => agora)
    const s1 = await leitor.sessao('c1', 'imp1', 'chave')
    const s2 = await leitor.sessao('c1', 'imp1', 'chave')
    expect(s1.jwt).toBe('jwt-1')
    expect(s2).toBe(s1)
    expect(s1.escopos).toEqual(['agenda:read', 'contatos:details:read'])
    expect(pedidos.filter((p) => p.caminho === '/token')).toHaveLength(1)
    expect(pedidos[0]).toMatchObject({ metodo: 'POST', corpo: { integrationToken: 'chave' } })
    agora = 900_000 - 30_000
    await leitor.sessao('c1', 'imp1', 'chave')
    expect(pedidos.filter((p) => p.caminho === '/token')).toHaveLength(2)
  })

  it('duas clínicas, ou a chave trocada, nunca usam o JWT uma da outra', async () => {
    let n = 0
    const { t } = falso((p) => (p.caminho === '/token' ? { ...TOKEN_OK, accessToken: `jwt-${++n}` } : {}))
    const leitor = new LeitorDoMedx(t, () => 0)
    const a = await leitor.sessao('c1', 'imp1', 'k1')
    const b = await leitor.sessao('c2', 'imp2', 'k2')
    const a2 = await leitor.sessao('c1', 'imp-nova', 'k3')
    expect(new Set([a.jwt, b.jwt, a2.jwt]).size).toBe(3)
  })

  it('token sem accessToken é contrato inválido', async () => {
    const { t } = falso(() => ({ accessToken: null, expiresInSeconds: 900, scope: '' }))
    await expect(new LeitorDoMedx(t, () => 0).sessao('c1', 'i', 'k')).rejects.toMatchObject({ codigo: 'contrato' })
  })
})

describe('leituras', () => {
  const comToken = (resto: (p: Pedido) => unknown) => falso((p) => (p.caminho === '/token' ? TOKEN_OK : resto(p)))

  it('usuário atual: só id e nome atravessam', async () => {
    const { t } = comToken(() => ({ id: -7, nome: 'Integração FIR', conselho: 'CRM 1/BA', profissionalDaAgenda: false }))
    const leitor = new LeitorDoMedx(t, () => 0)
    const u = await leitor.usuarioAtual(await leitor.sessao('c1', 'i', 'k'))
    expect(u).toEqual({ id: '-7', nome: 'Integração FIR' })
  })

  it('unidades: segue o cursor até o fim e conta', async () => {
    const { t, pedidos } = comToken((p) =>
      p.query?.['Cursor'] === undefined
        ? { unidades: [{ id: 1, nome: 'A' }], page: { hasMore: true, nextCursor: 'c2' } }
        : { unidades: [{ id: 2, nome: 'B' }], page: { hasMore: false, nextCursor: null } },
    )
    const leitor = new LeitorDoMedx(t, () => 0)
    expect(await leitor.quantasUnidades(await leitor.sessao('c1', 'i', 'k'))).toBe(2)
    expect(pedidos.at(-1)?.bearer).toBe('jwt-1')
  })

  it('cursor que se repete aborta (laço infinito)', async () => {
    const { t } = comToken(() => ({ unidades: [{ id: 1 }], page: { hasMore: true, nextCursor: 'mesmo' } }))
    const leitor = new LeitorDoMedx(t, () => 0)
    await expect(leitor.quantasUnidades(await leitor.sessao('c1', 'i', 'k'))).rejects.toMatchObject({ codigo: 'contrato' })
  })

  it('lista nula, JSON quebrado ou página falhando no meio: erro, nunca resultado parcial', async () => {
    for (const ruim of [
      () => ({ unidades: null, page: { hasMore: false } }),
      () => '{"unidades": [',
      (p: Pedido) =>
        p.query?.['Cursor'] === undefined
          ? { unidades: [{ id: 1 }], page: { hasMore: true, nextCursor: 'c2' } }
          : new ErroDoMedx('indisponivel'),
    ]) {
      const { t } = comToken(ruim)
      const leitor = new LeitorDoMedx(t, () => 0)
      await expect(leitor.quantasUnidades(await leitor.sessao('c1', 'i', 'k'))).rejects.toBeInstanceOf(ErroDoMedx)
    }
  })
})

describe('escopos (gate LGPD B5)', () => {
  it('só agenda: precisa de agenda, contatos e o catálogo de finanças', () => {
    expect(avaliarEscopos(['agenda:read', 'contatos:details:read', 'financas:read'], { faturamento: false })).toEqual({
      faltam: [],
      sobram: [],
    })
    expect(avaliarEscopos(['agenda:read'], { faturamento: false }).faltam).toEqual([
      'contatos:details:read',
      'financas:read',
    ])
  })

  it('escrita, prontuário ou lista de contatos sobram', () => {
    const r = avaliarEscopos(
      ['agenda:read', 'contatos:details:read', 'financas:read', 'agenda:write', 'prontuario:summary:read', 'contatos:read'],
      { faturamento: false },
    )
    expect(r.sobram).toEqual(['agenda:write', 'contatos:read', 'prontuario:summary:read'])
  })

  it('o escopo de lançamentos ou de faturas só é permitido com o faturamento', () => {
    const base = ['agenda:read', 'contatos:details:read', 'financas:read', 'lancamentos:read']
    expect(avaliarEscopos(base, { faturamento: false }).sobram).toEqual(['lancamentos:read'])
    expect(avaliarEscopos(base, { faturamento: true })).toEqual({ faltam: [], sobram: [] })
    expect(avaliarEscopos(base.slice(0, 3), { faturamento: true }).faltam).toEqual(['lancamentos:read ou faturas:read'])
  })
})

describe('só leitura (D5, gate S-19)', () => {
  it('nenhum arquivo da integração pede POST além do /token, nem PUT, PATCH ou DELETE', async () => {
    const { readdirSync, readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const pasta = join(__dirname, '..')
    const arquivos = (readdirSync(pasta, { recursive: true }) as string[])
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && !f.includes('integracoes-no-painel'))
    expect(arquivos.length).toBeGreaterThan(3)
    for (const f of arquivos) {
      const fonte = readFileSync(join(pasta, f), 'utf8')
      expect(fonte, f).not.toMatch(/metodo:\s*'(PUT|PATCH|DELETE)'/)
      for (const m of fonte.matchAll(/metodo:\s*'POST'[^}]*/g)) expect(m[0], f).toMatch(/caminho:\s*'\/token'/)
    }
  })
})
