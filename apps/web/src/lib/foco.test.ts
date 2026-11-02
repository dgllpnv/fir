import { describe, expect, it } from 'vitest'
import { precisaPrender, proximoFoco, SELETOR_FOCAVEL } from './foco'

/**
 * O laço de foco do modal, provado sem navegador.
 *
 * `HTMLElement` aqui é um objeto qualquer com identidade — as funções só
 * comparam referências e usam `indexOf`. Fingir um DOM inteiro para provar
 * aritmética de índice seria prova de outra coisa.
 */
const el = (nome: string): HTMLElement => ({ nome }) as unknown as HTMLElement

const a = el('a')
const b = el('b')
const c = el('c')
const fora = el('fora')

describe('proximoFoco', () => {
  it('anda para frente e DÁ A VOLTA no último', () => {
    expect(proximoFoco([a, b, c], a, false)).toBe(b)
    expect(proximoFoco([a, b, c], b, false)).toBe(c)
    expect(proximoFoco([a, b, c], c, false)).toBe(a)
  })

  it('anda para trás e dá a volta no PRIMEIRO', () => {
    expect(proximoFoco([a, b, c], c, true)).toBe(b)
    expect(proximoFoco([a, b, c], b, true)).toBe(a)
    expect(proximoFoco([a, b, c], a, true)).toBe(c)
  })

  it('com UM focável, o Tab volta nele mesmo — nos dois sentidos', () => {
    expect(proximoFoco([a], a, false)).toBe(a)
    expect(proximoFoco([a], a, true)).toBe(a)
  })

  it('foco FORA do modal entra pela borda certa', () => {
    // O navegador devolve o foco ao `<body>` quando o elemento focado é
    // removido — um botão que virou "Salvando…" e sumiu. Sem este caso, o
    // Shift+Tab cai em índice negativo e o laço deixa de prender.
    expect(proximoFoco([a, b, c], null, false)).toBe(a)
    expect(proximoFoco([a, b, c], null, true)).toBe(c)
    expect(proximoFoco([a, b, c], fora, false)).toBe(a)
    expect(proximoFoco([a, b, c], fora, true)).toBe(c)
  })

  it('lista VAZIA não prende nada — `null` é "deixe o navegador seguir"', () => {
    expect(proximoFoco([], a, false)).toBeNull()
    expect(proximoFoco([], null, true)).toBeNull()
  })
})

describe('precisaPrender', () => {
  it('só nas BORDAS: no meio da lista o navegador faz o trabalho', () => {
    expect(precisaPrender([a, b, c], b, false)).toBe(false)
    expect(precisaPrender([a, b, c], b, true)).toBe(false)
  })

  it('no último, indo para frente', () => {
    expect(precisaPrender([a, b, c], c, false)).toBe(true)
    expect(precisaPrender([a, b, c], c, true)).toBe(false)
  })

  it('no primeiro, indo para trás', () => {
    expect(precisaPrender([a, b, c], a, true)).toBe(true)
    expect(precisaPrender([a, b, c], a, false)).toBe(false)
  })

  it('foco fora do modal SEMPRE prende — senão o Tab vaza para o conteúdo de trás', () => {
    expect(precisaPrender([a, b, c], null, false)).toBe(true)
    expect(precisaPrender([a, b, c], fora, true)).toBe(true)
  })

  it('lista vazia não prende', () => {
    expect(precisaPrender([], null, false)).toBe(false)
  })
})

describe('SELETOR_FOCAVEL', () => {
  it('ignora o que está desabilitado — o navegador o pula', () => {
    // Um `:disabled` na lista faria o laço parar num elemento que não aceita
    // foco, e o Tab seguinte pareceria não fazer nada.
    expect(SELETOR_FOCAVEL).toContain('button:not([disabled])')
    expect(SELETOR_FOCAVEL).toContain('input:not([disabled])')
  })

  it('pega quem é focável por `tabindex`, e NÃO quem tem -1', () => {
    expect(SELETOR_FOCAVEL).toContain('[tabindex]:not([tabindex="-1"])')
  })
})
