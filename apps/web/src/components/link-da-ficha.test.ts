import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * **O NOME DA PACIENTE ABRE A FICHA** (correções da PO, A1 e A2).
 *
 * Varredura sobre a FONTE, como `excluir-pessoa.test.ts`: não há Testing
 * Library nesta árvore (dívida registrada). A prova de comportamento — clicar
 * e chegar na ficha, na tarefa destacada — é do Playwright; o que se segura
 * aqui é o que uma refatoração esqueceria sem ninguém notar.
 */
const AQUI = dirname(fileURLToPath(import.meta.url))
const semComentarios = (texto: string): string =>
  texto.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\/.*$/gm, '')
const ler = (arquivo: string) => semComentarios(readFileSync(join(AQUI, arquivo), 'utf8'))

const fontes = (dir: string): string[] =>
  readdirSync(dir).flatMap((nome) => {
    const caminho = join(dir, nome)
    if (statSync(caminho).isDirectory()) return fontes(caminho)
    return /\.tsx?$/.test(nome) && !nome.endsWith('.test.ts') ? [caminho] : []
  })

describe('o link para a ficha', () => {
  it('nunca é montado com id vazio — `/pacientes/${x ?? ""}` vira a lista, e o toque parece não funcionar', () => {
    const achados = fontes(join(AQUI, '..'))
      .filter((f) => /\/pacientes\/\$\{[^}]*\?\?\s*(''|"")\s*\}/.test(readFileSync(f, 'utf8')))
      .map((f) => relative(join(AQUI, '..'), f))
    expect(achados).toEqual([])
  })

  it('o cartão de tarefa leva o nome à ficha, e `semPaciente` o tira dentro da própria ficha', () => {
    const cartao = ler('cartao-de-tarefa.tsx')
    // E só com `pacientes` (S-1): sem ela, o nome é texto — ver
    // `link-do-nome-pela-permissao.test.ts`, que renderiza os dois casos.
    expect(cartao).toMatch(/semPaciente \? null : podePacientes \? \(\s*<Link className="pill paciente" href=\{`\/pacientes\/\$\{t\.pacienteId\}`\}/)
    // O ramo só existe com paciente: é ele que garante o id não nulo.
    expect(cartao).toMatch(/t\.pacienteId !== null \? \(\s*<div className="pmeta">/)
  })

  it('a ficha desenha o MESMO cartão, sem repetir o link para si mesma', () => {
    const ficha = ler('ficha-do-paciente.tsx')
    expect(ficha).toMatch(/<CartaoDeTarefa[\s\S]*?semPaciente[\s\S]*?\/>/)
    // A faixa da jornada (`mover`) só para quem tem `jornada` (S-5).
    expect(ficha).toMatch(/acoes=\{podeJornada \? \{ \.\.\.acoes, mover \} : acoes\}/)
    expect(ficha).not.toMatch(/<table/)
  })

  it('o mini-cartão da Jornada leva à TAREFA na ficha, e sem paciente não é link', () => {
    const jornada = ler('tela-jornada.tsx')
    expect(jornada).toMatch(/href=\{`\/pacientes\/\$\{x\.pacienteId\}\?tarefa=\$\{x\.id\}`\}/)
    expect(jornada).toMatch(/x\.pacienteId === null \|\| !podePacientes\) return <div className="kmini">/)
  })
})
