import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { inteiroDoAmbiente } from './ambiente'

const VAR = 'FIR_TESTE_INTEIRO_DO_AMBIENTE'

describe('inteiroDoAmbiente', () => {
  beforeEach(() => {
    delete process.env[VAR]
  })

  afterEach(() => {
    delete process.env[VAR]
  })

  it('ausente usa o padrão', () => {
    expect(inteiroDoAmbiente(VAR, 42)).toBe(42)
  })

  it('inteiro válido vence o padrão', () => {
    process.env[VAR] = '7'
    expect(inteiroDoAmbiente(VAR, 42)).toBe(7)
  })

  it('aceita negativo quando não há mínimo', () => {
    process.env[VAR] = '-3'
    expect(inteiroDoAmbiente(VAR, 0)).toBe(-3)
  })

  /**
   * Achado 2 da re-revisão: `Number('100ms')` é `NaN`, e `falta > 0` com
   * `NaN` é `false` — o piso de tempo desligava em silêncio. Aqui a mesma
   * entrada tem de IMPEDIR a subida, não silenciar o controle.
   */
  it('rejeita sufixo de unidade ("100ms") — o caso que desligava o piso em silêncio', () => {
    process.env[VAR] = '100ms'
    expect(() => inteiroDoAmbiente(VAR, 100)).toThrow(/FIR_TESTE_INTEIRO_DO_AMBIENTE/)
  })

  /**
   * Achado 2: `Number('auto')` é `NaN`, e `NaN < 1` é `false` — o `RangeError`
   * do construtor do `Semaforo` nunca dispara, e o teto de concorrência
   * desaparece (`disponiveis = NaN`, `NaN > 0` é `false`: fila sem fim).
   */
  it('rejeita não-numérico ("auto") — o caso que apagava o teto de concorrência', () => {
    process.env[VAR] = 'auto'
    expect(() => inteiroDoAmbiente(VAR, 4, { min: 1 })).toThrow(/FIR_TESTE_INTEIRO_DO_AMBIENTE/)
  })

  it('rejeita não-numérico ("sixty") — o caso que travava todo login em 429', () => {
    process.env[VAR] = 'sixty'
    expect(() => inteiroDoAmbiente(VAR, 60, { min: 1 })).toThrow()
  })

  it('rejeita fracionário', () => {
    process.env[VAR] = '4.5'
    expect(() => inteiroDoAmbiente(VAR, 4)).toThrow()
  })

  it('rejeita vazio — "configurei errado" não pode valer como "não configurei"', () => {
    process.env[VAR] = ''
    expect(() => inteiroDoAmbiente(VAR, 4)).toThrow()
  })

  it('rejeita espaço, vírgula e notação científica', () => {
    for (const valor of [' 4', '4 ', '4,5', '1e3']) {
      process.env[VAR] = valor
      expect(() => inteiroDoAmbiente(VAR, 4), `valor "${valor}" deveria ter sido recusado`).toThrow()
    }
  })

  it('abaixo do mínimo declarado lança', () => {
    process.env[VAR] = '0'
    expect(() => inteiroDoAmbiente(VAR, 4, { min: 1 })).toThrow(/mínimo 1/)
  })

  it('no mínimo declarado passa', () => {
    process.env[VAR] = '0'
    expect(inteiroDoAmbiente(VAR, 4, { min: 0 })).toBe(0)
  })

  it('acima do máximo declarado lança', () => {
    process.env[VAR] = '70000'
    expect(() => inteiroDoAmbiente(VAR, 100, { max: 65_535 })).toThrow(/máximo 65535/)
  })

  it('no máximo declarado passa', () => {
    process.env[VAR] = '65535'
    expect(inteiroDoAmbiente(VAR, 100, { max: 65_535 })).toBe(65_535)
  })
})
