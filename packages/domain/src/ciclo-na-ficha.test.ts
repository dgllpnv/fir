import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { cicloNaFicha } from './ciclo-na-ficha'
import { diasEntre } from './relogio'

const umDia = fc
  .date({ min: new Date(Date.UTC(2020, 0, 1)), max: new Date(Date.UTC(2035, 11, 31)) })
  .map((d) => d.toISOString().slice(0, 10))

describe('cicloNaFicha — a barra "Mês N de M" da ficha (protótipo L1411)', () => {
  it('120 dias, 65 decorridos: "Mês 3 de 4", 54%', () => {
    // 2026-01-01 + 120 dias = 2026-05-01; + 65 dias = 2026-03-07
    expect(cicloNaFicha('2026-01-01', '2026-05-01', '2026-03-07')).toEqual({ mes: 3, meses: 4, percentual: 54 })
  })

  it('no próprio dia do início: Mês 1, 0%', () => {
    expect(cicloNaFicha('2026-01-01', '2026-07-01', '2026-01-01')).toEqual({ mes: 1, meses: 7, percentual: 0 })
  })

  it('antes do início não existe "Mês 0" (o protótipo escrevia)', () => {
    expect(cicloNaFicha('2026-03-01', '2026-06-01', '2026-01-15')?.mes).toBe(1)
  })

  it('depois do fim: último mês, 100%', () => {
    expect(cicloNaFicha('2026-01-01', '2026-03-02', '2026-12-31')).toEqual({ mes: 2, meses: 2, percentual: 100 })
  })

  it('fim igual ou antes do início não é ciclo (o protótipo dividia por zero)', () => {
    expect(cicloNaFicha('2026-01-01', '2026-01-01', '2026-01-01')).toBeNull()
    expect(cicloNaFicha('2026-02-01', '2026-01-01', '2026-01-15')).toBeNull()
  })

  it('arredonda meio para cima: 1 de 8 dias = 12,5% → 13%', () => {
    expect(cicloNaFicha('2026-01-01', '2026-01-09', '2026-01-02')?.percentual).toBe(13)
  })

  it('conta dias de calendário: o fevereiro bissexto tem um dia a mais', () => {
    expect(cicloNaFicha('2028-02-01', '2028-03-02', '2028-03-01')).toEqual({ mes: 1, meses: 1, percentual: 97 })
  })

  it('propriedade: 1 ≤ mês ≤ meses e 0 ≤ percentual ≤ 100, sempre inteiros', () => {
    fc.assert(
      fc.property(umDia, umDia, umDia, (inicio, fim, hoje) => {
        const c = cicloNaFicha(inicio, fim, hoje)
        if (diasEntre(inicio, fim) <= 0) return c === null
        if (c === null) return false
        return (
          Number.isInteger(c.mes) &&
          Number.isInteger(c.percentual) &&
          c.mes >= 1 &&
          c.mes <= c.meses &&
          c.percentual >= 0 &&
          c.percentual <= 100
        )
      }),
    )
  })

  it('propriedade: o ciclo nunca anda para trás quando o dia avança', () => {
    fc.assert(
      fc.property(umDia, umDia, umDia, umDia, (inicio, fim, a, b) => {
        fc.pre(diasEntre(inicio, fim) > 0)
        const [antes, depois] = a <= b ? [a, b] : [b, a]
        const x = cicloNaFicha(inicio, fim, antes)!
        const y = cicloNaFicha(inicio, fim, depois)!
        return y.mes >= x.mes && y.percentual >= x.percentual
      }),
    )
  })
})
