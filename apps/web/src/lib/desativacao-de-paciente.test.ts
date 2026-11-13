import { describe, expect, it } from 'vitest'
import { corpoDeDesativar, prepararReativacao } from './desativacao-de-paciente'

describe('corpoDeDesativar', () => {
  it('manda a razão e omite o detalhe vazio', () => {
    expect(corpoDeDesativar('duplicado', '  ')).toEqual({ body: '{"razao":"duplicado"}' })
  })
  it('leva detalhe aparado e motivo de suporte', () => {
    expect(JSON.parse(corpoDeDesativar('outro', ' x ', 'Chamado 1234 do suporte').body)).toEqual({
      razao: 'outro',
      detalhe: 'x',
      motivo: 'Chamado 1234 do suporte',
    })
  })
})

describe('prepararReativacao', () => {
  it('razão comum: sem confirmação, corpo vazio', () => {
    expect(prepararReativacao(false, false, '')).toEqual({ ok: true, corpo: {} })
  })
  it('pediu-para-sair exige a confirmação marcada', () => {
    expect(prepararReativacao(true, false, 'Titular pediu para voltar').ok).toBe(false)
  })
  it('pediu-para-sair exige motivo de 10 a 200', () => {
    expect(prepararReativacao(true, true, 'curto').ok).toBe(false)
    expect(prepararReativacao(true, true, 'a'.repeat(201)).ok).toBe(false)
  })
  it('com tudo, manda a confirmação e o motivo', () => {
    const r = prepararReativacao(true, true, '  Titular pediu para voltar ')
    expect(r.ok && JSON.parse((r.corpo as { body: string }).body)).toEqual({
      confirmoQueOTitularPediu: true,
      motivo: 'Titular pediu para voltar',
    })
  })
})
