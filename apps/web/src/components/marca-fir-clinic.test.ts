import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * A ferramenta das clínicas se chama FIR Clinic; Firmare é a consultoria.
 * Varredura de fonte (não há Testing Library nesta árvore), como
 * `faixa-de-suporte.test.ts`.
 */
const AQUI = dirname(fileURLToPath(import.meta.url))
const ler = (...p: string[]) => readFileSync(join(AQUI, ...p), 'utf8')
const semComentarios = (t: string): string =>
  t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')

const SHELL = semComentarios(ler('shell.tsx'))

describe('a marca da ferramenta das clínicas é FIR Clinic', () => {
  it.each([
    ['shell', SHELL],
    ['entrar', semComentarios(ler('..', 'app', 'entrar', 'page.tsx'))],
    ['trocar-senha', semComentarios(ler('..', 'app', 'trocar-senha', 'page.tsx'))],
  ])('%s mostra "FIR Clinic" e não "Firmare" como marca', (_n, fonte) => {
    expect(fonte).toMatch(/FIR Clinic<span>\.<\/span>/)
    expect(fonte).not.toMatch(/Firmare<span>/)
    expect(fonte).not.toMatch(/Gestão de Rotina/)
  })

  it('o título das páginas é FIR Clinic', () => {
    expect(ler('..', 'app', 'layout.tsx')).toMatch(/title: 'FIR Clinic'/)
  })
})

describe('o nome antigo da ferramenta não volta a aparecer nas telas da gestão', () => {
  it.each([['campanhas', ['..', 'app', 'carteira', 'campanhas', 'page.tsx']], ['faixa da gestão', ['..', 'app', 'gestao', 'faixa.tsx']], ['faixa do portal', ['..', 'app', 'portal', 'faixa.tsx']], ['campanhas do cliente', ['carteira', 'campanhas-do-cliente.tsx']]] as const)(
    '%s não diz "Gestão de Rotina"',
    (_n, caminho) => {
      expect(semComentarios(ler(...caminho))).not.toMatch(/Gestão de Rotina/)
    },
  )
})

describe('o atalho para o painel de gestão', () => {
  it('só renderiza quando a sessão é de suporte, e leva a /gestao', () => {
    expect(SHELL).toMatch(/\{suporte \? \(\s*<div className="navgrupo">[\s\S]*?href="\/gestao"/)
    expect(SHELL.match(/href="\/gestao"/g)).toHaveLength(1)
  })

  it('o item tem rótulo em texto e ícone escondido do leitor de tela', () => {
    expect(SHELL).toMatch(/<span>Painel de gestão<\/span>/)
    expect(SHELL).toMatch(/ICONE_PAINEL_DE_GESTAO/)
  })

  it('`suporte` vem da sessão resolvida no servidor, não de estado do cliente', () => {
    expect(ler('..', 'app', '(app)', 'layout.tsx')).toMatch(/suporte=\{suporte !== null\}/)
  })
})
