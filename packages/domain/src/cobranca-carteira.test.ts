import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  type LinhaDeMensalidade,
  aplicarDesconto,
  criarPercentualCentesimos,
  receitaRecorrente,
  resumirMensalidades,
  situacaoDaMensalidade,
  vencimentoDaCompetencia,
} from './cobranca-carteira'
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

// ---------------------------------------------------------------------------
// G8 1F — Mensalidades: vencimento (regra 25), situação e totais do mês.
// ---------------------------------------------------------------------------

describe('vencimentoDaCompetencia — regra 25 (T-1, ajuste 4)', () => {
  it('casos fixos: dia 31 em fev/2027 vira 28, fev/2028 vira 29, abril vira 30', () => {
    expect(vencimentoDaCompetencia('2027-01-01', 31)).toBe('2027-01-31')
    expect(vencimentoDaCompetencia('2027-02-01', 31)).toBe('2027-02-28')
    expect(vencimentoDaCompetencia('2028-02-01', 31)).toBe('2028-02-29')
    expect(vencimentoDaCompetencia('2028-02-01', 30)).toBe('2028-02-29')
    expect(vencimentoDaCompetencia('2026-04-01', 30)).toBe('2026-04-30')
    expect(vencimentoDaCompetencia('2026-04-01', 31)).toBe('2026-04-30')
    expect(vencimentoDaCompetencia('2026-11-01', 10)).toBe('2026-11-10')
    expect(vencimentoDaCompetencia('2100-02-01', 29)).toBe('2100-02-28')
    expect(vencimentoDaCompetencia('2000-02-01', 29)).toBe('2000-02-29')
  })

  it('recusa dia fora de 1 a 31 e competência que não é o dia 1', () => {
    expect(() => vencimentoDaCompetencia('2026-11-01', 0)).toThrow()
    expect(() => vencimentoDaCompetencia('2026-11-01', 32)).toThrow()
    expect(() => vencimentoDaCompetencia('2026-11-01', 1.5)).toThrow()
    expect(() => vencimentoDaCompetencia('2026-11-15', 10)).toThrow()
  })

  it('property: para todo ano 2000 a 2100, mês e dia 1 a 31, cai no mesmo mês e é min(dia, último dia)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2000, max: 2100 }),
        fc.integer({ min: 1, max: 12 }),
        fc.integer({ min: 1, max: 31 }),
        (ano, mes, dia) => {
          const competencia = `${ano}-${String(mes).padStart(2, '0')}-01`
          const v = vencimentoDaCompetencia(competencia, dia)
          expect(v.slice(0, 7)).toBe(competencia.slice(0, 7))
          // Oráculo independente: o dia 0 do mês seguinte, em UTC.
          const ultimo = new Date(Date.UTC(ano, mes, 0)).getUTCDate()
          expect(Number(v.slice(8, 10))).toBe(Math.min(dia, ultimo))
        },
      ),
      { numRuns: 2000 },
    )
  })
})

const linha = (id: string, status: 'aberto' | 'pago', valor: bigint, vencimento: string): LinhaDeMensalidade => ({
  id,
  status,
  valor: Dinheiro.deCentavos(valor),
  vencimento,
})

describe('situacaoDaMensalidade — statusMensalidade do protótipo (L708-718), no servidor', () => {
  const hoje = '2027-02-15'
  it('paga vale antes de qualquer data', () => {
    expect(situacaoDaMensalidade(linha('a', 'pago', 1000n, '2027-02-01'), hoje)).toEqual({ situacao: 'paga', dias: -14 })
  })
  it('vence hoje, vencida há N dias, a vencer', () => {
    expect(situacaoDaMensalidade(linha('a', 'aberto', 1000n, '2027-02-15'), hoje)).toEqual({
      situacao: 'vence_hoje',
      dias: 0,
    })
    expect(situacaoDaMensalidade(linha('a', 'aberto', 1000n, '2027-02-10'), hoje)).toEqual({
      situacao: 'vencida',
      dias: -5,
    })
    expect(situacaoDaMensalidade(linha('a', 'aberto', 1000n, '2027-02-28'), hoje)).toEqual({
      situacao: 'a_vencer',
      dias: 13,
    })
  })
  it('ajuste 8: cobrança de valor 0 (desconto de 100%) nunca aparece como vencida', () => {
    const r = aplicarDesconto(mensalidade(185033n), criarPercentualCentesimos(10000n))
    expect(r.cobranca.centavos).toBe(0n)
    const l: LinhaDeMensalidade = { id: 'z', status: 'aberto', valor: r.cobranca, vencimento: '2027-02-01' }
    expect(situacaoDaMensalidade(l, hoje).situacao).toBe('sem_valor')
  })
})

