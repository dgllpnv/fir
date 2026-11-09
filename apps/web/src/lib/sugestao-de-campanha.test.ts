import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { CampanhaSugerida } from '@fir/contracts'
import { describe, expect, it } from 'vitest'
import { criarSugestaoDeCampanha } from './sugestao-de-campanha'

/**
 * **L-A3-11 · Uma leitura por escolha.** `GET /v1/pacientes/:id/campanha-sugerida`
 * grava acesso com o id da paciente; a tela a chama UMA vez por escolha.
 *
 * Duas camadas, porque não há Testing Library nesta árvore: o controle puro,
 * com as chamadas contadas; e a varredura da fonte, que prova que a rota só é
 * chamada pelo controle e o controle só lê no `aoEscolher` do seletor — nunca
 * num efeito, nunca na busca do autocomplete.
 */

const P1 = '11111111-1111-4111-8111-111111111111'
const P2 = '22222222-2222-4222-8222-222222222222'
const C1 = '33333333-3333-4333-8333-333333333333'
const C2 = '44444444-4444-4444-8444-444444444444'

function montar(podePacientes = true, respostas: Record<string, CampanhaSugerida> = {}) {
  const chamadas: string[] = []
  const campo: string[] = []
  const frases: (CampanhaSugerida | null)[] = []
  const pendentes: (() => void)[] = []
  const s = criarSugestaoDeCampanha({
    podePacientes,
    buscar: (id) => {
      chamadas.push(id)
      return new Promise((ok) =>
        pendentes.push(() => ok(respostas[id] ?? { sugerida: null, motivo: null })),
      )
    },
    aoSugerir: (id) => campo.push(id),
    aoMudarSugestao: (x) => frases.push(x),
  })
  const responder = async () => {
    for (const p of pendentes.splice(0)) p()
    await new Promise((r) => setTimeout(r, 0))
  }
  return { s, chamadas, campo, frases, responder }
}

describe('sugestão de campanha — uma leitura por escolha (L-A3-11)', () => {
  it('escolher a paciente uma vez faz UMA chamada, e aplica a sugestão', async () => {
    const m = montar(true, { [P1]: { sugerida: C1, motivo: 'origem' } })
    m.s.escolherPaciente(P1)
    await m.responder()
    expect(m.chamadas).toEqual([P1])
    expect(m.campo.at(-1)).toBe(C1)
    expect(m.frases.at(-1)).toEqual({ sugerida: C1, motivo: 'origem' })
  })

  it('reaplicar, suspender e recomeçar NÃO leem de novo', async () => {
    const m = montar(true, { [P1]: { sugerida: C1, motivo: 'tarefa' } })
    m.s.escolherPaciente(P1)
    await m.responder()
    m.s.suspender()
    expect(m.campo.at(-1)).toBe('')
    m.s.reaplicar()
    expect(m.campo.at(-1)).toBe(C1)
    m.s.mexer()
    m.s.recomecar()
    expect(m.campo.at(-1)).toBe(C1)
    await m.responder()
    expect(m.chamadas).toEqual([P1])
  })

  it('sem a permissão `pacientes`, nenhuma chamada', async () => {
    const m = montar(false)
    m.s.escolherPaciente(P1)
    await m.responder()
    expect(m.chamadas).toEqual([])
    expect(m.campo).toEqual([''])
  })

  it('tirar a paciente não lê; quem já mexeu no campo também não', async () => {
    const m = montar(true)
    m.s.escolherPaciente(null)
    m.s.mexer()
    m.s.escolherPaciente(P1)
    await m.responder()
    expect(m.chamadas).toEqual([])
  })

  it('a resposta da paciente anterior é descartada ao trocar', async () => {
    const m = montar(true, {
      [P1]: { sugerida: C1, motivo: 'origem' },
      [P2]: { sugerida: C2, motivo: 'origem' },
    })
    m.s.escolherPaciente(P1)
    m.s.escolherPaciente(P2)
    await m.responder()
    expect(m.chamadas).toEqual([P1, P2])
    expect(m.campo).not.toContain(C1)
    expect(m.campo.at(-1)).toBe(C2)
  })

  it('mexer no campo antes da resposta: a resposta não sobrescreve', async () => {
    const m = montar(true, { [P1]: { sugerida: C1, motivo: 'origem' } })
    m.s.escolherPaciente(P1)
    m.s.mexer()
    await m.responder()
    expect(m.campo).not.toContain(C1)
  })
})

describe('a rota só é chamada no evento de escolha (varredura da fonte)', () => {
  const AQUI = dirname(fileURLToPath(import.meta.url))
  const ler = (rel: string): string =>
    readFileSync(join(AQUI, rel), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '')
  const campo = ler('../components/campo-de-campanha.tsx')
  const novaTarefa = ler('../components/tela-nova-tarefa.tsx')
  const recebimentos = ler('../components/tela-recebimentos.tsx')
  const seletor = ler('../components/seletor-de-paciente.tsx')

  it('a rota antiga não recebe mais `paciente`', () => {
    for (const f of [campo, novaTarefa, recebimentos]) {
      expect(f).not.toMatch(/vinculaveis[^`]*paciente/)
      expect(f).not.toMatch(/paciente:\s*pacienteId/)
    }
  })

  it('`campanha-sugerida` aparece num lugar só: o `buscar` do controle', () => {
    expect(campo.match(/campanha-sugerida/g)).toHaveLength(1)
    for (const f of [novaTarefa, recebimentos, seletor]) expect(f).not.toContain('campanha-sugerida')
  })

  it('o campo não lê a sugestão num efeito (nada de `escolherPaciente` em `useEffect`)', () => {
    expect(campo).not.toContain('escolherPaciente(')
    expect(campo).not.toMatch(/useDados<CampanhaSugerida>/)
  })

  it('as telas leem dentro do `aoEscolher` do seletor', () => {
    for (const f of [novaTarefa, recebimentos]) {
      expect(f).toMatch(/aoEscolher=\{\(p\) => \{\s*setPaciente\(p\)\s*sugestao\.controle\.escolherPaciente\(p\?\.id \?\? null\)/)
    }
  })

  it('o seletor só chama `aoEscolher` em clique ou cadastro, nunca no `onChange` da busca', () => {
    const onChange = seletor.match(/onChange=\{[^}]*\}/g) ?? []
    for (const h of onChange) expect(h).not.toContain('aoEscolher')
  })

  it('a única leitura fora do seletor é a paciente pré-escolhida, guardada por ref', () => {
    expect(novaTarefa.match(/escolherPaciente\(/g)).toHaveLength(2)
    expect(novaTarefa).toMatch(/if \(sugeriuAInicial\.current \|\| pacienteInicial === null\) return\s*sugeriuAInicial\.current = true/)
  })
})
