import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { Dinheiro } from './dinheiro'
import { residuoDeArredondamento, totaisPorDia } from './faturamento-externo'
import { ehErro, exigir } from './resultado'

/**
 * As propriedades do parecer de números (`docs/specs/integracao-medx-gate-numeros.md`,
 * "Propriedades que o T5 tem de provar"), numeradas como lá.
 */

/** Texto JSON canônico de `d` dezmilésimos, com `casas` casas (0 a 4) e zeros à direita. */
function textoDe(d: bigint, casas: number): string {
  const negativo = d < 0n
  const a = negativo ? -d : d
  const inteiro = a / 10000n
  const fracao = (a % 10000n).toString().padStart(4, '0')
  const corpo = casas === 0 ? inteiro.toString() : `${inteiro}.${fracao.slice(0, casas)}`
  return `${negativo ? '-' : ''}${corpo}`
}

/** Dezmilésimos que cabem em `casas` casas: múltiplos de 10^(4−casas). */
const decimal = fc
  .tuple(fc.bigInt({ min: -10_000_000_000n, max: 10_000_000_000n }), fc.integer({ min: 0, max: 4 }))
  .map(([n, casas]) => {
    const passo = 10n ** BigInt(4 - casas)
    return { d: n * passo, casas }
  })

/** Valores colados em `.xx5`: o caso que o arredondamento erra. */
const meio = fc
  .tuple(fc.bigInt({ min: -1_000_000n, max: 1_000_000n }), fc.constantFrom(-1n, 0n, 1n))
  .map(([c, delta]) => c * 100n + 50n * (c < 0n ? -1n : 1n) + delta)

const ler = (s: string) => exigir(Dinheiro.deDecimalExterno(s))

describe('Dinheiro.deDecimalExterno — o número do MedX, em texto', () => {
  it('casos medidos no parecer', () => {
    expect(ler('1.250')).toEqual({ centavos: 125n, exatoEmDezmilesimos: 12500n, arredondado: false })
    expect(ler('33.3350')).toEqual({ centavos: 3334n, exatoEmDezmilesimos: 333350n, arredondado: true })
    expect(ler('-10.00')).toEqual({ centavos: -1000n, exatoEmDezmilesimos: -100000n, arredondado: false })
    expect(ler('1.005').centavos).toBe(101n)
    expect(ler('1.255').centavos).toBe(126n)
    expect(ler('-1.0050').centavos).toBe(-101n)
    expect(ler('0').centavos).toBe(0n)
  })

  it('1. texto exato: volta com os dezmilésimos que entraram, com qualquer zero à direita', () => {
    fc.assert(
      fc.property(decimal, ({ d, casas }) => {
        expect(ler(textoDe(d, casas)).exatoEmDezmilesimos).toBe(d)
      }),
    )
  })

  it('2. arredonda ao centavo mais próximo; no meio, para longe do zero', () => {
    fc.assert(
      fc.property(fc.oneof(decimal.map((x) => x.d), meio), (d) => {
        const r = ler(textoDe(d, 4))
        const desvio = r.centavos * 100n - d
        expect(desvio <= 50n && desvio >= -50n).toBe(true)
        if (desvio === 50n || desvio === -50n) expect(desvio > 0n).toBe(d > 0n)
      }),
    )
  })

  it('3. simetria: o pagamento e o estorno dele somam zero', () => {
    fc.assert(
      fc.property(fc.oneof(decimal.map((x) => x.d), meio), (d) => {
        expect(ler(textoDe(d, 4)).centavos + ler(textoDe(-d, 4)).centavos).toBe(0n)
      }),
    )
  })

  it('4. com até 2 casas, nada é arredondado', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: -10_000_000_000n, max: 10_000_000_000n }), fc.integer({ min: 0, max: 2 }), (c, casas) => {
        const d = c * 100n
        const r = ler(textoDe(d, Math.max(casas, 2)))
        expect(r.centavos * 100n).toBe(d)
        expect(r.arredondado).toBe(false)
      }),
    )
  })

  it('5. o que não é a gramática fechada é erro, nunca um número', () => {
    for (const s of ['', ' ', '1e3', '1E3', '1.23456', 'NaN', 'Infinity', '1,50', '1.000,00', '1.000.000',
      '+1', '.5', '5.', '--1', '0x10', ' 1', '1 ', '١٢']) {
      expect(ehErro(Dinheiro.deDecimalExterno(s)), JSON.stringify(s)).toBe(true)
    }
    fc.assert(
      fc.property(fc.string(), (s) => {
        const r = Dinheiro.deDecimalExterno(s)
        if (!/^-?\d+(\.\d{1,4})?$/.test(s)) expect(ehErro(r)).toBe(true)
      }),
    )
  })
})

