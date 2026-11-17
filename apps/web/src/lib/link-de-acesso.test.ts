import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ROTAS_DE_LINK, entrarNaClinica, tokenDoFragmento } from './link-de-acesso'

const AQUI = dirname(fileURLToPath(import.meta.url))
const ler = (...p: string[]) => readFileSync(join(AQUI, ...p), 'utf8')
const semComentarios = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')

describe('o token do fragmento', () => {
  it('lê `#t=` com e sem o `#`', () => {
    expect(tokenDoFragmento('#t=abc_-123')).toBe('abc_-123')
    expect(tokenDoFragmento('t=abc')).toBe('abc')
  })

  it('sem token, vazio ou outra chave: null', () => {
    expect(tokenDoFragmento('')).toBeNull()
    expect(tokenDoFragmento('#')).toBeNull()
    expect(tokenDoFragmento('#t=')).toBeNull()
    expect(tokenDoFragmento('#x=abc')).toBeNull()
  })

  it('o botão Entrar leva a clínica, e só a clínica', () => {
    expect(entrarNaClinica('demo')).toBe('/entrar?clinica=demo')
    expect(entrarNaClinica('')).toBe('/entrar')
  })
})

describe('as páginas de link (appsec 15 e 16)', () => {
  const PAGINAS = {
    '/criar-senha': semComentarios(ler('..', 'app', 'criar-senha', 'page.tsx')),
    '/confirmar-email': semComentarios(ler('..', 'app', 'confirmar-email', 'page.tsx')),
  }

  it('leem o token pelo fragmento e o apagam da barra', () => {
    for (const [rota, fonte] of Object.entries(PAGINAS)) {
      expect(fonte, rota).toMatch(/lerEApagarToken\(\)/)
      expect(fonte, rota).not.toMatch(/useSearchParams|location\.search/)
    }
  })

  it('consultar na montagem; usar só no envio do formulário', () => {
    for (const [rota, fonte] of Object.entries(PAGINAS)) {
      expect(fonte, rota).toMatch(/v1\/link-de-acesso\/consultar/)
      expect(fonte, rota).toMatch(/v1\/link-de-acesso\/usar/)
      // `usar` mora dentro da função de envio, nunca no efeito da montagem.
      const efeito = fonte.slice(fonte.indexOf('useEffect('), fonte.indexOf('}, [])'))
      expect(efeito, rota).not.toMatch(/link-de-acesso\/usar/)
    }
  })

  it('nenhum script de terceiro', () => {
    for (const [rota, fonte] of Object.entries(PAGINAS)) {
      expect(fonte, rota).not.toMatch(/<script|next\/script|https?:\/\//)
    }
  })

  it('`next.config` manda Referrer-Policy: no-referrer nas mesmas rotas', () => {
    const config = ler('..', '..', 'next.config.mjs')
    expect(config).toMatch(/'Referrer-Policy', value: 'no-referrer'/)
    for (const rota of ROTAS_DE_LINK) expect(config).toContain(`'${rota}'`)
  })
})
