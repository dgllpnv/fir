import { describe, expect, it } from 'vitest'
import { instanteEmTexto } from './instante'

describe('instante em texto, no fuso da clínica', () => {
  it('hoje, com a hora de parede da clínica e não a UTC', () => {
    // 17:32 UTC é 14:32 em Salvador.
    expect(instanteEmTexto('2026-11-08T17:32:00Z', 'America/Bahia', '2026-11-08')).toBe(
      'hoje às 14:32',
    )
  })

  it('o dia é o da clínica: 01:10 UTC ainda é ontem em Salvador', () => {
    expect(instanteEmTexto('2026-11-08T01:10:00Z', 'America/Bahia', '2026-11-08')).toBe(
      'ontem às 22:10',
    )
  })

  it('outro fuso, outra hora — o fuso é propriedade da clínica', () => {
    expect(instanteEmTexto('2026-11-08T17:32:00Z', 'America/Manaus', '2026-11-08')).toBe(
      'hoje às 13:32',
    )
  })

  it('mais antigo que ontem leva a data inteira', () => {
    expect(instanteEmTexto('2026-11-02T12:00:00Z', 'America/Bahia', '2026-11-08')).toBe(
      '02/11/2026 às 09:00',
    )
  })

  it('instante ilegível não vira "Invalid Date"', () => {
    expect(instanteEmTexto('nada', 'America/Bahia', '2026-11-08')).toBeNull()
  })
})
