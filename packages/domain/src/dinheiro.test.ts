import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { Dinheiro } from './dinheiro'
import { ehErro, ehOk, exigir } from './resultado'

const texto = (s: string) => exigir(Dinheiro.deTexto(s))

describe('Dinheiro — leitura', () => {
  it('lê os formatos que a clínica digita', () => {
    expect(texto('450').centavos).toBe(45000n)
    expect(texto('450,00').centavos).toBe(45000n)
    expect(texto('1.250,50').centavos).toBe(125050n)
    expect(texto('1250.50').centavos).toBe(125050n)
    expect(texto('R$ 1.250,50').centavos).toBe(125050n)
    expect(texto('').centavos).toBe(0n)
  })

  it('recusa texto que não é valor', () => {
    expect(ehErro(Dinheiro.deTexto('abc'))).toBe(true)
    expect(ehErro(Dinheiro.deTexto('-10'))).toBe(true)
  })

  it('formata em pt-BR', () => {
    expect(Dinheiro.deCentavos(125050n).formatar()).toBe('R$ 1.250,50')
    expect(Dinheiro.zero().formatar()).toBe('R$ 0,00')
  })
})

describe('Dinheiro — rateio', () => {
  it('distribui o resto um centavo por parte, nas primeiras', () => {
    // R$ 100,00 em 7: a diferença com "tudo na primeira" é de R$ 0,03.
    const partes = texto('100,00').ratear(7)
    expect(partes.map((p) => p.centavos)).toEqual([1429n, 1429n, 1429n, 1429n, 1428n, 1428n, 1428n])
  })

  it('em 3 partes o resultado é o mesmo das duas regras — por isso 3 não serve de prova', () => {
    expect(texto('100,00').ratear(3).map((p) => p.centavos)).toEqual([3334n, 3333n, 3333n])
  })

  it('a soma das partes é exatamente o todo, para qualquer entrada', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: 10_000_000n }), fc.integer({ min: 1, max: 60 }), (c, n) => {
        const partes = Dinheiro.deCentavos(c).ratear(n)
        expect(partes.length).toBe(n)
        expect(partes.reduce((s, p) => s + p.centavos, 0n)).toBe(c)
      }),
    )
  })

  it('nenhuma parte difere de outra em mais de um centavo', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: 10_000_000n }), fc.integer({ min: 1, max: 60 }), (c, n) => {
        const vs = Dinheiro.deCentavos(c).ratear(n).map((p) => p.centavos)
        const max = vs.reduce((a, b) => (a > b ? a : b))
        const min = vs.reduce((a, b) => (a < b ? a : b))
        expect(max - min <= 1n).toBe(true)
      }),
    )
  })

  it('recusa rateio em zero ou menos partes', () => {
    expect(() => texto('10,00').ratear(0)).toThrow()
  })
})

describe('Dinheiro — aritmética', () => {
  it('soma e subtrai', () => {
    expect(texto('10,00').mais(texto('5,50')).centavos).toBe(1550n)
    expect(texto('10,00').menos(texto('15,00')).centavos).toBe(-500n)
  })

  it('a soma de uma lista independe da ordem', () => {
    fc.assert(
      fc.property(fc.array(fc.bigInt({ min: -1_000_000n, max: 1_000_000n }), { maxLength: 40 }), (cs) => {
        const soma = (xs: bigint[]) =>
          xs.map(Dinheiro.deCentavos).reduce((a, b) => a.mais(b), Dinheiro.zero()).centavos
        expect(soma(cs)).toBe(soma([...cs].reverse()))
      }),
    )
  })
})
