import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { calcularFechamento, somaDosItensMarcados } from './fechamento'
import { textoDeCentavos } from './dinheiro-digitado'

const ITENS = [
  { chave: 'a', valor: '1000000' },
  { chave: 'b', valor: '500000' },
  { chave: 'c', valor: '1000000' },
]

describe('somaDosItensMarcados', () => {
  it('soma só os marcados', () => {
    expect(somaDosItensMarcados(ITENS, new Set(['a', 'b']))).toBe(1_500_000n)
  })
  it('sem nenhum marcado, ou com um marcado sem preço, não sugere nada', () => {
    expect(somaDosItensMarcados(ITENS, new Set())).toBeNull()
    expect(somaDosItensMarcados([...ITENS, { chave: 'd' }], new Set(['a', 'd']))).toBeNull()
  })
})

describe('calcularFechamento — o roteiro de 25.000', () => {
  const oferta = 2_500_000n
  it('parte: fechado 15.000, recebido 5.000 → em aberto 10.000, restante 10.000', () => {
    const r = calcularFechamento({ oferta, tipo: 'parte', fechadoDigitado: '15.000,00', entradaDigitada: '5.000,00' })
    expect(r).toMatchObject({
      fechado: 1_500_000n,
      entrada: 500_000n,
      pagamentoEmAberto: 1_000_000n,
      restante: 1_000_000n,
      erro: null,
    })
  })
  it('tudo: o fechado é o orçamento, e não há restante', () => {
    const r = calcularFechamento({ oferta, tipo: 'tudo', fechadoDigitado: '', entradaDigitada: '10.000,00' })
    expect(r).toMatchObject({ fechado: oferta, pagamentoEmAberto: 1_500_000n, restante: null, erro: null })
  })
  it('parte com fechado igual ou maior que o orçamento é erro', () => {
    expect(calcularFechamento({ oferta, tipo: 'parte', fechadoDigitado: '25.000,00', entradaDigitada: '' }).erro).toMatch(
      /menor que o orçamento/,
    )
  })
  it('entrada maior que o fechado é erro, e não há pagamento em aberto negativo', () => {
    const r = calcularFechamento({ oferta, tipo: 'parte', fechadoDigitado: '1.000,00', entradaDigitada: '2.000,00' })
    expect(r.erro).toMatch(/maior que o valor fechado/)
    expect(r.pagamentoEmAberto).toBeNull()
  })
})

describe('calcularFechamento — as FRONTEIRAS reais (property-based)', () => {
  const gOferta = fc.bigInt({ min: 2n, max: 10n ** 12n })
  const calc = (oferta: bigint, tipo: 'tudo' | 'parte', fechado: bigint, entrada: bigint) =>
    calcularFechamento({
      oferta,
      tipo,
      fechadoDigitado: textoDeCentavos(fechado),
      entradaDigitada: textoDeCentavos(entrada),
    })

  it('parte: fechado == oferta é erro; fechado == oferta − 1 é aceito (fronteira exata)', () => {
    fc.assert(
      fc.property(gOferta, (oferta) => {
        expect(calc(oferta, 'parte', oferta, 1n).erro).toMatch(/menor que o orçamento/)
        const ok = calc(oferta, 'parte', oferta - 1n, 1n)
        expect(ok.erro).toBeNull()
        expect(ok.restante).toBe(1n)
      }),
    )
  })

  it('parte exige fechado < oferta: acima da oferta também é erro', () => {
    fc.assert(
      fc.property(gOferta, fc.bigInt({ min: 0n, max: 10n ** 6n }), (oferta, a) => {
        expect(calc(oferta, 'parte', oferta + a, 1n).erro).toMatch(/menor que o orçamento/)
      }),
    )
  })

  it('total: o fechado é SEMPRE a oferta, e não há restante', () => {
    fc.assert(
      fc.property(gOferta, fc.bigInt({ min: 0n, max: 10n ** 12n }), (oferta, e) => {
        const entrada = e % (oferta + 1n)
        const r = calc(oferta, 'tudo', 999n, entrada)
        expect(r.fechado).toBe(oferta)
        expect(r.restante).toBeNull()
        expect(r.pagamentoEmAberto).toBe(oferta - entrada)
      }),
    )
  })

  it('entrada == fechado: nada em aberto, e sem erro; entrada > fechado: erro e sem valor em aberto', () => {
    fc.assert(
      fc.property(gOferta, fc.bigInt({ min: 1n, max: 10n ** 12n }), (oferta, f0) => {
        const fechado = 1n + (f0 % (oferta - 1n)) // 1 .. oferta-1
        const igual = calc(oferta, 'parte', fechado, fechado)
        expect(igual.erro).toBeNull()
        expect(igual.pagamentoEmAberto).toBe(0n)
        const passa = calc(oferta, 'parte', fechado, fechado + 1n)
        expect(passa.erro).toMatch(/maior que o valor fechado/)
        expect(passa.pagamentoEmAberto).toBeNull()
      }),
    )
  })

  it('o pagamento em aberto NUNCA é negativo, para qualquer combinação', () => {
    fc.assert(
      fc.property(
        gOferta,
        fc.constantFrom<'tudo' | 'parte'>('tudo', 'parte'),
        fc.bigInt({ min: 0n, max: 2n * 10n ** 12n }),
        fc.bigInt({ min: 0n, max: 2n * 10n ** 12n }),
        (oferta, tipo, fechado, entrada) => {
          const r = calc(oferta, tipo, fechado, entrada)
          if (r.pagamentoEmAberto !== null) expect(r.pagamentoEmAberto >= 0n).toBe(true)
        },
      ),
    )
  })

  it('quando não há erro: em aberto + recebido = fechado, e restante + fechado = oferecido', () => {
    fc.assert(
      fc.property(gOferta, fc.bigInt({ min: 1n, max: 10n ** 12n }), fc.bigInt({ min: 1n, max: 10n ** 12n }), (oferta, f0, e0) => {
        const fechado = 1n + (f0 % (oferta - 1n))
        const entrada = 1n + (e0 % fechado)
        const r = calc(oferta, 'parte', fechado, entrada)
        expect(r.erro).toBeNull()
        expect(r.pagamentoEmAberto! + r.entrada!).toBe(fechado)
        expect(r.restante! + r.fechado!).toBe(oferta)
      }),
    )
  })
})
