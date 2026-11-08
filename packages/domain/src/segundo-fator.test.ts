import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  BYTES_SEGREDO_TOTP,
  codificarBase32,
  decodificarBase32,
  esperaDoSegundoFator,
  formatarCodigoDeRecuperacao,
  normalizarCodigoDeRecuperacao,
  normalizarCodigoTotp,
  passoDoInstante,
  passosAceitaveis,
  uriOtpauth,
} from './segundo-fator'

describe('passo do TOTP (RFC 6238, T0 = 0, X = 30 s)', () => {
  it('é o piso de segundos ÷ 30', () => {
    expect(passoDoInstante(new Date(59_000))).toBe(1)
    expect(passoDoInstante(new Date(60_000))).toBe(2)
    expect(passoDoInstante(new Date(1_111_111_109_000))).toBe(37_037_036)
  })
})

describe('passosAceitaveis — janela de ±1 passo e anti-replay', () => {
  it('sem passo aceito antes: os três da janela, o atual primeiro', () => {
    expect(passosAceitaveis(100, null)).toEqual([100, 99, 101])
  })

  it('recusa todo passo ≤ ao último aceito — o mesmo código não entra duas vezes', () => {
    expect(passosAceitaveis(100, 100)).toEqual([101])
    expect(passosAceitaveis(100, 99)).toEqual([100, 101])
    expect(passosAceitaveis(100, 101)).toEqual([])
  })

  it('nunca devolve passo fora de [atual − 1, atual + 1] nem ≤ último aceito', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 2 ** 40 }),
        fc.option(fc.integer({ min: 0, max: 2 ** 40 }), { nil: null }),
        (atual, ultimo) => {
          for (const p of passosAceitaveis(atual, ultimo)) {
            expect(Math.abs(p - atual)).toBeLessThanOrEqual(1)
            if (ultimo !== null) expect(p).toBeGreaterThan(ultimo)
          }
        },
      ),
    )
  })
})

describe('base32 (RFC 4648, sem padding)', () => {
  it('codifica o vetor da RFC 4648', () => {
    expect(codificarBase32(new TextEncoder().encode('foobar'))).toBe('MZXW6YTBOI')
    expect(codificarBase32(new TextEncoder().encode('12345678901234567890'))).toBe(
      'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',
    )
  })

  it('ida e volta é identidade, e 20 bytes viram 32 caracteres', () => {
    fc.assert(
      fc.property(fc.uint8Array({ minLength: 0, maxLength: 64 }), (bytes) => {
        expect(decodificarBase32(codificarBase32(bytes))).toEqual(bytes)
      }),
    )
    expect(codificarBase32(new Uint8Array(BYTES_SEGREDO_TOTP))).toHaveLength(32)
  })

  it('aceita minúscula e espaço, recusa caractere fora do alfabeto', () => {
    expect(decodificarBase32('mzxw 6ytb oi')).toEqual(new TextEncoder().encode('foobar'))
    expect(decodificarBase32('MZXW1')).toBeNull()
  })
})

describe('códigos digitados', () => {
  it('TOTP: seis dígitos, espaço tolerado, nada mais', () => {
    expect(normalizarCodigoTotp(' 123 456 ')).toBe('123456')
    expect(normalizarCodigoTotp('12345')).toBeNull()
    expect(normalizarCodigoTotp('1234567')).toBeNull()
    expect(normalizarCodigoTotp('12345a')).toBeNull()
  })

  it('recuperação: 12 caracteres base32, hífen/espaço/caixa tolerados, formata em 3 grupos', () => {
    expect(normalizarCodigoDeRecuperacao('abcd-efgh-2345')).toBe('ABCDEFGH2345')
    expect(normalizarCodigoDeRecuperacao('ABCD EFGH 2345')).toBe('ABCDEFGH2345')
    expect(normalizarCodigoDeRecuperacao('ABCD-EFGH-234')).toBeNull()
    expect(normalizarCodigoDeRecuperacao('ABCD-EFGH-2341')).toBeNull()
    expect(formatarCodigoDeRecuperacao('ABCDEFGH2345')).toBe('ABCD-EFGH-2345')
  })
})

describe('uriOtpauth', () => {
  it('monta a URI do Key Uri Format, com emissor e conta codificados', () => {
    const uri = uriOtpauth({
      emissor: 'Firmare Carteira',
      conta: 'ana.souza',
      segredo: new TextEncoder().encode('12345678901234567890'),
    })
    expect(uri).toBe(
      'otpauth://totp/Firmare%20Carteira:ana.souza?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ' +
        '&issuer=Firmare%20Carteira&algorithm=SHA1&digits=6&period=30',
    )
  })
})

describe('esperaDoSegundoFator — o limite é POR CONTA, atravessando desafios', () => {
  const agora = new Date('2026-11-08T12:00:00Z')
  const falhasAte = (n: number, ultimaHaMs = 0) =>
    Array.from({ length: n }, (_, i) => ({
      em: new Date(agora.getTime() - ultimaHaMs - (n - 1 - i) * 1000),
      sucesso: false,
    }))

  it('quatro falhas: nenhuma espera', () => {
    expect(esperaDoSegundoFator(falhasAte(4), agora)).toBe(0)
  })

  it('a partir da quinta, a espera dobra a cada falha (1, 2, 4 min…)', () => {
    expect(esperaDoSegundoFator(falhasAte(5), agora)).toBe(60_000)
    expect(esperaDoSegundoFator(falhasAte(6), agora)).toBe(120_000)
    expect(esperaDoSegundoFator(falhasAte(7), agora)).toBe(240_000)
  })

  it('a espera corre a partir da ÚLTIMA falha', () => {
    expect(esperaDoSegundoFator(falhasAte(5, 45_000), agora)).toBe(15_000)
    expect(esperaDoSegundoFator(falhasAte(5, 61_000), agora)).toBe(0)
  })

  it('um sucesso zera; falha com mais de 24 h não conta', () => {
    const lista = [...falhasAte(9, 10_000), { em: new Date(agora.getTime() - 5_000), sucesso: true }]
    expect(esperaDoSegundoFator(lista, agora)).toBe(0)
    expect(esperaDoSegundoFator(falhasAte(9, 24 * 60 * 60 * 1000 + 1), agora)).toBe(0)
  })

  it('nunca passa de 24 h, e é monótona no número de falhas', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 200 }), (n) => {
        const a = esperaDoSegundoFator(falhasAte(n), agora)
        const b = esperaDoSegundoFator(falhasAte(n + 1), agora)
        expect(a).toBeLessThanOrEqual(24 * 60 * 60 * 1000)
        expect(b).toBeGreaterThanOrEqual(a)
      }),
    )
  })
})
