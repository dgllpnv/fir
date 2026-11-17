import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { fimDoMes, somarDias, somarMeses } from '../relogio'
import {
  agrupamentoPara,
  baldes,
  corteDosDiasQueContam,
  diaConta,
  diasDe,
  janelaComparavel,
  mesesDaSerie,
  prazoDoLancamento,
  referenciaDoPeriodo,
  referenciaPendente,
  regimeDoDia,
  validarJanela,
  variacao,
} from './periodos'
import { NumeroDoKpi } from './unidades'

describe('agrupamento e baldes (I-29, A.3)', () => {
  it('junho–novembro dá 6 barras mensais; 01/11–hoje dá dia a dia', () => {
    expect(agrupamentoPara('2026-06-01', '2026-11-17', 'mensal')).toBe('mes')
    const b = baldes('2026-06-01', '2026-11-17', 'mes', '2026-11-17')
    expect(b).toHaveLength(6)
    expect(b.map((x) => x.inicio)).toEqual(['2026-06-01', '2026-07-01', '2026-08-01', '2026-09-01', '2026-10-01', '2026-11-01'])
    expect(b.at(-1)).toEqual({ inicio: '2026-11-01', fim: '2026-11-18', parcial: true })
    expect(b[0]!.parcial).toBe(false)

    expect(agrupamentoPara('2026-11-01', '2026-11-17', 'mensal')).toBe('dia')
    expect(baldes('2026-11-01', '2026-11-17', 'dia', '2026-11-17')).toHaveLength(17)
    expect(agrupamentoPara('2026-11-01', '2026-11-17', 'semanal')).toBe('semana')
  })

  it('baldes semanais começam na segunda e se cortam nas bordas', () => {
    const b = baldes('2026-11-01', '2026-11-17', 'semana', '2026-11-17')
    expect(b.map((x) => [x.inicio, x.fim])).toEqual([
      ['2026-11-01', '2026-11-02'],
      ['2026-11-02', '2026-11-09'],
      ['2026-11-09', '2026-11-16'],
      ['2026-11-16', '2026-11-18'],
    ])
  })

  it('property: os baldes cobrem a janela exatamente, sem buraco nem sobreposição', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 900 }), fc.integer({ min: 0, max: 400 }), fc.constantFrom('mes' as const, 'semana' as const, 'dia' as const), (off, dur, ag) => {
        const de = somarDias('2025-01-01', off)
        const ate = somarDias(de, dur)
        const b = baldes(de, ate, ag, ate)
        expect(b[0]!.inicio).toBe(de)
        expect(b.at(-1)!.fim).toBe(somarDias(ate, 1))
        for (let i = 1; i < b.length; i++) expect(b[i]!.inicio).toBe(b[i - 1]!.fim)
      }),
      { numRuns: 60 },
    )
  })

  it('data futura e De depois de Até → erro (422)', () => {
    expect(validarJanela('2026-11-10', '2026-11-01', '2026-11-17').tipo).toBe('erro')
    expect(validarJanela('2026-11-01', '2026-11-18', '2026-11-17').tipo).toBe('erro')
    expect(validarJanela('2026-11-01', '2026-11-17', '2026-11-17').tipo).toBe('ok')
  })

  it('mesesDaSerie: 6 meses terminando no atual', () => {
    expect(mesesDaSerie('2026-11-17', 6)).toEqual(['2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11'])
    expect(mesesDaSerie('2026-02-28', 3)).toEqual(['2025-12', '2026-01', '2026-02'])
  })
})

