import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * **"Modo reunião abre com fundo claro"** (1.9 F, critério de aceite) — também
 * no aparelho de tema escuro. A reunião refixa, no escopo `.rn`, os tokens do
 * tema CLARO; este teste cobra que cada token que as folhas usam esteja lá, e
 * com o MESMO valor de `:root` em `tokens.css` (os pares já medidos em
 * `contraste.test.ts`). Um token esquecido herdaria o escuro do sistema — um
 * cartão marrom-escuro na TV creme — e nada mais o veria.
 */
const AQUI = dirname(fileURLToPath(import.meta.url))
const REUNIAO = readFileSync(join(AQUI, 'reuniao.css'), 'utf8')
const TOKENS = readFileSync(join(AQUI, '../../../../../packages/ui/src/tokens.css'), 'utf8')

function declaracoes(css: string, abertura: string): Map<string, string> {
  const i = css.indexOf(abertura)
  if (i < 0) throw new Error(`bloco não encontrado: ${abertura}`)
  const inicio = css.indexOf('{', i) + 1
  let nivel = 1
  let j = inicio
  while (nivel > 0 && j < css.length) {
    if (css[j] === '{') nivel++
    else if (css[j] === '}') nivel--
    j++
  }
  const corpo = css.slice(inicio, j).replace(/\/\*[\s\S]*?\*\//g, '')
  return new Map([...corpo.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!.trim().toLowerCase()]))
}

/** Os tokens de cor que mudam entre os temas: os do bloco escuro do seletor manual. */
const DO_TEMA = [...declaracoes(TOKENS, ":root[data-theme='dark']").keys()].filter((t) => !t.startsWith('--clinic-'))

describe('Modo reunião: sempre o tema claro', () => {
  const claro = declaracoes(TOKENS, ':root {')
  const rn = declaracoes(REUNIAO, '.rn {')

  it('o escopo da reunião refixa cada token de cor do tema, com o valor do claro', () => {
    expect(DO_TEMA.length).toBeGreaterThan(10)
    for (const t of DO_TEMA) {
      expect(rn.get(t), `${t} no .rn`).toBe(claro.get(t))
    }
  })

  it('e diz ao navegador que é clara (barra de rolagem e campos do formulário)', () => {
    expect(REUNIAO.slice(REUNIAO.indexOf('.rn {'), REUNIAO.indexOf('}', REUNIAO.indexOf('.rn {')))).toContain('color-scheme: light')
  })
})
