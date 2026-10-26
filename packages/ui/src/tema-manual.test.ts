import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * O tema escuro existe em DOIS lugares do `tokens.css`: o bloco que segue o
 * sistema operacional (`prefers-color-scheme`) e o bloco do seletor manual
 * (`[data-theme='dark']`). CSS não tem como reaproveitar um no outro, então a
 * duplicação é inevitável — o que não é inevitável é ela divergir em silêncio.
 *
 * Foi o que aconteceu: `--gold` estava só no bloco do sistema. Como os dois
 * temas usam o mesmo dourado hoje, nada quebrava — e era isso que tornava a
 * falta perigosa. Quem mudasse o dourado no escuro criaria uma divergência que
 * só aparece para quem escolheu "Escuro" num computador com sistema claro.
 */
const CSS = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'tokens.css'),
  'utf8',
)

/** As declarações de um bloco, do `{` até o `}` que o fecha. */
function bloco(abertura: string): Map<string, string> {
  const i = CSS.indexOf(abertura)
  if (i < 0) throw new Error(`bloco não encontrado: ${abertura}`)
  const inicio = CSS.indexOf('{', i + abertura.length) + 1
  let nivel = 1
  let j = inicio
  while (nivel > 0 && j < CSS.length) {
    if (CSS[j] === '{') nivel++
    else if (CSS[j] === '}') nivel--
    j++
  }
  const mapa = new Map<string, string>()
  for (const m of CSS.slice(inicio, j).matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    mapa.set(m[1]!, m[2]!.trim().toLowerCase())
  }
  return mapa
}

const sistema = bloco("@media (prefers-color-scheme: dark)")
const manual = bloco(":root[data-theme='dark']")

describe('o tema escuro manual não diverge do automático', () => {
  it('a varredura leu os dois blocos', () => {
    expect(sistema.size, 'bloco do sistema vazio').toBeGreaterThan(10)
    expect(manual.size, 'bloco manual vazio').toBeGreaterThan(10)
  })

  it('declaram exatamente as mesmas variáveis', () => {
    expect([...manual.keys()].sort(), 'variável presente só no sistema').toEqual(
      [...sistema.keys()].sort(),
    )
  })

  it('e com os mesmos valores', () => {
    for (const [nome, valor] of sistema) {
      expect(
        manual.get(nome),
        `${nome}: o sistema diz ${valor}, o manual diz ${manual.get(nome)} — ` +
          `quem escolher "Escuro" num computador de sistema claro vê o valor errado`,
      ).toBe(valor)
    }
  })
})
