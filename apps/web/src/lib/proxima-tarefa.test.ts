import { describe, expect, it } from 'vitest'
import { urlDaProximaTarefa } from './proxima-tarefa'

describe('urlDaProximaTarefa', () => {
  it('leva paciente e campanha', () => {
    expect(urlDaProximaTarefa({ pacienteId: 'p1', campanhaId: 'c1' })).toBe(
      '/nova?pacienteId=p1&campanhaId=c1',
    )
  })
  it('só paciente', () => {
    expect(urlDaProximaTarefa({ pacienteId: 'p1', campanhaId: null })).toBe('/nova?pacienteId=p1')
  })
  it('tarefa interna sem campanha abre /nova limpo', () => {
    expect(urlDaProximaTarefa({ pacienteId: null })).toBe('/nova')
  })
})
