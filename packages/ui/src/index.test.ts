import { describe, expect, it } from 'vitest'
import { formatarDinheiro, formatarQuantidade } from './index.js'

describe('formatarDinheiro', () => {
  it('formata centavos em pt-BR', () => {
    expect(formatarDinheiro(125050n)).toBe('R$ 1.250,50')
    expect(formatarDinheiro(0n)).toBe('R$ 0,00')
    expect(formatarDinheiro(5n)).toBe('R$ 0,05')
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
