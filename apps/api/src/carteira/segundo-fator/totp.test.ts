import { passoDoInstante } from '@fir/domain'
import { describe, expect, it } from 'vitest'
import { hotp, verificarTotp } from './totp'

const SEMENTE = Buffer.from('12345678901234567890', 'ascii')

describe('HOTP — RFC 4226, apêndice D (6 dígitos)', () => {
  const esperados = ['755224', '287082', '359152', '969429', '338314', '254676', '287922', '162583', '399871', '520489']
  esperados.forEach((codigo, contador) => {
    it(`contador ${contador} → ${codigo}`, () => {
      expect(hotp(SEMENTE, contador)).toBe(codigo)
    })
  })
})

describe('TOTP — RFC 6238, apêndice B (SHA-1, 8 dígitos)', () => {
  const vetores: Array<[number, string]> = [
    [59, '94287082'],
    [1_111_111_109, '07081804'],
    [1_111_111_111, '14050471'],
    [1_234_567_890, '89005924'],
    [2_000_000_000, '69279037'],
    [20_000_000_000, '65353130'],
  ]
  for (const [t, codigo] of vetores) {
    it(`T = ${t} s → ${codigo}`, () => {
      expect(hotp(SEMENTE, passoDoInstante(new Date(t * 1000)), 8)).toBe(codigo)
    })
  }
})

describe('verificarTotp — devolve o PASSO que casou, ou null', () => {
  const passo = passoDoInstante(new Date(1_111_111_109_000))

  it('aceita o código de qualquer passo da lista e diz qual', () => {
    expect(verificarTotp(SEMENTE, hotp(SEMENTE, passo), [passo, passo - 1, passo + 1])).toBe(passo)
    expect(verificarTotp(SEMENTE, hotp(SEMENTE, passo + 1), [passo, passo - 1, passo + 1])).toBe(passo + 1)
  })

  it('recusa o código de um passo que não está na lista (replay ou fora da janela)', () => {
    expect(verificarTotp(SEMENTE, hotp(SEMENTE, passo), [passo + 1])).toBeNull()
    expect(verificarTotp(SEMENTE, hotp(SEMENTE, passo + 2), [passo, passo - 1, passo + 1])).toBeNull()
    expect(verificarTotp(SEMENTE, hotp(SEMENTE, passo), [])).toBeNull()
  })

  it('recusa código de outro segredo e entrada que não é código', () => {
    const outro = Buffer.from('abcdefghijabcdefghij', 'ascii')
    expect(verificarTotp(outro, hotp(SEMENTE, passo), [passo])).toBeNull()
    expect(verificarTotp(SEMENTE, '12345', [passo])).toBeNull()
  })
})
