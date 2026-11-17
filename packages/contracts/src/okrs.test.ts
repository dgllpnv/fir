import { describe, expect, it } from 'vitest'
import { CriarOkr, DuplicarOkr, EditarOkr } from './okrs'

const KPI = '11111111-1111-4111-8111-111111111111'

describe('contratos dos OKRs (spec E.2; appsec C6)', () => {
  it('de 1 a 5 KRs; objetivo até 160; chave extra é recusada', () => {
    const kr = { kpiId: KPI, alvo: '100' }
    expect(CriarOkr.safeParse({ objetivo: 'O', resultadosChave: [kr] }).success).toBe(true)
    expect(CriarOkr.safeParse({ objetivo: 'O', resultadosChave: [] }).success).toBe(false)
    expect(CriarOkr.safeParse({ objetivo: 'O', resultadosChave: Array(6).fill(kr) }).success).toBe(false)
    expect(CriarOkr.safeParse({ objetivo: 'x'.repeat(161), resultadosChave: [kr] }).success).toBe(false)
    expect(CriarOkr.safeParse({ objetivo: 'O', resultadosChave: [kr], clinicaId: KPI }).success).toBe(false)
    expect(CriarOkr.safeParse({ objetivo: 'O', resultadosChave: [{ ...kr, valor: '1' }] }).success).toBe(false)
    expect(EditarOkr.safeParse({ porque: 'p'.repeat(501) }).success).toBe(false)
    expect(DuplicarOkr.safeParse({ partida: '0' }).success).toBe(false)
  })

  it('o período: trimestre (início opcional) ou datas, nada além', () => {
    const base = { objetivo: 'O', resultadosChave: [{ kpiId: KPI, alvo: '1' }] }
    expect(CriarOkr.safeParse({ ...base, periodo: { tipo: 'trimestre' } }).success).toBe(true)
    expect(CriarOkr.safeParse({ ...base, periodo: { tipo: 'datas', inicio: '2026-10-01' } }).success).toBe(false)
    expect(CriarOkr.safeParse({ ...base, periodo: { tipo: 'semestre', inicio: '2026-10-01' } }).success).toBe(false)
  })
})
