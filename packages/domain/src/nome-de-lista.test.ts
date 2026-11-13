import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { centavosDoTextoBrasileiro, limparNomeDeLista } from './nome-de-lista'

describe('limparNomeDeLista — o caso da planilha da cliente', () => {
  it.each([
    ['6. Maria Souza - R$ 15.200', 'Maria Souza', 1520000n],
    ['12) Marta Alves – R$ 8.000,50', 'Marta Alves', 800050n],
    ['Rosa Lima (Faturado: R$ 3.100)', 'Rosa Lima', 310000n],
    ['3 - Ana Paula Souza', 'Ana Paula Souza', null],
    ['Maria José', 'Maria José', null],
    ['  Joana   D\'Arc  ', "Joana D'Arc", null],
    ['7. Beatriz Faturado: R$ 950', 'Beatriz', 95000n],
  ])('%s', (bruto, nome, valor) => {
    expect(limparNomeDeLista(bruto)).toEqual({ nome, valorEmCentavos: valor })
  })

  it('número que faz parte do nome fica (sem separador de índice)', () => {
    expect(limparNomeDeLista('3 Marias').nome).toBe('3 Marias')
  })

  it('é idempotente: limpar o já limpo não muda nada', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 60 }), (s) => {
        const a = limparNomeDeLista(s).nome
        expect(limparNomeDeLista(a).nome).toBe(a)
      }),
    )
  })

  it('o valor é lido em centavos exatos, sem float', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 99_999_999 }), fc.integer({ min: 0, max: 99 }), (r, c) => {
        const milhar = String(r).replace(/\B(?=(\d{3})+(?!\d))/g, '.')
        const t = `${milhar},${String(c).padStart(2, '0')}`
        expect(centavosDoTextoBrasileiro(t)).toBe(BigInt(r) * 100n + BigInt(c))
      }),
    )
  })

  it('texto que não é valor é null', () => {
    expect(centavosDoTextoBrasileiro('abc')).toBeNull()
    expect(centavosDoTextoBrasileiro('')).toBeNull()
  })
})

describe('centavosDoTextoBrasileiro — ambíguo vira decimal, malformado vira null', () => {
  it.each([
    ['1.5', 150n],
    ['15.20', 1520n],
    ['450.00', 45000n],
    ['1.500', 150000n],
    ['1.234,56', 123456n],
    ['12.345.678', 1234567800n],
  ])('%s', (texto, esperado) => {
    expect(centavosDoTextoBrasileiro(texto)).toBe(esperado)
  })

  it.each(['1..5', '15.', '.5', '1.2.3', '1.23.456', '1,234', ',5', '1.5,5', '12.3456', '1.234.56', '-5', 'R$ 5'])(
    'malformado: %s => null',
    (texto) => {
      expect(centavosDoTextoBrasileiro(texto)).toBeNull()
    },
  )

  it('PROPRIEDADE: inteiro.d ou inteiro.dd (ponto + 1-2 dígitos) é SEMPRE decimal, nunca milhar', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 999_999 }),
        fc.integer({ min: 0, max: 99 }),
        fc.boolean(),
        (r, c, doisDigitos) => {
          const frac = doisDigitos ? String(c).padStart(2, '0') : String(c % 10)
          const esperado = BigInt(r) * 100n + BigInt(frac.padEnd(2, '0'))
          expect(centavosDoTextoBrasileiro(`${r}.${frac}`)).toBe(esperado)
        },
      ),
    )
  })

  it('PROPRIEDADE: ponto só entre dígitos em grupos de 3 é milhar; qualquer outro agrupamento é null', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 999 }), fc.array(fc.integer({ min: 4, max: 9 }), { minLength: 1, maxLength: 3 }), (cab, tam) => {
        const t = [String(cab), ...tam.map((n) => '1'.repeat(n))].join('.')
        expect(centavosDoTextoBrasileiro(t)).toBeNull()
      }),
    )
  })

  it('PROPRIEDADE: texto com caractere fora de dígito, ponto e vírgula nunca vira valor', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 12 }), (t) => {
        if (/[^\d.,\s]/.test(t)) expect(centavosDoTextoBrasileiro(t)).toBeNull()
      }),
    )
  })
})
