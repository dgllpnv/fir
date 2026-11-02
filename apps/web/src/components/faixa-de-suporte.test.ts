import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * **INVARIANTE 4 DA D-13: quem está usando precisa SABER que é operador.**
 *
 * Uma sessão de suporte parece a de uma administradora — menu completo,
 * dinheiro na tela, nome da clínica na lateral. Sem um sinal permanente, quem
 * a usa age achando que é a clínica agindo, e o operador com duas abas em duas
 * clínicas não distingue uma da outra.
 *
 * Não há Testing Library nesta árvore (dívida registrada em `docs/dividas.md`),
 * então a varredura é sobre a FONTE — a mesma forma de
 * `app/superadmin/identidade.test.ts`, e pelo mesmo motivo: o que ela pega não
 * é tudo, mas é exatamente o que voltaria.
 */
const AQUI = dirname(fileURLToPath(import.meta.url))
const ler = (...p: string[]) => readFileSync(join(AQUI, ...p), 'utf8')

const FAIXA = ler('faixa-de-suporte.tsx')
const SHELL = ler('shell.tsx')
const LAYOUT = ler('..', 'app', '(app)', 'layout.tsx')
const SESSAO = ler('..', 'lib', 'sessao.ts')
const UI = join(AQUI, '..', '..', '..', '..', 'packages', 'ui', 'src')
const CSS_PAINEL = readFileSync(join(UI, 'superadmin.css'), 'utf8')
const CSS_SHELL = readFileSync(join(UI, 'shell.css'), 'utf8')
const CSS_TOKENS = readFileSync(join(UI, 'tokens.css'), 'utf8')

const semComentarios = (texto: string): string =>
  texto.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')

describe('a faixa diz que a sessão é do painel', () => {
  it('ela nomeia a sessão, e a palavra é "suporte"', () => {
    expect(FAIXA).toMatch(/Sessão de suporte/)
    expect(FAIXA).toMatch(/Painel interno/)
  })

  it('ela afirma o que mais importa: que não é uma pessoa da clínica', () => {
    expect(semComentarios(FAIXA)).toMatch(/não é uma pessoa desta clínica/)
  })

  it('ela nomeia o OPERADOR, e nunca uma pessoa', () => {
    const codigo = semComentarios(FAIXA)
    expect(codigo).toMatch(/operador\.nome/)
    expect(codigo).toMatch(/operador\.usuario/)
    // Nada de `eu.usuario` aqui: não há pessoa nenhuma nesta sessão, e um
    // nome de funcionária na faixa seria a afirmação falsa que ela existe
    // para impedir.
    expect(codigo, 'a faixa leu uma pessoa').not.toMatch(/\beu\.usuario\b/)
  })

  it('ela tem a saída, e a saída é a do produto', () => {
    expect(semComentarios(FAIXA)).toMatch(/v1\/sair/)
  })
})

describe('a faixa é PERMANENTE — não é um aviso que rola para fora', () => {
  it('ela veste a classe da faixa do painel, que é `position: sticky; top: 0`', () => {
    expect(semComentarios(FAIXA)).toMatch(/className="superadmin-faixa"/)
    const bloco = CSS_PAINEL.replace(/\/\*[\s\S]*?\*\//g, '')
    const inicio = bloco.indexOf('.superadmin-faixa {')
    const corpo = bloco.slice(inicio, bloco.indexOf('}', inicio))
    expect(corpo).toMatch(/position: sticky/)
    expect(corpo).toMatch(/top: 0/)
    expect(corpo).toMatch(/background: var\(--gold\)/)
  })

  it('NENHUMA regra de CSS foi copiada: a faixa reusa a folha do painel', () => {
    // Se alguém duplicar as regras num arquivo novo, as duas divergem no
    // primeiro ajuste e o sinal enfraquece num dos dois lugares.
    const classes = [...semComentarios(FAIXA).matchAll(/className="([^"{}]+)"/g)]
      .flatMap((m) => m[1]!.split(/\s+/))
      .filter(Boolean)
    expect(classes.length).toBeGreaterThan(3)
    for (const c of classes) {
      expect(
        new RegExp(`\\.${c}(?![\\w-])`).test(CSS_PAINEL),
        `a classe \`${c}\` não existe em superadmin.css — a faixa nasce sem estilo`,
      ).toBe(true)
    }
  })

  it('a barra de topo do produto CEDE o lugar, por uma altura declarada uma vez', () => {
    // As duas são `sticky; top: 0`: sem o deslocamento, "Menu" fica escondido
    // atrás do dourado ao rolar, em 390 px.
    expect(CSS_SHELL).toMatch(/\.shell\[data-suporte='sim'\] \.topbar/)
    expect(CSS_SHELL).toMatch(/--h-faixa-de-suporte/)
    // O número mora SÓ em `tokens.css` — token compartilhado por duas folhas
    // mora no arquivo de tokens, e uma `:root` em `superadmin.css` alcançaria
    // o documento inteiro (`colisoes.test.ts` a reprova, com razão).
    expect(CSS_TOKENS).toMatch(/--h-faixa-de-suporte:\s*\d+px/)
    expect(CSS_SHELL).not.toMatch(/--h-faixa-de-suporte:\s*\d/)
    expect(CSS_PAINEL).not.toMatch(/--h-faixa-de-suporte:\s*\d/)
    expect(semComentarios(SHELL)).toMatch(/data-suporte=/)
  })

  it('ela está no casco do produto, e FORA dele — a lateral não a corta', () => {
    const codigo = semComentarios(LAYOUT)
    expect(codigo).toMatch(/<FaixaDeSuporte operador=/)
    // Antes do `<Shell>`, não dentro: no computador a lateral tem 240 px, e
    // uma faixa que começasse depois dela pararia no meio da tela.
    expect(codigo.indexOf('<FaixaDeSuporte')).toBeLessThan(codigo.indexOf('<Shell'))
    expect(codigo).toMatch(/suporte={suporte !== null}/)
  })
})

describe('a tela NÃO finge que o operador é alguém', () => {
  it('`eu.usuario` é anulável, e a sessão derrama `minhaPessoaId` vazio', () => {
    expect(SESSAO).toMatch(/minhaPessoaId: eu\.usuario\?\.id \?\? ''/)
    expect(SESSAO).toMatch(/suporte: eu\.operador === null \? null/)
  })

  it('`quem` dá ACESSO TOTAL ao operador, pela mesma `temPerm`', () => {
    expect(SESSAO).toMatch(/admin: true, perfilId: ''/)
    // E o menu continua sendo filtrado no SERVIDOR, por `itensDoMenu`.
    expect(semComentarios(LAYOUT)).toMatch(/itensDoMenu\(quem, perfis\)/)
  })

  it('a lateral mostra o nome do OPERADOR, rotulado como tal', () => {
    const codigo = semComentarios(LAYOUT)
    expect(codigo).toMatch(/suporte\?\.operador\.nome/)
    expect(codigo).toMatch(/Operador do painel/)
  })

  it('nenhuma das cinco telas de "quem sou eu" lê `eu.usuario.id`', () => {
    // Era o caminho que, com operador, estouraria em `null` — ou pior,
    // receberia um id emprestado.
    for (const tela of ['contas', 'estoque', 'hoje', 'nova', 'tarefas']) {
      const fonte = ler('..', 'app', '(app)', tela, 'page.tsx')
      expect(fonte, `${tela} ainda lê eu.usuario.id`).not.toMatch(/eu\.usuario\.id/)
      expect(fonte).toMatch(/minhaPessoaId/)
    }
  })
})
