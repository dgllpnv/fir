import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { somarDias } from '../relogio'
import { diaEMesDoAniversario, idadeEm } from './aniversario'

const dia = fc
  .date({ min: new Date('1920-01-01T00:00:00Z'), max: new Date('2030-12-31T00:00:00Z'), noInvalidDate: true })
  .map((d) => d.toISOString().slice(0, 10))

describe('aniversário (relatório 7)', () => {
  it('dia e mês, nunca o ano', () => {
    expect(diaEMesDoAniversario('1990-10-24')).toBe('24/10')
  })

  it('a idade sobe no dia do aniversário, não antes', () => {
    expect(idadeEm('1990-10-24', '2026-10-23')).toBe(35)
    expect(idadeEm('1990-10-24', '2026-10-24')).toBe(36)
    expect(idadeEm('2000-02-29', '2026-02-28')).toBe(25)
    expect(idadeEm('2000-02-29', '2026-03-01')).toBe(26)
    expect(idadeEm('2026-10-25', '2026-10-24')).toBeNull()
  })

  it('property: a idade nunca diminui com o tempo e sobe no máximo 1 por dia', () => {
    fc.assert(
      fc.property(dia, dia, (nascimento, hoje) => {
        fc.pre(nascimento <= hoje)
        const a = idadeEm(nascimento, hoje)!
        const b = idadeEm(nascimento, somarDias(hoje, 1))!
        expect(a).toBeGreaterThanOrEqual(0)
        expect(b - a === 0 || b - a === 1).toBe(true)
      }),
    )
  })
})
