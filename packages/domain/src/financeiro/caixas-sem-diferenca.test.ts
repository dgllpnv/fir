import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { Dinheiro } from '../dinheiro'
import { somarDias } from '../relogio'
import { caixasSemDiferenca } from './caixas-sem-diferenca'

const d = (c: number) => Dinheiro.deCentavos(BigInt(c))
const certo = (dia: string) => ({ dia, linhas: [{ contado: d(100), esperado: d(100) }] })

describe('caixas sem diferença (I-15; números B3)', () => {
  it('caixa-sabado-nao-passa-de-100: seg a sáb fechados e certos dão 100%, não 120%', () => {
    // 02/11/2026 é segunda; 07/11 é sábado. Hoje = domingo 08/11.
    const caixas = ['02', '03', '04', '05', '06', '07'].map((x) => certo(`2026-11-${x}`))
    const r = caixasSemDiferenca('2026-11-02', '2026-11-08', '2026-11-08', caixas)
    expect(r).toEqual({ dias: 6, semDiferenca: 6, comDiferenca: 0, percentual: 100 })
  })

  it('caixa-sobra-e-falta-iguais-tem-diferenca: Pix +50 e Dinheiro −50 é caixa COM diferença', () => {
    const r = caixasSemDiferenca('2026-11-02', '2026-11-02', '2026-11-03', [
      { dia: '2026-11-02', linhas: [{ contado: d(15000), esperado: d(10000) }, { contado: d(5000), esperado: d(10000) }] },
    ])
    expect(r).toMatchObject({ dias: 1, semDiferenca: 0, comDiferenca: 1, percentual: 0 })
  })

  it('hoje entra só se fechado; dia útil passado sem caixa entra no denominador', () => {
    const aberto = caixasSemDiferenca('2026-11-02', '2026-11-30', '2026-11-04', [certo('2026-11-02')])
    expect(aberto).toMatchObject({ dias: 2, semDiferenca: 1, percentual: 50 })
    const fechado = caixasSemDiferenca('2026-11-02', '2026-11-30', '2026-11-04', [certo('2026-11-02'), certo('2026-11-04')])
    expect(fechado).toMatchObject({ dias: 3, semDiferenca: 2 })
  })

  it('property: nunca passa de 100, e semDiferenca + comDiferenca ≤ dias', () => {
    fc.assert(
      fc.property(fc.array(fc.boolean(), { minLength: 31, maxLength: 31 }), fc.integer({ min: 0, max: 30 }), (mask, h) => {
        const dias = Array.from({ length: 31 }, (_, i) => somarDias('2026-12-01', i))
        const hoje = dias[h]!
        const caixas = dias.filter((x, i) => mask[i] && x <= hoje).map(certo)
        const r = caixasSemDiferenca('2026-12-01', '2026-12-31', hoje, caixas)
        expect(r.semDiferenca + r.comDiferenca).toBeLessThanOrEqual(r.dias)
        if (r.percentual !== null) expect(r.percentual).toBeLessThanOrEqual(100)
      }),
    )
  })
})
