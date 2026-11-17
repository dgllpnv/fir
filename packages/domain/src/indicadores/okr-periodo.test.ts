import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { diasEntre, somarDias } from '../relogio'
import {
  alvoDaCampanha,
  avisoDeKrs,
  periodoDoOkr,
  proximoPeriodoDoOkr,
  tipoDaMetaDoKr,
  trimestreDe,
  validarKrsDoOkr,
} from './okr'

/** OKR (spec E.1, E.2; CONTEXT.md `OKR`): período, KRs e o alvo de campanha. Puros. */
describe('período do OKR (E.2): trimestre por padrão, datas livres', () => {
  it('trimestreDe: o trimestre civil do dia', () => {
    expect(trimestreDe('2026-10-24')).toEqual({ tipo: 'trimestre', inicio: '2026-10-01', fim: '2026-12-31' })
    expect(trimestreDe('2028-02-29')).toEqual({ tipo: 'trimestre', inicio: '2028-01-01', fim: '2028-03-31' })
    expect(trimestreDe('2026-06-30')).toEqual({ tipo: 'trimestre', inicio: '2026-04-01', fim: '2026-06-30' })
  })

  it('sem período: o trimestre de HOJE (o dia vem do servidor)', () => {
    expect(periodoDoOkr(undefined, '2026-11-17')).toEqual({ tipo: 'ok', valor: trimestreDe('2026-11-17') })
  })

  it('trimestre com início: só no 1º dia de um trimestre', () => {
    expect(periodoDoOkr({ tipo: 'trimestre', inicio: '2027-01-01' }, '2026-11-17')).toEqual({
      tipo: 'ok',
      valor: { tipo: 'trimestre', inicio: '2027-01-01', fim: '2027-03-31' },
    })
    expect(periodoDoOkr({ tipo: 'trimestre', inicio: '2027-02-01' }, '2026-11-17').tipo).toBe('erro')
  })

  it('datas livres: qualquer par válido, fim no mesmo dia ou depois', () => {
    expect(periodoDoOkr({ tipo: 'datas', inicio: '2026-11-10', fim: '2027-02-15' }, '2026-11-17')).toEqual({
      tipo: 'ok',
      valor: { tipo: 'datas', inicio: '2026-11-10', fim: '2027-02-15' },
    })
    expect(periodoDoOkr({ tipo: 'datas', inicio: '2026-11-10', fim: '2026-11-09' }, '2026-11-17').tipo).toBe('erro')
    expect(periodoDoOkr({ tipo: 'datas', inicio: '2026-02-30', fim: '2026-03-09' }, '2026-11-17').tipo).toBe('erro')
  })

  it('duplicar: o trimestre seguinte; datas livres andam a mesma duração', () => {
    expect(proximoPeriodoDoOkr(trimestreDe('2026-11-17'))).toEqual(trimestreDe('2027-01-01'))
    expect(proximoPeriodoDoOkr({ tipo: 'datas', inicio: '2026-11-10', fim: '2026-11-30' })).toEqual({
      tipo: 'datas',
      inicio: '2026-12-01',
      fim: '2026-12-21',
    })
  })

  it('property: o próximo período começa no dia seguinte ao fim e tem a mesma duração (datas)', () => {
    const dia = fc.date({ min: new Date('2020-01-01T00:00:00Z'), max: new Date('2035-12-31T00:00:00Z'), noInvalidDate: true })
      .map((d) => d.toISOString().slice(0, 10))
    fc.assert(
      fc.property(dia, fc.integer({ min: 0, max: 400 }), (inicio, n) => {
        const p = { tipo: 'datas' as const, inicio, fim: somarDias(inicio, n) }
        const q = proximoPeriodoDoOkr(p)
        expect(q.inicio).toBe(somarDias(p.fim, 1))
        expect(diasEntre(q.inicio, q.fim)).toBe(n)
      }),
    )
  })

  it('a meta do KR: "do mês" quando o período é um mês civil inteiro, senão "até a data"', () => {
    expect(tipoDaMetaDoKr({ inicio: '2026-11-01', fim: '2026-11-30' })).toBe('mes')
    expect(tipoDaMetaDoKr(trimestreDe('2026-11-17'))).toBe('ate_data')
  })
})

describe('resultados-chave (E.2): de 1 a 5, aviso acima de 4', () => {
  it('de 1 a 5, sem o mesmo KPI duas vezes no mesmo OKR', () => {
    expect(validarKrsDoOkr([]).tipo).toBe('erro')
    expect(validarKrsDoOkr(['a']).tipo).toBe('ok')
    expect(validarKrsDoOkr(['a', 'b', 'c', 'd', 'e']).tipo).toBe('ok')
    expect(validarKrsDoOkr(['a', 'b', 'c', 'd', 'e', 'f']).tipo).toBe('erro')
    expect(validarKrsDoOkr(['a', 'b', 'a']).tipo).toBe('erro')
  })

  it('aviso só acima de 4', () => {
    expect(avisoDeKrs(4)).toBe(false)
    expect(avisoDeKrs(5)).toBe(true)
  })
})

describe('KR de campanha: o alvo é a meta da campanha, travado (I-27)', () => {
  it('receita em centavos; as contagens na escala da quantidade (centésimos)', () => {
    const r = alvoDaCampanha('receita', 1_250_050n)
    expect([r.unidade, r.emMenorUnidade]).toEqual(['reais', 1_250_050n])
    const q = alvoDaCampanha('convertidos', 12n)
    expect(q.unidade).toBe('quantidade')
    expect(q.emMenorUnidade).toBe(1200n)
  })
})
