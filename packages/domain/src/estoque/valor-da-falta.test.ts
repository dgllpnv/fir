import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { Dinheiro } from '../dinheiro'
import { Quantidade } from '../quantidade'
import { valorDaFalta, valorTotalDaFalta } from './valor-da-falta'

const amp = (milesimos: bigint) => Quantidade.deMilesimos(milesimos, 'ampola')
const reais = (centavos: bigint) => Dinheiro.deCentavos(centavos)

/** Diferença NEGATIVA (falta) em milésimos, incluindo as fronteiras de meia unidade. */
const falta = fc.oneof(
  fc.constantFrom(1n, 499n, 500n, 501n, 999n, 1_000n, 1_500n),
  fc.bigInt({ min: 1n, max: 10_000_000n }),
)
const custo = fc.oneof(
  fc.constantFrom(0n, 1n, 3n, 99n, 100n, 152_000n),
  fc.bigInt({ min: 0n, max: 100_000_000n }),
)

describe('valorDaFalta — meio-para-cima por item', () => {
  it('exemplos: unidade inteira é exata; meio centavo sobe; abaixo do meio desce', () => {
    // 3 ampolas de R$ 1.520,00 faltando.
    expect(valorDaFalta(amp(-3_000n), reais(152_000n)).centavos).toBe(456_000n)
    // Meia ampola de R$ 0,01 = 0,5 centavo → 1 (truncar dava 0, e a perda sumia).
    expect(valorDaFalta(amp(-500n), reais(1n)).centavos).toBe(1n)
    // 0,499 ampola de R$ 0,01 = 0,499 centavo → 0.
    expect(valorDaFalta(amp(-499n), reais(1n)).centavos).toBe(0n)
    // 0,25 ampola de R$ 0,03 = 0,75 centavo → 1.
    expect(valorDaFalta(amp(-250n), reais(3n)).centavos).toBe(1n)
  })

  it('sobra e diferença zero valem zero', () => {
    expect(valorDaFalta(amp(0n), reais(152_000n)).centavos).toBe(0n)
    expect(valorDaFalta(amp(2_500n), reais(152_000n)).centavos).toBe(0n)
  })

  it('PROPRIEDADE: erra no máximo MEIO centavo em relação ao valor exato, e o meio sobe', () => {
    fc.assert(
      fc.property(falta, custo, (f, c) => {
        const v = valorDaFalta(amp(-f), reais(c)).centavos
        const exato = f * c // em milésimos de centavo
        const erro = v * 1_000n - exato
        // -500 < erro <= 500: o meio (erro = +500) é para cima; nunca -500.
        expect(erro > -500n && erro <= 500n).toBe(true)
      }),
      { numRuns: 2_000 },
    )
  })

  it('PROPRIEDADE: falta em unidades inteiras é exatamente falta × custo', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 1n, max: 100_000n }), custo, (unidades, c) => {
        expect(valorDaFalta(amp(-unidades * 1_000n), reais(c)).centavos).toBe(unidades * c)
      }),
    )
  })

  it('PROPRIEDADE: mais falta nunca vale menos (monotônica)', () => {
    fc.assert(
      fc.property(falta, falta, custo, (a, b, c) => {
        const [menor, maior] = a <= b ? [a, b] : [b, a]
        expect(
          valorDaFalta(amp(-menor), reais(c)).centavos <= valorDaFalta(amp(-maior), reais(c)).centavos,
        ).toBe(true)
      }),
    )
  })

  it('PROPRIEDADE: sobra nunca vira dinheiro', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: 10_000_000n }), custo, (s, c) => {
        expect(valorDaFalta(amp(s), reais(c)).centavos).toBe(0n)
      }),
    )
  })
})

describe('valorTotalDaFalta — a soma da coluna', () => {
  const linha = fc.record({
    d: fc.bigInt({ min: -10_000_000n, max: 10_000_000n }),
    c: custo,
  })

  it('PROPRIEDADE: o total é EXATAMENTE a soma dos valores por item (a coluna bate)', () => {
    fc.assert(
      fc.property(fc.array(linha, { maxLength: 60 }), (ls) => {
        const linhas = ls.map((l) => ({ diferenca: amp(l.d), custoPorMedida: reais(l.c) }))
        const soma = linhas.reduce(
          (s, l) => s + valorDaFalta(l.diferenca, l.custoPorMedida).centavos,
          0n,
        )
        expect(valorTotalDaFalta(linhas).centavos).toBe(soma)
      }),
    )
  })

  it('PROPRIEDADE: o total fica a no máximo meio centavo POR ITEM COM FALTA do exato', () => {
    fc.assert(
      fc.property(fc.array(linha, { maxLength: 60 }), (ls) => {
        const linhas = ls.map((l) => ({ diferenca: amp(l.d), custoPorMedida: reais(l.c) }))
        const comFalta = ls.filter((l) => l.d < 0n)
        const exato = comFalta.reduce((s, l) => s + -l.d * l.c, 0n)
        const desvio = valorTotalDaFalta(linhas).centavos * 1_000n - exato
        const teto = 500n * BigInt(comFalta.length)
        expect(desvio >= -teto && desvio <= teto).toBe(true)
      }),
    )
  })

  it('lista vazia é zero', () => {
    expect(valorTotalDaFalta([]).centavos).toBe(0n)
  })
})
