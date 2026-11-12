import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * **COLISÃO DE NOME DE CLASSE — a falha que não dá erro em lugar nenhum.**
 *
 * O sistema de design é uma folha só, importada inteira por `globals.css`.
 * Isso é deliberado (a classe existe uma vez, não três), e tem um preço: um
 * nome genérico num arquivo alcança todo elemento com aquele nome em
 * **qualquer** tela. Nada avisa. Nenhum teste de unidade vê. A tela só nasce
 * errada, e numa tela interna ninguém reclama.
 *
 * Esta varredura nasceu de dois defeitos medidos no mesmo dia:
 *
 *  1. **`.barra`** — a faixa do painel do superadmin usava `className="barra"`,
 *     e `rotina.css` tem um `.barra` que é a barra de progresso da meta (8 px
 *     de altura, `overflow: hidden`). A faixa inteira desabou para 17 px, com
 *     "PAINEL INTERNO" cortado ao meio.
 *  2. **`.alerta`** — `equipe.css` tinha `.alerta { display: flex;
 *     min-height: 56px; border-bottom: … }` para a linha de alerta da tela
 *     Equipe. Mas `pill alerta` é a pílula "Atrasada" do cartão de tarefa, em
 *     catorze lugares: `equipe.css` vem depois de `rotina.css`, e a pílula de
 *     20 px virava uma caixa de 56 px com borda embaixo, **na tela Hoje**.
 *
 * O que ela cobra: **variante de `.pill` não pode ser classe solta.** É a
 * forma exata dos dois defeitos — um nome curto que serve de adjetivo num
 * lugar e de substantivo em outro.
 */

const UI = dirname(fileURLToPath(import.meta.url))
const FOLHAS = readdirSync(UI)
  .filter((f) => f.endsWith('.css'))
  .map((f) => ({ nome: f, texto: readFileSync(join(UI, f), 'utf8') }))

/** Os seletores de cada folha, sem comentário e sem corpo. */
function seletores(texto: string): string[] {
  return [...texto.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{[^{}]*\}/g)]
    .flatMap((m) => m[1]!.split(','))
    .map((s) => s.trim())
    .filter((s) => s !== '' && !s.startsWith('@') && !s.startsWith('/'))
}

/**
 * O PRIMEIRO composto do seletor — o que decide se a regra precisa de um
 * ancestral.
 *
 * `.alerta > .info` começa em `.alerta`: alcança qualquer elemento com essa
 * classe. `.alertas > .alerta` começa em `.alertas`: só alcança quem estiver
 * dentro de um. É essa a diferença entre os dois, e é a correção inteira.
 */
const primeiroComposto = (seletor: string): string => seletor.split(/[\s>+~]+/)[0] ?? ''

/** As variantes que só fazem sentido ACOMPANHADAS de `.pill`. */
const VARIANTES = ['alerta', 'bom', 'mau', 'dourado', 'paciente', 'critico']

describe('variante de pílula não é classe solta', () => {
  it('a varredura leu as folhas', () => {
    expect(FOLHAS.length).toBeGreaterThan(5)
    expect(seletores(FOLHAS.map((f) => f.texto).join('\n')).length).toBeGreaterThan(100)
  })

  it.each(VARIANTES)('`.%s` nunca alcança um elemento sozinha', (variante) => {
    const soltas: string[] = []
    for (const folha of FOLHAS) {
      for (const s of seletores(folha.texto)) {
        const inicio = primeiroComposto(s)
        if (!new RegExp(`\\.${variante}(?![\\w-])`).test(inicio)) continue
        // Acompanhada de `.pill` no MESMO composto, é variante — é para isso
        // que ela existe. Sozinha, é outra classe com o mesmo nome.
        if (/\.pill(?![\w-])/.test(inicio)) continue
        soltas.push(`${folha.nome}: ${s}`)
      }
    }
    expect(
      soltas,
      `regra que alcança qualquer elemento .${variante}: escope-a por um ancestral — foi assim que a pílula "Atrasada" virou uma caixa de 56 px na tela Hoje`,
    ).toEqual([])
  })
})

describe('o painel do superadmin não compartilha nome com o produto', () => {
  /**
   * O outro lado da mesma moeda: `superadmin.css` é a folha de um espaço
   * inteiro à parte, e as classes só dele levam prefixo. A varredura do lado
   * do JSX está em `apps/web/src/app/gestao/identidade.test.ts`; esta olha
   * o CSS, que é onde a colisão nasce.
   */
  it('nenhuma regra de superadmin.css alcança um elemento do produto', () => {
    const painel = FOLHAS.find((f) => f.nome === 'superadmin.css')!
    const outras = FOLHAS.filter((f) => f.nome !== 'superadmin.css')
      .map((f) => f.texto.replace(/\/\*[\s\S]*?\*\//g, ''))
      .join('\n')
    const doProduto = (c: string): boolean => new RegExp(`\\.${c}(?![\\w-])`).test(outras)

    const soltas: string[] = []
    for (const s of seletores(painel.texto)) {
      const classes = [...s.matchAll(/\.([\w-]+)/g)].map((m) => m[1]!)
      // Basta UMA classe que o produto não conhece em qualquer ponto do
      // seletor: ela é a condição que prende a regra ao painel. É por isso que
      // `.campo .erro-reservado` passa (o `.campo` é compartilhado de
      // propósito, mas `.erro-reservado` não existe no produto) e `.barra`
      // sozinha não passaria.
      if (classes.some((c) => !doProduto(c))) continue
      soltas.push(`${s}  (só classes do produto: ${classes.join(', ')})`)
    }
    expect(
      soltas,
      'regra de superadmin.css escrita só com classes do produto: ela pinta telas da clínica. Prefixe a classe que é do painel',
    ).toEqual([])
  })
})
