import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { Dinheiro } from '../dinheiro'
import { atingimentoDaMetaDoMes, MEDIDAS_DA_META, medidoParaAMeta } from './meta-medida'

const reais = fc.bigInt({ min: 0n, max: 10_000_000_00n }).map(Dinheiro.deCentavos)

describe('medidoParaAMeta — a régua da meta (parecer de números N-B6)', () => {
  it('13. a meta nunca soma: devolve a FIR, o MedX ou nada', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...MEDIDAS_DA_META),
        reais,
        fc.option(reais, { nil: null }),
        fc.boolean(),
        (medidaPor, recebidoFir, faturamentoMedx, coberturaMedxCompleta) => {
          const m = medidoParaAMeta({ medidaPor, recebidoFir, faturamentoMedx, coberturaMedxCompleta })
          if (medidaPor === 'fir') expect(m).toBe(recebidoFir)
          else expect(m).toBe(coberturaMedxCompleta ? faturamentoMedx : null)
        },
      ),
    )
  })

  it('o caso que separa "escolhe" de "soma": FIR R$ 100, MedX R$ 50', () => {
    const e = { recebidoFir: Dinheiro.deCentavos(10000n), faturamentoMedx: Dinheiro.deCentavos(5000n), coberturaMedxCompleta: true }
    expect(medidoParaAMeta({ ...e, medidaPor: 'fir' })?.centavos).toBe(10000n)
    expect(medidoParaAMeta({ ...e, medidaPor: 'medx' })?.centavos).toBe(5000n)
  })

  it('MedX com leitura incompleta não é zero: é nada', () => {
    const m = medidoParaAMeta({
      medidaPor: 'medx',
      recebidoFir: Dinheiro.deCentavos(10000n),
      faturamentoMedx: Dinheiro.deCentavos(5000n),
      coberturaMedxCompleta: false,
    })
    expect(m).toBe(null)
    expect(atingimentoDaMetaDoMes(Dinheiro.deCentavos(20000n), m)).toEqual({ metaRestante: null, percentual: null })
  })
})

describe('atingimentoDaMetaDoMes', () => {
  it('percentual e restante do mesmo medido', () => {
    expect(atingimentoDaMetaDoMes(Dinheiro.deCentavos(20000n), Dinheiro.deCentavos(5000n))).toEqual({
      metaRestante: Dinheiro.deCentavos(15000n),
      percentual: 25,
    })
  })

  it('acima da meta: restante zero, percentual acima de 100', () => {
    expect(atingimentoDaMetaDoMes(Dinheiro.deCentavos(100n), Dinheiro.deCentavos(150n))).toEqual({
      metaRestante: Dinheiro.zero(),
      percentual: 150,
    })
  })

  it('sem meta: nada', () => {
    expect(atingimentoDaMetaDoMes(null, Dinheiro.deCentavos(1n))).toEqual({ metaRestante: null, percentual: null })
  })

  it('restante + medido = meta enquanto a meta não foi batida', () => {
    fc.assert(
      fc.property(reais, reais, (meta, medido) => {
        const a = atingimentoDaMetaDoMes(meta, medido)
        if (medido.centavos <= meta.centavos) expect(a.metaRestante!.mais(medido).centavos).toBe(meta.centavos)
        else expect(a.metaRestante!.ehZero()).toBe(true)
      }),
    )
  })
})
