import { describe, expect, it } from 'vitest'
import { corpoComMotivo, idCurto, validarMotivoDeSuporte } from './motivo-de-suporte'

describe('validarMotivoDeSuporte', () => {
  it('recusa menos de 10 caracteres depois do trim', () => {
    expect(validarMotivoDeSuporte('   curto    ').ok).toBe(false)
    expect(validarMotivoDeSuporte('123456789').ok).toBe(false)
  })
  it('aceita 10 e 200, e devolve aparado', () => {
    expect(validarMotivoDeSuporte('  1234567890 ')).toEqual({ ok: true, motivo: '1234567890' })
    expect(validarMotivoDeSuporte('a'.repeat(200)).ok).toBe(true)
  })
  it('recusa mais de 200', () => {
    expect(validarMotivoDeSuporte('a'.repeat(201)).ok).toBe(false)
  })
})

describe('corpoComMotivo', () => {
  it('sem motivo não manda corpo', () => {
    expect(corpoComMotivo(undefined)).toEqual({})
  })
  it('com motivo manda JSON', () => {
    expect(corpoComMotivo('duplicado a pedido')).toEqual({ body: '{"motivo":"duplicado a pedido"}' })
  })
})

describe('idCurto', () => {
  it('últimos 8 caracteres', () => {
    expect(idCurto('0190a1b2-c3d4-7e5f-8a9b-0123456789ab')).toBe('456789ab')
  })
  it('nulo ou vazio vira null', () => {
    expect(idCurto(null)).toBeNull()
    expect(idCurto('')).toBeNull()
  })
})
