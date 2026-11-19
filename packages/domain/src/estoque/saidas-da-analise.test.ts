import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { Dinheiro } from '../dinheiro'
import type { MovimentoDeEstoque, TipoDeMovimento } from '../estoque'
import { ajustesDoPeriodoDaAnalise, analiseDoPeriodo, saidasDoPeriodoDaAnalise } from '../estoque-analise'
import { Quantidade } from '../quantidade'
import { custoDaQuantidade, valorDaFalta } from './valor-da-falta'

/**
 * O relatório 11 no modo "período da análise" (números B8): as linhas são as
 * saídas que a Análise SOMOU, com o mesmo recorte por índice — e por isso a
 * soma das linhas é o `saidas` da Análise, compensação incluída.
 */
let seq = 0
const mov = (tipo: TipoDeMovimento, milesimos: bigint, dia: string, extra: Partial<MovimentoDeEstoque> = {}): MovimentoDeEstoque => ({
  id: `m${++seq}`,
  sequencia: BigInt(seq),
  tipo,
  milesimos,
  dia,
  em: `${dia}T12:00:00.000Z`,
  lote: null,
  ...extra,
})
const contagem = (milesimos: bigint, dia: string, grupo: string) => mov('contagem', milesimos, dia, { contagemId: grupo })
const somaDasLinhas = (linhas: readonly MovimentoDeEstoque[]) => linhas.reduce((s, m) => s - m.milesimos, 0n)

describe('saidasDoPeriodoDaAnalise — as linhas que a Análise somou', () => {
  it('saidas-batem-com-analise-reabertura: concluída, reaberta e concluída de novo soma a saída UMA vez', () => {
    const baixa = mov('consumo', -2_000n, '2026-03-05')
    const movs = [
      contagem(10_000n, '2026-03-01', 'c1'),
      baixa,
      // A reabertura compensa a baixa: mesmo tipo, sinal oposto, ligada à origem.
      mov('consumo', 2_000n, '2026-03-06', { compensaId: baixa.id }),
      mov('consumo', -2_000n, '2026-03-07'),
      contagem(8_000n, '2026-03-31', 'c2'),
    ]
    const linhas = saidasDoPeriodoDaAnalise(movs, '2026-03-01', '2026-03-31')!
    expect(linhas.map((m) => m.milesimos)).toEqual([-2_000n, 2_000n, -2_000n])
    expect(somaDasLinhas(linhas)).toBe(2_000n)
    expect(analiseDoPeriodo(movs, '2026-03-01', '2026-03-31', 'ampola')!.saidas.milesimos).toBe(2_000n)
  })

  it('sobra-de-frasco-dose-mais-descarte: item que não aproveita sobra dá dose + descarte = 1 unidade', () => {
    const movs = [
      contagem(5_000n, '2026-03-01', 'c1'),
      mov('consumo', -300n, '2026-03-10'),
      mov('descarte', -700n, '2026-03-10'),
      contagem(4_000n, '2026-03-31', 'c2'),
    ]
    const linhas = saidasDoPeriodoDaAnalise(movs, '2026-03-01', '2026-03-31')!
    expect(linhas.map((m) => m.tipo)).toEqual(['consumo', 'descarte'])
    expect(somaDasLinhas(linhas)).toBe(1_000n)
  })

  it('entrada, ajuste e contagem do meio NÃO viram linha; sem duas contagens é null', () => {
    const movs = [
      contagem(5_000n, '2026-03-01', 'c1'),
      mov('entrada', 3_000n, '2026-03-02'),
      mov('ajuste', -1_000n, '2026-03-03'),
      contagem(6_000n, '2026-03-15', 'c-meio'),
      mov('interno', -500n, '2026-03-20'),
      contagem(6_500n, '2026-03-31', 'c2'),
    ]
    expect(saidasDoPeriodoDaAnalise(movs, '2026-03-01', '2026-03-31')!.map((m) => m.tipo)).toEqual(['interno'])
    expect(saidasDoPeriodoDaAnalise([contagem(1_000n, '2026-03-01', 'c1')], '2026-03-01', '2026-03-31')).toBeNull()
  })

  it('PROPRIEDADE: por item, a soma das linhas é exatamente o `saidas` da Análise', () => {
    const tipo = fc.constantFrom<TipoDeMovimento>('entrada', 'consumo', 'descarte', 'interno', 'ajuste', 'contagem')
    const passo = fc.record({ tipo, q: fc.bigInt({ min: 1n, max: 50_000n }), dia: fc.integer({ min: 1, max: 28 }) })
    fc.assert(
      fc.property(fc.array(passo, { maxLength: 25 }), fc.integer({ min: 1, max: 28 }), fc.integer({ min: 0, max: 27 }), (passos, d0, largura) => {
        const dia = (d: number) => `2026-02-${String(d).padStart(2, '0')}`
        const movs = passos.map((p, i) => {
          if (p.tipo === 'contagem') return contagem(p.q, dia(p.dia), `g${i}`)
          const sinal = p.tipo === 'entrada' ? 1n : p.tipo === 'ajuste' && i % 2 === 0 ? 1n : -1n
          return mov(p.tipo, sinal * p.q, dia(p.dia))
        })
        const de = dia(d0)
        const ate = dia(Math.min(28, d0 + largura))
        const a = analiseDoPeriodo(movs, de, ate, 'ampola')
        const linhas = saidasDoPeriodoDaAnalise(movs, de, ate)
        if (a === null) return linhas === null
        return linhas !== null && somaDasLinhas(linhas) === a.saidas.milesimos
      }),
    )
  })
})

