import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { prioridadesDoTrimestre, progressoDoOkr, trimestreDe } from './okr'

/** A faixa "Prioridades do trimestre" e a capa da reunião (revisão P1): uma conta só. */
const okr = (
  estado: 'ativo' | 'encerrado',
  progresso: number | null,
  inicio = '2026-10-01',
  fim = '2026-12-31',
  responsavelId: string | null = null,
) => ({ estado, progresso, periodo: { inicio, fim }, responsavelId })

const T4 = trimestreDe('2026-10-24')

describe('prioridadesDoTrimestre', () => {
  it('só os ATIVOS que tocam o trimestre: o encerrado e o do trimestre seguinte ficam fora', () => {
    const r = prioridadesDoTrimestre(
      [
        okr('ativo', 50),
        okr('ativo', 90, '2026-09-15', '2026-10-15'), // toca o trimestre pela borda
        okr('encerrado', 10),
        okr('ativo', 0, '2027-01-01', '2027-03-31'),
        okr('ativo', 0, '2026-07-01', '2026-09-30'),
      ],
      T4,
    )
    expect(r).toEqual({ quantos: 2, media: 70 })
  })

  it('OKR sem progresso conta em quantos, e não na média; nenhum dá média nula', () => {
    expect(prioridadesDoTrimestre([okr('ativo', null), okr('ativo', 40)], T4)).toEqual({ quantos: 2, media: 40 })
    expect(prioridadesDoTrimestre([], T4)).toEqual({ quantos: 0, media: null })
  })

  it('o filtro de responsável da tela', () => {
    const lista = [okr('ativo', 20, undefined, undefined, 'a'), okr('ativo', 80, undefined, undefined, 'b')]
    expect(prioridadesDoTrimestre(lista, T4, 'b')).toEqual({ quantos: 1, media: 80 })
  })

  it('property: é a média de progressoDoOkr sobre exatamente os ativos do trimestre', () => {
    const arb = fc.record({
      estado: fc.constantFrom<'ativo' | 'encerrado'>('ativo', 'encerrado'),
      progresso: fc.option(fc.integer({ min: 0, max: 100 }), { nil: null }),
      noTrimestre: fc.boolean(),
    })
    fc.assert(
      fc.property(fc.array(arb, { maxLength: 12 }), (xs) => {
        const lista = xs.map((x) => okr(x.estado, x.progresso, x.noTrimestre ? '2026-11-01' : '2027-01-01', x.noTrimestre ? '2026-11-30' : '2027-01-31'))
        const esperados = xs.filter((x) => x.estado === 'ativo' && x.noTrimestre)
        expect(prioridadesDoTrimestre(lista, T4)).toEqual({
          quantos: esperados.length,
          media: progressoDoOkr(esperados.map((x) => x.progresso)),
        })
      }),
    )
  })
})
