import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * **O FATURAMENTO DO MEDX NÃO É RECEBIMENTO — arquitetura** (spec
 * integracao-medx C.3; parecer de números A11 e N-B4.3).
 *
 * O número do MedX mora AO LADO do número da FIR, nunca dentro dele. As
 * proibições abaixo são estruturais porque o defeito que elas barram não
 * aparece em teste de comportamento: a receita do mês que dobra só aparece no
 * fechamento (regra 3).
 *
 *  1. Só o leitor do faturamento escreve nas duas tabelas.
 *  2. Financeiro, migração (a conferência da regra 28) e caixa nunca as leem.
 *  3. A integração nunca toca as tabelas de dinheiro da FIR.
 *  4. A integração nunca lê número de fora com o parser do que a recepção
 *     digita (`deTexto`: `"1.250"` vira R$ 1.250,00) nem com ponto flutuante.
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
const semComentarios = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const todos = fontes(SRC).map((p) => ({ p: rel(p), s: semComentarios(readFileSync(p, 'utf8')) }))

const TABELAS = /\b(leituras|historico)_de_faturamento_externo\b/
const ESCRITA = /\b(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(leituras|historico)_de_faturamento_externo\b/i
const LEITOR = 'apps/api/src/integracoes/medx/faturamento-do-medx.ts'
const daIntegracao = todos.filter((f) => f.p.startsWith('apps/api/src/integracoes/'))

describe('o faturamento do MedX — arquitetura', () => {
  it('só o leitor do faturamento escreve nas tabelas do faturamento externo', () => {
    const fora = todos.filter((f) => ESCRITA.test(f.s)).map((f) => f.p).filter((p) => p !== LEITOR)
    expect(fora).toEqual([])
  })

  it('a varredura tem dentes: o leitor ESTÁ na lista de quem escreve', () => {
    expect(todos.some((f) => f.p === LEITOR && ESCRITA.test(f.s))).toBe(true)
  })

  it('financeiro, migração e caixa nunca leem o faturamento externo', () => {
    // O caixa e a Visão do mês moram em financeiro/; a conferência da regra 28, em migracao/.
    const proibidos = ['apps/api/src/financeiro/', 'apps/api/src/migracao/', 'apps/api/src/migracoes/']
    const fora = todos.filter((f) => proibidos.some((d) => f.p.startsWith(d)) && TABELAS.test(f.s)).map((f) => f.p)
    expect(fora, 'o número do MedX fica ao lado, nunca dentro (C.3)').toEqual([])
  })

  it('a integração nunca toca as tabelas de dinheiro da FIR', () => {
    const fora = daIntegracao
      .filter((f) => /\b(recebimentos|recebimento_partes|caixas_do_dia|outras_entradas)\b/.test(f.s))
      .map((f) => f.p)
    expect(fora).toEqual([])
  })

  it('a integração nunca lê número de fora com deTexto, parseFloat ou toFixed (N-B4.3)', () => {
    const fora = daIntegracao.filter((f) => /\b(deTexto|parseFloat|toFixed)\s*\(/.test(f.s)).map((f) => f.p)
    expect(fora, 'use Dinheiro.deDecimalExterno').toEqual([])
  })

  it('a varredura da integração tem dentes: o leitor usa deDecimalExterno', () => {
    expect(daIntegracao.some((f) => f.p === LEITOR && /deDecimalExterno\(/.test(f.s))).toBe(true)
  })
})
