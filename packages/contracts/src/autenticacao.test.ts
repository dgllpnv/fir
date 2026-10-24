import { describe, expect, it } from 'vitest'
import { dinheiroEmTexto, EntrarEntrada } from './index'

describe('EntrarEntrada', () => {
  it('aceita clínica, e-mail e senha válidos, normalizando os dois primeiros', () => {
    const r = EntrarEntrada.parse({
      clinica: '  Demo ',
      email: '  Demo@Firmare.Local ',
      senha: 'firmare-demonstracao',
    })
    expect(r.clinica).toBe('demo')
    expect(r.email).toBe('demo@firmare.local')
  })

  it('recusa e-mail inválido, senha curta e clínica vazia', () => {
    const base = { clinica: 'demo', email: 'a@b.local', senha: 'firmare-x' }
    expect(EntrarEntrada.safeParse({ ...base, email: 'nao-e-email' }).success).toBe(false)
    expect(EntrarEntrada.safeParse({ ...base, senha: 'curta' }).success).toBe(false)
    expect(EntrarEntrada.safeParse({ ...base, clinica: '   ' }).success).toBe(false)
  })
})

describe('dinheiroEmTexto', () => {
  it('serializa centavos como string, para o JSON não perder precisão', () => {
    // JSON.stringify(10n) lança; Number(centavos) perde precisão acima de 2^53.
    // O contrato trafega string e o cliente nunca faz aritmética com ela.
    expect(dinheiroEmTexto.parse('125050')).toBe(125050n)
    expect(dinheiroEmTexto.parse(null)).toBe(null)
  })

  it('recusa texto que não é inteiro', () => {
    expect(dinheiroEmTexto.safeParse('1250.50').success).toBe(false)
  })
})
