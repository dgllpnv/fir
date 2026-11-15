import type { EventoDeFluxo } from '@fir/contracts'
import { describe, expect, it } from 'vitest'
import { ErroDaApi } from './api'
import { eventoEmFrase, mensagemDoFluxo, quemConcluiu, type Nomes } from './fluxo-da-tarefa'

const NOMES: Nomes = {
  pessoa: (id) => ({ p1: 'Beatriz', p2: 'Carla' })[id] ?? null,
  grupo: (id) => ({ g1: 'Recepção' })[id] ?? null,
}

const ev = (parcial: Partial<EventoDeFluxo> & Pick<EventoDeFluxo, 'acao'>): EventoDeFluxo => ({
  em: '2026-11-14T15:00:00.000Z',
  porId: 'p1',
  de: null,
  para: null,
  ...parcial,
})

describe('eventoEmFrase', () => {
  it('atribuir ao grupo', () => {
    expect(
      eventoEmFrase(ev({ acao: 'atribuir', para: { tipo: 'grupo', id: 'g1' } }), NOMES).texto,
    ).toBe('Beatriz enviou a tarefa para o grupo Recepção')
  })

  it('transferir de grupo para pessoa, com a nota', () => {
    const f = eventoEmFrase(
      ev({
        acao: 'transferir',
        de: { tipo: 'grupo', id: 'g1' },
        para: { tipo: 'pessoa', id: 'p2' },
        nota: 'Ela conhece o caso',
      }),
      NOMES,
    )
    expect(f.texto).toBe('Beatriz transferiu do grupo Recepção para Carla')
    expect(f.nota).toBe('Ela conhece o caso')
  })

  it('assumir', () => {
    expect(
      eventoEmFrase(ev({ acao: 'assumir', de: { tipo: 'grupo', id: 'g1' } }), NOMES).texto,
    ).toBe('Beatriz assumiu a tarefa do grupo Recepção')
  })

  it('id que não resolve nunca vira uuid na tela', () => {
    const f = eventoEmFrase(
      ev({ acao: 'transferir', porId: 'zzz', de: { tipo: 'pessoa', id: 'x' }, para: { tipo: 'grupo', id: 'y' } }),
      NOMES,
    )
    expect(f.texto).toBe('Alguém transferiu de uma pessoa para um grupo desativado')
    expect(f.texto).not.toMatch(/zzz|\bx\b|\by\b/)
  })

  it('nota vazia não vira nota', () => {
    expect(eventoEmFrase(ev({ acao: 'assumir', nota: '' }), NOMES).nota).toBeNull()
  })
})

describe('quemConcluiu', () => {
  it('tarefa de grupo concluída: a pessoa que agiu', () => {
    expect(
      quemConcluiu(
        {
          status: 'concluida',
          fluxo: [ev({ acao: 'concluirPeloGrupo', porId: 'p2', de: { tipo: 'grupo', id: 'g1' } })],
        },
        NOMES,
      ),
    ).toBe('Carla')
  })

  it('tarefa de pessoa concluída: quem executou (`executar`), não o responsável', () => {
    expect(
      quemConcluiu(
        {
          status: 'concluida',
          fluxo: [ev({ acao: 'executar', porId: 'p2', de: { tipo: 'pessoa', id: 'p1' } })],
        },
        NOMES,
      ),
    ).toBe('Carla')
  })

  it('aberta, ou sem evento de conclusão: ninguém inventado', () => {
    expect(quemConcluiu({ status: 'aberta', fluxo: [] }, NOMES)).toBeNull()
    expect(quemConcluiu({ status: 'concluida', fluxo: [ev({ acao: 'assumir' })] }, NOMES)).toBeNull()
  })
})

describe('mensagemDoFluxo', () => {
  it('usa a frase do servidor quando ela existe', () => {
    expect(mensagemDoFluxo(new ErroDaApi(409, 'Esta tarefa acabou de mudar.'), 'assumir')).toBe(
      'Esta tarefa acabou de mudar.',
    )
  })
  it('sem texto, 403 e 409 têm frase própria', () => {
    expect(mensagemDoFluxo(new ErroDaApi(403, ''), 'assumir')).toMatch(/do grupo/)
    expect(mensagemDoFluxo(new ErroDaApi(409, ''), 'transferir')).toMatch(/Outra pessoa/)
  })
  it('erro desconhecido', () => {
    expect(mensagemDoFluxo(new Error('x'), 'transferir')).toBe('Não consegui transferir a tarefa.')
  })
})
