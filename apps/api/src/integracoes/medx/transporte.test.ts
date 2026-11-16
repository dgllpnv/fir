import http from 'node:http'
import { lookup } from 'node:dns'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ErroDoMedx } from './erros'
import { type Transporte, criarTransporte } from './transporte'

/**
 * O transporte do MedX (gate S-8, S-10, S-11) contra um servidor falso local.
 * Em teste o protocolo é http e o lookup aceita loopback; em produção é https
 * com `lookupSoPublico` (`criarTransporte` sem esses dois parâmetros).
 */
let servidor: http.Server
let base: string
let ultimo: { metodo?: string; url?: string; auth?: string; corpo?: string } = {}
const TOKEN = 'tok_SEGREDO_que_nao_pode_vazar_1234567890'

beforeAll(async () => {
  servidor = http.createServer((req, res) => {
    let corpo = ''
    req.on('data', (p) => (corpo += p))
    req.on('end', () => {
      ultimo = { metodo: req.method!, url: req.url!, auth: req.headers.authorization ?? '', corpo }
      const u = new URL(req.url!, 'http://x')
      switch (u.pathname) {
        case '/api/integration/v1/ok':
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
          return res.end('{"a":1}')
        case '/api/integration/v1/html':
          res.writeHead(200, { 'content-type': 'text/html' })
          return res.end('<html>desafio</html>')
        case '/api/integration/v1/redireciona':
          res.writeHead(302, { location: 'http://outro.exemplo/roubar' })
          return res.end()
        case '/api/integration/v1/ecoa':
          res.writeHead(500, { 'content-type': 'application/json' })
          return res.end(JSON.stringify({ erro: `token ${TOKEN} da paciente Maria da Silva` }))
        case '/api/integration/v1/grande':
          res.writeHead(200, { 'content-type': 'application/json' })
          return res.end(`{"x":"${'a'.repeat(3 * 1024 * 1024)}"}`)
        case '/api/integration/v1/limite':
          res.writeHead(429, { 'content-type': 'application/json', 'retry-after': '3600' })
          return res.end('{}')
        default:
          res.writeHead(Number(u.searchParams.get('status') ?? 404), { 'content-type': 'application/json' })
          return res.end('{}')
      }
    })
  })
  await new Promise<void>((r) => servidor.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`
})
afterAll(() => new Promise<void>((r) => servidor.close(() => r())))

const transporte = (): Transporte =>
  criarTransporte({ base, requisitar: http.request, lookup, tetoDeBytes: 2 * 1024 * 1024 })

async function erroDe(p: Promise<unknown>): Promise<ErroDoMedx> {
  const e = await p.then(
    () => null,
    (x: unknown) => x,
  )
  expect(e).toBeInstanceOf(ErroDoMedx)
  return e as ErroDoMedx
}

describe('transporte do MedX', () => {
  it('GET com Bearer devolve o texto JSON; a query vai codificada', async () => {
    const t = await transporte()({ metodo: 'GET', caminho: '/ok', query: { Inicio: '2026-11-16T00:00:00', x: 'a b' }, bearer: 'jwt' })
    expect(t).toBe('{"a":1}')
    expect(ultimo.auth).toBe('Bearer jwt')
    expect(ultimo.url).toBe('/api/integration/v1/ok?Inicio=2026-11-16T00%3A00%3A00&x=a+b')
  })

  it('POST envia o corpo JSON', async () => {
    await transporte()({ metodo: 'POST', caminho: '/ok', corpo: { integrationToken: TOKEN } })
    expect(ultimo.metodo).toBe('POST')
    expect(JSON.parse(ultimo.corpo!)).toEqual({ integrationToken: TOKEN })
  })

  it('200 com HTML é "resposta inválida", não dado', async () => {
    expect((await erroDe(transporte()({ metodo: 'GET', caminho: '/html' }))).codigo).toBe('nao_json')
  })

  it('cada status vira um código do catálogo; 404 é "não encontrado" (a confirmação por id depende dele)', async () => {
    for (const [status, codigo] of [
      [401, 'recusada'],
      [403, 'sem_permissao'],
      [404, 'nao_encontrado'],
      [429, 'limite'],
      [503, 'indisponivel'],
    ] as const) {
      const e = await erroDe(transporte()({ metodo: 'GET', caminho: '/status', query: { status: String(status) } }))
      expect(e.codigo, String(status)).toBe(codigo)
    }
  })

  it('redirect não é seguido: o Bearer nunca sai para outro host', async () => {
    expect((await erroDe(transporte()({ metodo: 'GET', caminho: '/redireciona', bearer: 'jwt' }))).codigo).toBe(
      'redirecionou',
    )
  })

  it('o erro nunca carrega o corpo, o token nem o nome do paciente', async () => {
    const e = await erroDe(transporte()({ metodo: 'POST', caminho: '/ecoa', corpo: { integrationToken: TOKEN } }))
    expect(e.codigo).toBe('indisponivel')
    const tudo = `${e.message} ${e.stack ?? ''} ${JSON.stringify(e)}`
    expect(tudo).not.toContain(TOKEN)
    expect(tudo).not.toContain('Maria')
  })

  it('resposta acima do teto é recusada', async () => {
    expect((await erroDe(transporte()({ metodo: 'GET', caminho: '/grande' }))).codigo).toBe('grande_demais')
  })

  it('401, 403 e 429 viram mensagens do catálogo; o Retry-After não faz dormir', async () => {
    expect((await erroDe(transporte()({ metodo: 'GET', caminho: '/x', query: { status: '401' } }))).codigo).toBe('recusada')
    expect((await erroDe(transporte()({ metodo: 'GET', caminho: '/x', query: { status: '403' } }))).codigo).toBe(
      'sem_permissao',
    )
    const inicio = Date.now()
    const e = await erroDe(transporte()({ metodo: 'GET', caminho: '/limite' }))
    expect(e.codigo).toBe('limite')
    expect(Date.now() - inicio).toBeLessThan(2000)
  })

  it('a base precisa ser https em produção', () => {
    expect(() => criarTransporte({ base: 'http://medx.exemplo' })).toThrow(/https/)
    expect(() => criarTransporte({ base: 'https://medx.exemplo:8443' })).toThrow(/443/)
  })

  it('caminho com ".." ou fora da API é recusado antes de virar URL', async () => {
    expect((await erroDe(transporte()({ metodo: 'GET', caminho: '/contatos/../financas/faturas' }))).codigo).toBe('contrato')
  })
})