describe('resumirMensalidades — totais do mês (ajuste 7, T-22)', () => {
  it('T-22 conferido à mão: A R$ 1.000,00 no dia 31, B R$ 1.850,33 com 10% no dia 10, fevereiro de 2027', () => {
    const b = aplicarDesconto(mensalidade(185033n), criarPercentualCentesimos(1000n))
    expect(b.desconto.centavos).toBe(18504n)
    expect(b.cobranca.centavos).toBe(166529n)
    const linhas: LinhaDeMensalidade[] = [
      linha('A', 'aberto', 100000n, vencimentoDaCompetencia('2027-02-01', 31)),
      { id: 'B', status: 'aberto', valor: b.cobranca, vencimento: vencimentoDaCompetencia('2027-02-01', 10) },
    ]
    expect(linhas[0]!.vencimento).toBe('2027-02-28')
    const antes = resumirMensalidades(linhas, '2027-02-05')
    expect(antes.total.centavos).toBe(266529n)
    expect(antes.recebido.centavos).toBe(0n)

    linhas[0] = linha('A', 'pago', 100000n, '2027-02-28')
    const depois = resumirMensalidades(linhas, '2027-02-05')
    expect(depois.recebido.centavos).toBe(100000n)
    expect(depois.total.centavos).toBe(266529n)
    expect(depois.aReceber.centavos).toBe(166529n)
    expect(depois.linhas.map((x) => [x.id, x.situacao])).toEqual([
      ['A', 'paga'],
      ['B', 'a_vencer'],
    ])
  })

  const arbLinha: fc.Arbitrary<LinhaDeMensalidade> = fc.record({
    id: fc.uuid(),
    status: fc.constantFrom('aberto' as const, 'pago' as const),
    valor: fc.bigInt({ min: 0n, max: 1_000_000_000n }).map((c) => Dinheiro.deCentavos(c)),
    vencimento: fc.integer({ min: 1, max: 28 }).map((d) => `2027-02-${String(d).padStart(2, '0')}`),
  })
  const arbHoje = fc
    .integer({ min: 0, max: 60 })
    .map((n) => new Date(Date.UTC(2027, 0, 15 + n)).toISOString().slice(0, 10))

  it('property: soma por situação = total (valor e quantidade), recebido + a receber = total', () => {
    fc.assert(
      fc.property(fc.array(arbLinha, { maxLength: 40 }), arbHoje, (linhas, hoje) => {
        const r = resumirMensalidades(linhas, hoje)
        const somaValor = r.porSituacao.reduce((acc, s) => acc + s.valor.centavos, 0n)
        const somaQtd = r.porSituacao.reduce((acc, s) => acc + s.quantidade, 0)
        const oraculo = linhas.reduce((acc, l) => acc + l.valor.centavos, 0n)
        expect(r.total.centavos).toBe(oraculo)
        expect(somaValor).toBe(r.total.centavos)
        expect(somaQtd).toBe(linhas.length)
        expect(r.recebido.centavos + r.aReceber.centavos).toBe(r.total.centavos)
        expect(r.linhas.length).toBe(linhas.length)
        // recebido é EXATAMENTE a soma das pagas: nada mais entra.
        const pagas = linhas.filter((l) => l.status === 'pago').reduce((acc, l) => acc + l.valor.centavos, 0n)
        expect(r.recebido.centavos).toBe(pagas)
      }),
      { numRuns: 500 },
    )
  })

  it('porSituacao traz as cinco situações, na ordem fixa, mesmo vazias', () => {
    const r = resumirMensalidades([], '2027-02-01')
    expect(r.porSituacao.map((s) => s.situacao)).toEqual(['vencida', 'vence_hoje', 'a_vencer', 'paga', 'sem_valor'])
    expect(r.total.centavos).toBe(0n)
  })
})

describe('receitaRecorrente — MRR e ticket médio (D-22 item 12: só clientes com mensalidade)', () => {
  it('ticket médio ignora quem tem mensalidade 0 e arredonda meio para cima', () => {
    const r = receitaRecorrente([100000n, 0n, 100001n, 0n].map((c) => Dinheiro.deCentavos(c)))
    expect(r.receita.centavos).toBe(200001n)
    expect(r.clientesComMensalidade).toBe(2)
    expect(r.ticketMedio?.centavos).toBe(100001n) // 200001 / 2 = 100000,5, meio para cima
  })
  it('ninguém com mensalidade: ticket é null (a tela mostra "—"), nunca R$ 0,00', () => {
    const r = receitaRecorrente([Dinheiro.zero()])
    expect(r.receita.centavos).toBe(0n)
    expect(r.ticketMedio).toBeNull()
    expect(r.clientesComMensalidade).toBe(0)
  })
  it('property: |ticket · n − receita| <= n/2 centavos', () => {
    fc.assert(
      fc.property(fc.array(fc.bigInt({ min: 0n, max: 500_000_000n }), { maxLength: 50 }), (cs) => {
        const r = receitaRecorrente(cs.map((c) => Dinheiro.deCentavos(c)))
        const positivos = cs.filter((c) => c > 0n)
        expect(r.receita.centavos).toBe(positivos.reduce((a, b) => a + b, 0n))
        expect(r.clientesComMensalidade).toBe(positivos.length)
        if (positivos.length === 0) {
          expect(r.ticketMedio).toBeNull()
          return
        }
        const n = BigInt(positivos.length)
        const erro = r.ticketMedio!.centavos * n - r.receita.centavos
        expect(2n * (erro < 0n ? -erro : erro) <= n).toBe(true)
      }),
    )
  })
})
