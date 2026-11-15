import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * **ARQUITETURA DAS PARTES DO PAGAMENTO (fatia 4.1).**
 *
 * Duas proibições estruturais, no mesmo espírito de `dinheiro-que-entrou.test.ts`:
 *
 *  1. `INSERT INTO recebimentos` só existe em `financeiro/partes.ts`
 *     (`gravarRecebimento`). O quinto ponto de escrita nasceria sem as partes —
 *     e o caixa não veria o dinheiro dele.
 *  2. `r.forma` (a forma LEGADA do recebimento) só é lida pelo módulo de partes
 *     e pela conferência da migração. Quem pergunta "por forma" lê as PARTES;
 *     ler `recebimentos.forma` conta a maior parte como se fosse o todo.
 */
const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(RAIZ, 'apps/api/src')

function fontes(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n)
    if (statSync(p).isDirectory()) return n === 'node_modules' || n === '__tests__' ? [] : fontes(p)
    return /\.ts$/.test(n) && !/\.test\.ts$/.test(n) ? [p] : []
  })
}
const rel = (p: string) => relative(RAIZ, p).split(sep).join('/')
// Sem comentários: a história de uma regra pode citar `r.forma` à vontade.
const semComentarios = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const todos = fontes(SRC).map((p) => ({ p: rel(p), s: semComentarios(readFileSync(p, 'utf8')) }))

describe('as partes do pagamento — arquitetura', () => {
  it('INSERT INTO recebimentos só em financeiro/partes.ts', () => {
    const fora = todos
      .filter((f) => /INSERT\s+INTO\s+recebimentos\b/i.test(f.s))
      .map((f) => f.p)
      .filter((p) => p !== 'apps/api/src/financeiro/partes.ts')
    expect(fora, 'escreva por gravarRecebimento').toEqual([])
  })

  it('a varredura tem dentes: partes.ts ESTÁ na lista de quem escreve', () => {
    expect(todos.some((f) => f.p === 'apps/api/src/financeiro/partes.ts' && /INSERT\s+INTO\s+recebimentos\b/i.test(f.s))).toBe(true)
  })

  it('r.forma só no módulo de partes e na conferência da migração', () => {
    const permitidos = new Set([
      'apps/api/src/financeiro/partes.ts',
      'apps/api/src/migracao/conferencia.service.ts',
    ])
    const fora = todos
      .filter((f) => /\br\.forma\b/.test(f.s))
      .map((f) => f.p)
      .filter((p) => !permitidos.has(p))
    expect(fora, 'leia as partes (PARTES_EM_JSON ou recebimento_partes)').toEqual([])
  })

  it('só os leitores por forma tocam recebimento_partes: LTV, ticket, campanha e saldo ficam em recebimentos', () => {
    const permitidos = new Set([
      'apps/api/src/financeiro/partes.ts',
      'apps/api/src/financeiro/caixa.service.ts',
      'apps/api/src/financeiro/visao-do-mes.service.ts',
      'apps/api/src/financeiro/dinheiro-que-entrou.ts',
      'apps/api/src/painel-geral/painel.service.ts',
      'apps/api/src/migracao/conferencia.service.ts',
    ])
    const fora = todos
      .filter((f) => /recebimento_partes/.test(f.s))
      .map((f) => f.p)
      .filter((p) => !permitidos.has(p))
    expect(fora).toEqual([])
  })
})