describe('janela comparável (I-28, números c.8 e B1)', () => {
  it('janela-comparavel-mes-curto: 30/03 e 31/03 → 28/02 em 2027 e 29/02 em 2028', () => {
    for (const ate of ['2027-03-30', '2027-03-31']) {
      const ant = janelaComparavel(diasDe('2027-03-01', ate), 'mensal')
      expect(ant.at(-1)).toBe('2027-02-28')
      expect(ant).toHaveLength(28)
    }
    for (const ate of ['2028-03-30', '2028-03-31']) {
      const ant = janelaComparavel(diasDe('2028-03-01', ate), 'mensal')
      expect(ant.at(-1)).toBe('2028-02-29')
      expect(ant).toHaveLength(29)
    }
  })

  it('property: |anterior| = min(|atual|, dias do mês anterior) — "igual ou um a menos" é falso', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 120 }), fc.integer({ min: 1, max: 31 }), (mesOff, k) => {
        const mes = somarMeses('2025-01-01', mesOff).slice(0, 7)
        const ultimo = Number(fimDoMes(mes).slice(8))
        const n = Math.min(k, ultimo)
        const atual = diasDe(`${mes}-01`, `${mes}-${String(n).padStart(2, '0')}`)
        const anterior = somarMeses(`${mes}-01`, -1).slice(0, 7)
        const tamanhoAnterior = Number(fimDoMes(anterior).slice(8))
        expect(janelaComparavel(atual, 'mensal')).toHaveLength(Math.min(n, tamanhoAnterior))
      }),
    )
  })

  it('janela-comparavel-usa-dias-de-D: os mesmos NÚMEROS de dia do conjunto que conta, não o prefixo', () => {
    // D = 1, 2 e 4 (o 3 aberto): o anterior compara 1, 2 e 4, nunca 1–4.
    expect(janelaComparavel(['2027-03-01', '2027-03-02', '2027-03-04'], 'mensal')).toEqual(['2027-02-01', '2027-02-02', '2027-02-04'])
    expect(janelaComparavel(['2026-11-16', '2026-11-18'], 'semanal')).toEqual(['2026-11-09', '2026-11-11'])
  })

  it('variação: percentual em pontos, o resto relativo, anterior zero é "novo"', () => {
    const p = (x: bigint) => NumeroDoKpi.de('percentual', x)
    expect(variacao(p(6_500n), p(6_000n))).toEqual({ tipo: 'pontos', emCentesimos: 500n })
    const q = (x: bigint) => NumeroDoKpi.de('quantidade', x)
    expect(variacao(q(1_500n), q(1_000n))).toEqual({ tipo: 'relativa', percentual: 50 })
    expect(variacao(q(500n), q(1_000n))).toEqual({ tipo: 'relativa', percentual: -50 })
    expect(variacao(q(1n), q(0n))).toEqual({ tipo: 'novo' })
    expect(variacao(null, q(1n))).toBeNull()
  })
})

describe('lançamento (I-30, A.5)', () => {
  it('referência: a segunda da semana ou o dia 1º; a pendente é a do período de hoje', () => {
    expect(referenciaDoPeriodo('semanal', '2026-11-22')).toBe('2026-11-16') // domingo → segunda anterior
    expect(referenciaDoPeriodo('semanal', '2026-11-16')).toBe('2026-11-16')
    expect(referenciaPendente('mensal', '2026-11-17')).toBe('2026-11-01')
  })

  it('prazoDoLancamento com dia 31 em fevereiro cai no último dia (regra 25)', () => {
    expect(prazoDoLancamento('mensal', '2027-02-01', 31)).toEqual({ tipo: 'ok', valor: '2027-02-28' })
    expect(prazoDoLancamento('mensal', '2028-02-01', 31)).toEqual({ tipo: 'ok', valor: '2028-02-29' })
    expect(prazoDoLancamento('mensal', '2026-04-01', 30)).toEqual({ tipo: 'ok', valor: '2026-04-30' })
    expect(prazoDoLancamento('semanal', '2026-11-16', 5)).toEqual({ tipo: 'ok', valor: '2026-11-20' })
    expect(prazoDoLancamento('semanal', '2026-11-16', 8).tipo).toBe('erro')
    expect(prazoDoLancamento('semanal', '2026-11-17', 1).tipo).toBe('erro') // terça não é referência
    expect(prazoDoLancamento('mensal', '2026-11-02', 1).tipo).toBe('erro')
  })
})

describe('regime do dia (I-9, números B6)', () => {
  it('antes de conferencia_desde conta tudo; a partir dela, só com caixa; hoje sem caixa nunca conta', () => {
    const hoje = '2026-11-17'
    expect(regimeDoDia('2026-10-31', '2026-11-01', hoje)).toBe('anterior')
    expect(regimeDoDia('2026-11-01', '2026-11-01', hoje)).toBe('conferencia')
    expect(regimeDoDia('2026-11-05', null, hoje)).toBe('anterior')
    // hoje-sem-caixa-nao-conta (parte pura): nos dois regimes.
    expect(regimeDoDia(hoje, null, hoje)).toBe('conferencia')
    expect(diaConta(regimeDoDia(hoje, null, hoje), false)).toBe(false)
    expect(diaConta(regimeDoDia(hoje, null, hoje), true)).toBe(true)
    expect(diaConta(regimeDoDia('2026-10-31', '2026-11-01', hoje), false)).toBe(true)
    expect(diaConta(regimeDoDia('2026-11-03', '2026-11-01', hoje), false)).toBe(false)
    expect(() => regimeDoDia('2026-11-18', null, hoje)).toThrow()
  })

  it('o corte: L é o último dia que conta e D são os que contam até ele', () => {
    expect(corteDosDiasQueContam([])).toEqual({ ultimo: null, dias: [] })
    expect(
      corteDosDiasQueContam([
        { dia: '2026-11-03', conta: true },
        { dia: '2026-11-01', conta: true },
        { dia: '2026-11-04', conta: false },
      ]),
    ).toEqual({ ultimo: '2026-11-03', dias: ['2026-11-01', '2026-11-03'] })
  })
})
