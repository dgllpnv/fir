import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { aplicarDesconto, criarPercentualCentesimos } from './cobranca-carteira'
import { Dinheiro } from './dinheiro'

const mensalidade = (centavos: bigint) => Dinheiro.deCentavos(centavos)

describe('criarPercentualCentesimos', () => {
  it('aceita os extremos 0 e 10000', () => {
    expect(criarPercentualCentesimos(0n)).toBe(0n)
    expect(criarPercentualCentesimos(10000n)).toBe(10000n)
  })

  it('recusa fora de [0, 10000]', () => {
    expect(() => criarPercentualCentesimos(-1n)).toThrow()
    expect(() => criarPercentualCentesimos(10001n)).toThrow()
  })
})

describe('aplicarDesconto — o exemplo conferido à mão no ADR 0015', () => {
  it('R$ 1.850,33 com 10% de desconto: desconto 18.504, cobrança 166.529', () => {
    const r = aplicarDesconto(mensalidade(185033n), criarPercentualCentesimos(1000n))
    expect(r.desconto.centavos).toBe(18504n)
    expect(r.cobranca.centavos).toBe(166529n)
    expect(r.desconto.centavos + r.cobranca.centavos).toBe(185033n)
  })
})

describe('aplicarDesconto — casos de borda obrigatórios (ADR 0015)', () => {
  it('percentual = 0: desconto 0, cobrança cheia', () => {
    const r = aplicarDesconto(mensalidade(123456n), criarPercentualCentesimos(0n))
    expect(r.desconto.centavos).toBe(0n)
    expect(r.cobranca.centavos).toBe(123456n)
  })

  it('percentual = 10000 (100%): desconto é a mensalidade cheia, cobrança 0', () => {
    const r = aplicarDesconto(mensalidade(123456n), criarPercentualCentesimos(10000n))
    expect(r.desconto.centavos).toBe(123456n)
    expect(r.cobranca.centavos).toBe(0n)
  })

  it('mensalidade = 0: desconto e cobrança são 0, qualquer que seja o percentual', () => {
    const r = aplicarDesconto(mensalidade(0n), criarPercentualCentesimos(5000n))
    expect(r.desconto.centavos).toBe(0n)
    expect(r.cobranca.centavos).toBe(0n)
  })

  it('mensalidade = 1 centavo com percentual > 0: desconto é SEMPRE 1, nunca 0', () => {
    // "Arredondar para cima" tem que valer até no menor valor possível —
    // ceilDiv(1 × 1, 10000) = 1, não 0.
    const r1 = aplicarDesconto(mensalidade(1n), criarPercentualCentesimos(1n))
    expect(r1.desconto.centavos).toBe(1n)
    expect(r1.cobranca.centavos).toBe(0n)

    const r2 = aplicarDesconto(mensalidade(1n), criarPercentualCentesimos(10000n))
    expect(r2.desconto.centavos).toBe(1n)
    expect(r2.cobranca.centavos).toBe(0n)
  })

  it('recusa percentual fora do intervalo', () => {
    expect(() => aplicarDesconto(mensalidade(100n), -1n)).toThrow()
    expect(() => aplicarDesconto(mensalidade(100n), 10001n)).toThrow()
  })

  it('recusa mensalidade negativa', () => {
    expect(() => aplicarDesconto(mensalidade(-1n), 1000n)).toThrow()
  })
})

describe('aplicarDesconto — property-based (ADR 0015: a soma sozinha não basta)', () => {
  const arbMensalidade = fc.bigInt({ min: 0n, max: 10n ** 12n })
  const arbPercentual = fc.bigInt({ min: 0n, max: 10000n })

  it('a soma é EXATAMENTE a mensalidade, sempre', () => {
    fc.assert(
      fc.property(arbMensalidade, arbPercentual, (m, p) => {
        const { desconto, cobranca } = aplicarDesconto(mensalidade(m), p)
        expect(desconto.centavos + cobranca.centavos).toBe(m)
      }),
    )
  })

  /**
   * A propriedade que distingue "arredondar para cima" de "arredondar para
   * baixo com sinal invertido" — um bug que trocasse `ceilDiv` por `floorDiv`
   * ainda fecharia a soma acima, porque a soma é sempre `mensalidade` por
   * construção (subtração). O que prova a DIREÇÃO é comparar com o piso da
   * divisão exata: o desconto nunca fica abaixo dele, e a cobrança nunca fica
   * acima do que sobraria se o desconto tivesse sido arredondado para baixo.
   */
  it('o desconto nunca arredonda a favor da Firmare: desconto >= floor(mensalidade*percentual/10000)', () => {
    fc.assert(
      fc.property(arbMensalidade, arbPercentual, (m, p) => {
        const { desconto, cobranca } = aplicarDesconto(mensalidade(m), p)
        const pisoDoDesconto = (m * p) / 10000n // divisão inteira = floor para valores não-negativos
        expect(desconto.centavos).toBeGreaterThanOrEqual(pisoDoDesconto)
        expect(cobranca.centavos).toBeLessThanOrEqual(m - pisoDoDesconto)
      }),
    )
  })

  it('desconto e cobranca nunca são negativos', () => {
    fc.assert(
      fc.property(arbMensalidade, arbPercentual, (m, p) => {
        const { desconto, cobranca } = aplicarDesconto(mensalidade(m), p)
        expect(desconto.ehNegativo()).toBe(false)
        expect(cobranca.ehNegativo()).toBe(false)
      }),
    )
  })
})
