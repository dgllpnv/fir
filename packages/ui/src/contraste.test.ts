import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * O contraste medido, não olhado.
 *
 * `docs/design.md` §2 publica uma tabela de razões WCAG e §5 cobra "o
 * contraste passa em AA nos dois temas, inclusive o dourado". A tabela foi
 * escrita à mão uma vez e envelhece em silêncio: basta alguém escurecer o
 * `--bg` ou clarear o `--gold-ink` meio ponto. Esta varredura lê os VALORES
 * do `tokens.css` e refaz a conta.
 *
 * Por que isto não é cosmético: a usuária é a recepcionista de pé, no balcão,
 * muitas vezes com o monitor de lado e o reflexo da janela em cima. Pílula de
 * "Atrasada" que ela não lê é tarefa que ela não vê.
 *
 * **O que isto NÃO cobre:** o par precisa estar listado abaixo. Cor nova usada
 * como texto sem entrar nesta lista continua invisível para a varredura — o
 * teto honesto de um teste que lê tokens e não a árvore renderizada.
 */

const TOKENS = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'tokens.css'),
  'utf8',
)

/**
 * Os tokens de um tema, lidos do arquivo.
 *
 * O bloco claro é `:root {`; o escuro, `:root[data-theme='dark'] {`. O bloco
 * de `prefers-color-scheme` repete os mesmos valores do seletor manual — se um
 * dia divergirem, o teste do final deste arquivo acusa.
 */
function tema(abridor: string): Record<string, string> {
  const i = TOKENS.indexOf(abridor)
  if (i < 0) throw new Error(`bloco não encontrado: ${abridor}`)
  const corpo = TOKENS.slice(i + abridor.length, TOKENS.indexOf('}', i))
  const fora: Record<string, string> = {}
  for (const m of corpo.matchAll(/(--[\w-]+):\s*(#[0-9a-fA-F]{6})/g)) {
    fora[m[1]!] = m[2]!.toLowerCase()
  }
  return fora
}

const CLARO = tema(':root {')
const ESCURO_MANUAL = tema(":root[data-theme='dark'] {")
// O escuro herda do claro tudo o que não redeclara — é como o CSS resolve.
const ESCURO = { ...CLARO, ...ESCURO_MANUAL }

/** sRGB → luminância relativa, WCAG 2.1 §relative-luminance. */
function luminancia(hex: string): number {
  const canal = (i: number): number => {
    const c = Number.parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * canal(0) + 0.7152 * canal(1) + 0.0722 * canal(2)
}

function razao(a: string, b: string): number {
  const [x, y] = [luminancia(a), luminancia(b)].sort((p, q) => q - p) as [number, number]
  return (x + 0.05) / (y + 0.05)
}

/**
 * Os pares de TEXTO sobre fundo que o design usa de fato, com o uso nomeado.
 *
 * `--gold` não aparece como tinta em nenhum par: ele é traço, borda e realce.
 * Sobre o claro ele dá 2,21:1 — menos da metade do mínimo —, e é o erro mais
 * comum desta paleta.
 */
const TEXTO: readonly [string, string, string][] = [
  ['--ink', '--bg', 'texto corrente'],
  ['--ink', '--surface', 'texto dentro de cartão'],
  ['--muted', '--bg', 'linha de meta, nota, rótulo'],
  ['--muted', '--surface', 'linha de meta dentro de cartão'],
  ['--gold-ink', '--bg', 'eyebrow, link'],
  ['--gold-ink', '--surface', 'link dentro de cartão'],
  ['--on-gold-soft', '--gold-soft', 'contador, pílula de paciente'],
  ['--on-gold', '--gold', 'chip escolhido, dia selecionado da semana'],
  ['--warn-ink', '--surface', 'pílula “Atrasada”'],
  ['--warn-ink', '--bg', 'pílula “Atrasada” fora de cartão'],
  ['--ok', '--surface', 'pílula “Concluída”, botão de WhatsApp'],
  ['--bad', '--surface', 'pílula “Urgente”, “Cancelar tarefa”, erro'],
  ['--bad', '--bg', 'erro fora de cartão'],
  ['--bad', '--bad-soft', 'contador de pendentes'],
  ['--btn-ink', '--btn-bg', 'botão primário'],
]

/** AA para texto normal. 11,5 px em negrito NÃO é "texto grande" (18,66 px). */
const AA = 4.5

describe.each([
  ['claro', CLARO],
  ['escuro', ESCURO],
])('contraste no tema %s', (nome, t) => {
  it.each(TEXTO)('%s sobre %s (%s) passa em AA', (tinta, fundo, uso) => {
    const a = t[tinta]
    const b = t[fundo]
    expect(a, `${tinta} não existe no tema ${nome}`).toBeDefined()
    expect(b, `${fundo} não existe no tema ${nome}`).toBeDefined()
    const r = razao(a!, b!)
    expect(
      r,
      `${uso}: ${tinta} (${a}) sobre ${fundo} (${b}) dá ${r.toFixed(2)}:1 no tema ${nome}`,
    ).toBeGreaterThanOrEqual(AA)
  })
})

describe('a varredura mede alguma coisa', () => {
  it('os dois temas foram lidos', () => {
    expect(Object.keys(CLARO).length).toBeGreaterThan(10)
    expect(Object.keys(ESCURO_MANUAL).length).toBeGreaterThan(5)
  })

  /**
   * `--gold` como TINTA é o erro mais comum desta paleta, e `docs/design.md`
   * publica o número: 2,21:1 sobre o claro. O teste trava o número para que a
   * conta acima não possa estar errada e passar mesmo assim — se `razao`
   * quebrar, isto quebra junto.
   */
  it('o número publicado em design.md para --gold sobre --bg continua valendo', () => {
    expect(razao(CLARO['--gold']!, CLARO['--bg']!)).toBeCloseTo(2.21, 1)
  })

  /**
   * O bloco de `prefers-color-scheme` e o seletor manual precisam declarar os
   * MESMOS valores. Divergindo, o tema do sistema e o botão de tema pintam a
   * tela de duas maneiras, e só uma delas foi medida.
   */
  it('o tema escuro automático e o manual não divergem', () => {
    // Comparar os blocos CRUS acusaria um token que um deles redeclara com o
    // valor que o claro já tinha — diferença de escrita, não de resultado. O
    // que importa é o tema RESOLVIDO, que é como o navegador o lê.
    const automatico = { ...CLARO, ...tema(":root:not([data-theme='light']) {") }
    for (const chave of Object.keys(automatico)) {
      expect(ESCURO[chave], `${chave} difere entre o tema automático e o manual`).toBe(
        automatico[chave],
      )
    }
  })
})
