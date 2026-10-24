import { describe, expect, it } from 'vitest'
import { formatarDinheiro, formatarQuantidade } from './index'

describe('formatarDinheiro', () => {
  it('formata centavos em pt-BR', () => {
    expect(formatarDinheiro(125050n)).toBe('R$ 1.250,50')
    expect(formatarDinheiro(0n)).toBe('R$ 0,00')
    expect(formatarDinheiro(5n)).toBe('R$ 0,05')
  })

  it('sem ponto flutuante: o centavo exato acima de 2^53', () => {
    // `Number(abs / 100n) + Number(abs % 100n) / 100` devolvia
    // `R$ 900.719.925.474.099,20`. Mesmo defeito, mesmo teste e mesmo valor
    // que `packages/domain/src/dinheiro.test.ts` — os dois formatadores
    // precisam concordar, e o jeito de garantir é a mesma asserção nos dois.
    expect(formatarDinheiro(90071992547409919n)).toBe('R$ 900.719.925.474.099,19')
    expect(formatarDinheiro(100000000000000000007n)).toBe('R$ 1.000.000.000.000.000.000,07')
  })

  it('o espaço depois de "R$" é U+0020, não o U+00A0 do Intl', () => {
    const t = formatarDinheiro(100n)
    expect(t.includes(' ')).toBe(false)
    expect(t).toBe('R$ 1,00')
  })

  it('negativo leva o sinal na frente', () => {
    expect(formatarDinheiro(-500n)).toBe('-R$ 5,00')
  })

  it('null é "—", não "R$ 0,00"', () => {
    // null vem do interceptor de redação e significa "você não tem permissão".
    // Mostrar R$ 0,00 ali seria mentira.
    expect(formatarDinheiro(null)).toBe('—')
    expect(formatarDinheiro(undefined)).toBe('—')
  })
})

describe('formatarQuantidade', () => {
  it('corta zeros à direita', () => {
    expect(formatarQuantidade(1000n, 'ampola')).toBe('1 ampola')
    expect(formatarQuantidade(250n, 'ampola')).toBe('0,25 ampola')
    expect(formatarQuantidade(2500n, 'ampola')).toBe('2,5 ampola')
    expect(formatarQuantidade(1n, 'mg')).toBe('0,001 mg')
  })

  it('zero e null são distintos', () => {
    expect(formatarQuantidade(0n, 'ampola')).toBe('0 ampola')
    expect(formatarQuantidade(null, 'ampola')).toBe('—')
  })
})