describe('ajustesDoPeriodoDaAnalise — o relatório 11 com o motivo "ajuste"', () => {
  it('os ajustes do recorte, dos dois sentidos; o de depois da contagem final fica fora', () => {
    const movs = [
      contagem(10_000n, '2026-03-01', 'c1'),
      mov('consumo', -2_000n, '2026-03-05'),
      mov('ajuste', -1_000n, '2026-03-06'),
      mov('ajuste', 250n, '2026-03-07'),
      contagem(7_000n, '2026-03-20', 'c2'),
      mov('ajuste', -3_000n, '2026-03-22'),
    ]
    const linhas = ajustesDoPeriodoDaAnalise(movs, '2026-03-01', '2026-03-31')!
    expect(linhas.map((m) => m.milesimos)).toEqual([-1_000n, 250n])
    expect(analiseDoPeriodo(movs, '2026-03-01', '2026-03-31', 'ampola')!.ajustes.milesimos).toBe(-750n)
    expect(ajustesDoPeriodoDaAnalise([contagem(1_000n, '2026-03-01', 'c1')], '2026-03-01', '2026-03-31')).toBeNull()
  })

  it('PROPRIEDADE: por item, a soma assinada das linhas é exatamente o `ajustes` da Análise', () => {
    const tipo = fc.constantFrom<TipoDeMovimento>('entrada', 'consumo', 'descarte', 'interno', 'ajuste', 'contagem')
    const passo = fc.record({ tipo, q: fc.bigInt({ min: 1n, max: 50_000n }), dia: fc.integer({ min: 1, max: 28 }), mais: fc.boolean() })
    fc.assert(
      fc.property(fc.array(passo, { maxLength: 25 }), fc.integer({ min: 1, max: 28 }), fc.integer({ min: 0, max: 27 }), (passos, d0, largura) => {
        const dia = (d: number) => `2026-02-${String(d).padStart(2, '0')}`
        const movs = passos.map((p, i) => {
          if (p.tipo === 'contagem') return contagem(p.q, dia(p.dia), `g${i}`)
          const sinal = p.tipo === 'entrada' || (p.tipo === 'ajuste' && p.mais) ? 1n : -1n
          return mov(p.tipo, sinal * p.q, dia(p.dia))
        })
        const de = dia(d0)
        const ate = dia(Math.min(28, d0 + largura))
        const a = analiseDoPeriodo(movs, de, ate, 'ampola')
        const linhas = ajustesDoPeriodoDaAnalise(movs, de, ate)
        if (a === null) return linhas === null
        return linhas !== null && linhas.every((m) => m.tipo === 'ajuste') && linhas.reduce((s, m) => s + m.milesimos, 0n) === a.ajustes.milesimos
      }),
    )
  })
})

describe('custoDaQuantidade — assinado, meio-para-cima por linha', () => {
  const amp = (m: bigint) => Quantidade.deMilesimos(m, 'ampola')
  const reais = (c: bigint) => Dinheiro.deCentavos(c)

  it('é o valorDaFalta da mesma quantidade, com o sinal', () => {
    expect(custoDaQuantidade(amp(2_500n), reais(1_000n)).centavos).toBe(2_500n)
    expect(custoDaQuantidade(amp(-500n), reais(1n)).centavos).toBe(-1n)
  })

  it('PROPRIEDADE: compensação anula a baixa (custo(q) + custo(−q) = 0) e bate com valorDaFalta', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: 10_000_000n }), fc.bigInt({ min: 0n, max: 10_000_000n }), (q, c) => {
        const ida = custoDaQuantidade(amp(q), reais(c))
        const volta = custoDaQuantidade(amp(-q), reais(c))
        return ida.mais(volta).ehZero() && ida.centavos === valorDaFalta(amp(-q), reais(c)).centavos
      }),
    )
  })
})
