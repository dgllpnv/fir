import { describe, expect, it } from 'vitest'
import { linhasDoParcial, textoDeRetomar } from './jornada-parciais'

describe('coluna de parciais', () => {
  it('retomar com data, atrasado e sem data', () => {
    expect(textoDeRetomar('2026-11-20', '2026-11-13')).toBe('retomar 20/11')
    expect(textoDeRetomar('2026-11-01', '2026-11-13')).toBe('retomar 01/11 (atrasado)')
    expect(textoDeRetomar(null, '2026-11-13')).toBe('')
  })
  it('fechou X de Y ou sem detalhamento', () => {
    expect(linhasDoParcial({ itensFechados: 2, itensTotal: 3, proximoPassoEm: null }, '2026-11-13').fechou).toBe(
      'fechou 2 de 3 procedimentos',
    )
    expect(linhasDoParcial({ itensFechados: null, itensTotal: null, proximoPassoEm: null }, '2026-11-13').fechou).toBe(
      'sem detalhamento',
    )
  })
})
