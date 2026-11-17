import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { Dinheiro } from '../dinheiro'
import {
  dentroDoDominio,
  ESCALA_DA_UNIDADE,
  formatarNumeroDoKpi,
  formatarValorNaTela,
  NumeroDoKpi,
  somarNumeros,
  UNIDADES_DE_KPI,
  valorAguardando,
  valorNaTela,
} from './unidades'

const arbUnidade = fc.constantFrom(...UNIDADES_DE_KPI)

describe('escala por unidade (I-2)', () => {
  it('a tabela: centavos, centésimos e minutos', () => {
    expect(ESCALA_DA_UNIDADE.reais.menorUnidade).toBe('centavos')
    expect(ESCALA_DA_UNIDADE.horas).toMatchObject({ menorUnidade: 'minutos', porUnidade: 60n })
    expect(ESCALA_DA_UNIDADE.nota).toMatchObject({ menorUnidade: 'centesimos', minimo: 0n, maximo: 1000n })
    for (const u of ['percentual', 'quantidade', 'dias'] as const) expect(ESCALA_DA_UNIDADE[u].menorUnidade).toBe('centesimos')
  })

  it('somar ou comparar unidades diferentes lança', () => {
    const a = NumeroDoKpi.de('reais', 100n)
    const b = NumeroDoKpi.de('quantidade', 100n)
    expect(() => a.mais(b)).toThrow()
    expect(() => a.comparar(b)).toThrow()
    expect(() => somarNumeros('reais', [a, b])).toThrow()
    expect(() => b.emDinheiro()).toThrow()
  })

  it('property: a soma de lista pelo value object é a soma dos inteiros', () => {
    fc.assert(
      fc.property(arbUnidade, fc.array(fc.bigInt({ min: -(10n ** 15n), max: 10n ** 15n })), (u, xs) => {
        const s = somarNumeros(u, xs.map((x) => NumeroDoKpi.de(u, x)))
        expect(s.emMenorUnidade).toBe(xs.reduce((a, b) => a + b, 0n))
        expect(s.unidade).toBe(u)
      }),
    )
  })

  it('domínio: nota de 0 a 10; negativo só com admiteNegativo', () => {
    expect(dentroDoDominio(NumeroDoKpi.de('nota', 1_001n))).toBe(false)
    expect(dentroDoDominio(NumeroDoKpi.de('nota', 1_000n))).toBe(true)
    expect(dentroDoDominio(NumeroDoKpi.de('reais', -1n))).toBe(false)
    expect(dentroDoDominio(NumeroDoKpi.de('reais', -1n), true)).toBe(true)
  })
})

describe('ValorNaTela (I-34, appsec C7)', () => {
  it('valor-na-tela-reais-sem-em-numero (property): XOR por unidade — reais só em emDinheiro, o resto só em emNumero', () => {
    fc.assert(
      fc.property(
        arbUnidade,
        fc.option(fc.bigInt({ min: -(10n ** 15n), max: 10n ** 15n })),
        fc.option(fc.bigInt({ min: 1n, max: 10n ** 15n })),
        fc.option(fc.array(fc.option(fc.bigInt({ min: -(10n ** 15n), max: 10n ** 15n })))),
        (u, valor, alvo, serie) => {
          const n = valor === null ? null : NumeroDoKpi.de(u, valor)
          const v = valorNaTela(
            u,
            n,
            alvo === null ? null : NumeroDoKpi.de(u, alvo),
            serie === null ? undefined : serie.map((s) => (s === null ? null : NumeroDoKpi.de(u, s))),
          )
          if (u === 'reais') expect(v.emNumero).toBeNull()
          else expect(v.emDinheiro).toBeNull()
          if (valor === null) {
            expect(v.emDinheiro).toBeNull()
            expect(v.emNumero).toBeNull()
          } else {
            expect(u === 'reais' ? v.emDinheiro : v.emNumero).toBe(valor.toString())
          }
          if (v.percentualDaMeta !== null) expect(Number.isInteger(v.percentualDaMeta)).toBe(true)
          if (v.escala !== null) expect(v.escala >= 0 && v.escala <= 100).toBe(true)
        },
      ),
    )
  })

  it('escala-relativa-a-propria-serie: a altura é relativa ao maior da série do PRÓPRIO KPI (appsec C10)', () => {
    const serie = [100n, 400n, 200n].map((x) => NumeroDoKpi.de('reais', x))
    expect(valorNaTela('reais', NumeroDoKpi.de('reais', 200n), null, serie).escala).toBe(50)
    expect(valorNaTela('reais', NumeroDoKpi.de('reais', 400n), null, serie).escala).toBe(100)
    // Série de outra unidade é outro KPI: recusa em vez de comparar.
    expect(() => valorNaTela('reais', NumeroDoKpi.de('reais', 1n), null, [NumeroDoKpi.de('quantidade', 5n)])).toThrow()
    expect(valorNaTela('reais', NumeroDoKpi.de('reais', 0n), null, []).escala).toBe(0)
  })

  it('percentualDaMeta inteiro; unidade declarada diferente da do número lança', () => {
    expect(valorNaTela('reais', NumeroDoKpi.de('reais', 9_360_000n), NumeroDoKpi.de('reais', 12_000_000n)).percentualDaMeta).toBe(78)
    expect(() => valorNaTela('quantidade', NumeroDoKpi.de('reais', 1n))).toThrow()
  })

  it('o ponto aguardando não leva valor nem escala (números c.10)', () => {
    expect(valorAguardando('reais')).toEqual({ unidade: 'reais', emDinheiro: null, emNumero: null, percentualDaMeta: null, escala: null })
  })
})

describe('formatador por unidade', () => {
  it('cada unidade com a sua escala, sem ponto flutuante', () => {
    expect(formatarNumeroDoKpi('reais', 521_739n)).toBe(Dinheiro.deCentavos(521_739n).formatar())
    expect(formatarNumeroDoKpi('percentual', 7_800n)).toBe('78%')
    expect(formatarNumeroDoKpi('percentual', 1_250n)).toBe('12,5%')
    expect(formatarNumeroDoKpi('quantidade', 123_400n)).toBe('1.234')
    expect(formatarNumeroDoKpi('nota', 850n)).toBe('8,5')
    expect(formatarNumeroDoKpi('dias', 100n)).toBe('1 dia')
    expect(formatarNumeroDoKpi('dias', 350n)).toBe('3,5 dias')
    expect(formatarNumeroDoKpi('horas', 750n)).toBe('12h30')
    expect(formatarNumeroDoKpi('horas', 120n)).toBe('2h')
    expect(formatarNumeroDoKpi('horas', -65n)).toBe('-1h05')
  })

  it('formatarValorNaTela: null quando a redação apagou', () => {
    const v = valorNaTela('reais', NumeroDoKpi.de('reais', 150n))
    expect(formatarValorNaTela(v)).toBe(Dinheiro.deCentavos(150n).formatar())
    expect(formatarValorNaTela({ ...v, emDinheiro: null })).toBeNull()
  })
})