const dia = fc.integer({ min: 1, max: 28 }).map((n) => `2026-11-${String(n).padStart(2, '0')}`)
const pagamento = fc.record({ dia, d: decimal.map((x) => x.d) }).map(({ dia, d }) => {
  const r = ler(textoDe(d, 4))
  return { dia, centavos: r.centavos, exatoEmDezmilesimos: r.exatoEmDezmilesimos }
})
const TODOS = Array.from({ length: 28 }, (_, i) => `2026-11-${String(i + 1).padStart(2, '0')}`)

describe('totaisPorDia — a substituição por janela', () => {
  it('todo dia da janela tem linha, inclusive os de zero (linha existe ⇔ dia lido)', () => {
    const t = totaisPorDia([], ['2026-11-01', '2026-11-02'])
    expect(t).toEqual([
      { dia: '2026-11-01', centavos: 0n, exatoEmDezmilesimos: 0n, quantidade: 0 },
      { dia: '2026-11-02', centavos: 0n, exatoEmDezmilesimos: 0n, quantidade: 0 },
    ])
  })

  it('6. a soma dos dias é a soma dos pagamentos: nenhum em dois dias, nenhum perdido', () => {
    fc.assert(
      fc.property(fc.array(pagamento, { maxLength: 60 }), (ps) => {
        const t = totaisPorDia(ps, TODOS)
        expect(t.reduce((s, x) => s + x.centavos, 0n)).toBe(ps.reduce((s, p) => s + p.centavos, 0n))
        expect(t.reduce((s, x) => s + x.quantidade, 0)).toBe(ps.length)
      }),
    )
  })

  it('7. a ordem dos pagamentos (e das páginas) não muda nenhum total', () => {
    fc.assert(
      fc.property(fc.array(pagamento, { maxLength: 40 }).chain((ps) => fc.tuple(fc.constant(ps), fc.shuffledSubarray(ps, { minLength: ps.length }))), ([ps, embaralhado]) => {
        expect(totaisPorDia(embaralhado, TODOS)).toEqual(totaisPorDia(ps, TODOS))
      }),
    )
  })

  it('8. o período fecha: a soma de qualquer partição é a soma do todo', () => {
    fc.assert(
      fc.property(fc.array(pagamento, { maxLength: 40 }), fc.integer({ min: 1, max: 27 }), (ps, corte) => {
        const total = (dias: string[]) => totaisPorDia(ps, dias).reduce((s, x) => s + x.centavos, 0n)
        expect(total(TODOS.slice(0, corte)) + total(TODOS.slice(corte))).toBe(total(TODOS))
      }),
    )
  })

  it('9. o resíduo de arredondamento é no máximo meio centavo por pagamento', () => {
    fc.assert(
      fc.property(fc.array(pagamento, { maxLength: 40 }), (ps) => {
        const t = totaisPorDia(ps, TODOS)
        const residuo = t.reduce((s, x) => s + x.centavos * 100n - x.exatoEmDezmilesimos, 0n)
        const limite = 50n * BigInt(ps.length)
        expect(residuo <= limite && residuo >= -limite).toBe(true)
      }),
    )
  })

  it('pagamento de dia fora da janela não entra (dia de borda não coberto)', () => {
    const t = totaisPorDia([{ dia: '2026-10-31', centavos: 500n, exatoEmDezmilesimos: 50000n }], ['2026-11-01'])
    expect(t).toEqual([{ dia: '2026-11-01', centavos: 0n, exatoEmDezmilesimos: 0n, quantidade: 0 }])
  })
})

describe('residuoDeArredondamento', () => {
  it('3 × 33,3333: R$ 99,99 arredondado por pagamento, R$ 99,9999 exato — um centavo a menos', () => {
    expect(residuoDeArredondamento(9999n, 999999n)).toBe(-1n)
  })
  it('100 × 0,005: arredondados dão R$ 1,00 a mais que o exato', () => {
    expect(residuoDeArredondamento(100n, 5000n)).toBe(50n)
  })
  it('sem arredondamento, zero', () => {
    fc.assert(fc.property(fc.bigInt({ min: -10_000_000n, max: 10_000_000n }), (c) => {
      expect(residuoDeArredondamento(c, c * 100n)).toBe(0n)
    }))
  })
  it('o resíduo de pagamentos lidos fica dentro de meio centavo por pagamento, arredondado', () => {
    fc.assert(
      fc.property(fc.array(pagamento, { maxLength: 40 }), (ps) => {
        const c = ps.reduce((s, p) => s + p.centavos, 0n)
        const e = ps.reduce((s, p) => s + p.exatoEmDezmilesimos, 0n)
        const r = residuoDeArredondamento(c, e)
        const limite = (50n * BigInt(ps.length) + 50n) / 100n
        expect(r <= limite && r >= -limite).toBe(true)
      }),
    )
  })
})
