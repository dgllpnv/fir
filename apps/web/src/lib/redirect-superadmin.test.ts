import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// A rota web `/superadmin` virou `/gestao`; a URL antiga tem de seguir viva
// (favoritos da cliente) com redirect PERMANENTE. `permanent: true` no Next é 308.
describe('/superadmin redireciona para /gestao', () => {
  const config = readFileSync(join(__dirname, '..', '..', 'next.config.mjs'), 'utf8')

  it('declara a raiz e o resto do caminho como permanentes', () => {
    expect(config).toContain("{ source: '/superadmin', destination: '/gestao', permanent: true }")
    expect(config).toContain(
      "{ source: '/superadmin/:caminho*', destination: '/gestao/:caminho*', permanent: true }",
    )
  })

  it('o build emitiu 308 para as duas (quando há build)', () => {
    let manifesto: string
    try {
      manifesto = readFileSync(join(__dirname, '..', '..', '.next', 'routes-manifest.json'), 'utf8')
    } catch {
      return
    }
    const { redirects } = JSON.parse(manifesto) as {
      redirects: { source: string; destination: string; statusCode: number }[]
    }
    for (const [de, para] of [
      ['/superadmin', '/gestao'],
      ['/superadmin/:caminho*', '/gestao/:caminho*'],
    ] as const) {
      const r = redirects.find((x) => x.source === de)
      expect(r?.destination).toBe(para)
      expect(r?.statusCode).toBe(308)
    }
  })
})
