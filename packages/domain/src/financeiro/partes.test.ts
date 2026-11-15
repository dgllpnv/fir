import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { Dinheiro } from '../dinheiro'
import {
  formaPrincipal,
  MAX_PARTES,
  mesmasPartes,
  quantoFalta,
  somaDasPartes,
  validarPartes,
  type ParteDoPagamento,
} from './partes'

const c = (n: number | bigint): Dinheiro => Dinheiro.deCentavos(BigInt(n))
const parte = (forma: string, v: number | bigint): ParteDoPagamento => ({ forma, valor: c(v) })

const FORMAS_DA_GAVETA = ['Pix', 'Dinheiro', 'Cartão de crédito', 'Cartão de débito'] as const

/** Partes válidas e distintas por forma, de 1 a 5 (a quinta é a promissória, só sozinha — fora daqui). */
const partesValidas = fc
  .uniqueArray(fc.constantFrom(...FORMAS_DA_GAVETA), { minLength: 1, maxLength: 4 })
  .chain((formas) =>
    fc
      .array(fc.bigInt({ min: 1n, max: 10_000_000_000n }), {
        minLength: formas.length,
        maxLength: formas.length,
      })
      .map((vs) => formas.map((f, i) => parte(f, vs[i]!))),
  )

describe('validarPartes — a soma das partes é exatamente o valor', () => {
  it('uma parte só, com o valor inteiro, é válida', () => {
    const r = validarPartes(c(50000), [parte('Pix', 50000)])
    expect(r.tipo).toBe('ok')
  })

  it('Pix 300 + Dinheiro 200 = 500', () => {
    const r = validarPartes(c(50000), [parte('Pix', 30000), parte('Dinheiro', 20000)])
    expect(r.tipo).toBe('ok')
  })

  it('falta e sobra são recusadas, com o código que a tela casa', () => {
    const falta = validarPartes(c(50000), [parte('Pix', 30000), parte('Dinheiro', 19999)])
    const sobra = validarPartes(c(50000), [parte('Pix', 30000), parte('Dinheiro', 20001)])
    expect(falta.tipo === 'erro' && falta.erro.codigo).toBe('PartesNaoFecham')
    expect(sobra.tipo === 'erro' && sobra.erro.codigo).toBe('PartesNaoFecham')
  })

  it('valor zero (venda a prazo) não tem parte; valor > 0 exige pelo menos uma', () => {
    expect(validarPartes(c(0), []).tipo).toBe('ok')
    expect(validarPartes(c(0), [parte('Pix', 1)]).tipo).toBe('erro')
    const semParte = validarPartes(c(100), [])
    expect(semParte.tipo === 'erro' && semParte.erro.codigo).toBe('PartesAusentes')
  })

  it('valor negativo nunca', () => {
    expect(validarPartes(c(-1), []).tipo).toBe('erro')
  })

  it('parte zero ou negativa é recusada', () => {
    expect(validarPartes(c(100), [parte('Pix', 100), parte('Dinheiro', 0)]).tipo).toBe('erro')
    expect(validarPartes(c(100), [parte('Pix', 150), parte('Dinheiro', -50)]).tipo).toBe('erro')
  })

  it('a mesma forma duas vezes é recusada (UNIQUE recebimento+forma)', () => {
    const r = validarPartes(c(100), [parte('Pix', 40), parte('Pix', 60)])
    expect(r.tipo === 'erro' && r.erro.codigo).toBe('FormaRepetida')
  })

  it('no máximo cinco partes', () => {
    expect(MAX_PARTES).toBe(5)
    // Seis é impossível sem repetir forma, então o teto é provado direto:
    const seis = [
      parte('Pix', 1),
      parte('Dinheiro', 1),
      parte('Cartão de crédito', 1),
      parte('Cartão de débito', 1),
      parte('Nota promissória', 1),
      parte('Outra', 1),
    ]
    const r = validarPartes(c(6), seis)
    expect(r.tipo === 'erro' && r.erro.codigo).toBe('PartesDemais')
  })

  it('promissória só como parte única', () => {
    expect(validarPartes(c(100), [parte('Nota promissória', 100)]).tipo).toBe('ok')
    const mista = validarPartes(c(100), [parte('Nota promissória', 60), parte('Pix', 40)])
    expect(mista.tipo === 'erro' && mista.erro.codigo).toBe('PromissoriaMisturada')
  })

  it('forma desconhecida é recusada; forma vazia só como parte única legada', () => {
    expect(validarPartes(c(100), [parte('Boleto', 100)]).tipo).toBe('erro')
    expect(validarPartes(c(100), [parte('', 100)]).tipo).toBe('erro')
    expect(validarPartes(c(100), [parte('', 100)], { aceitaFormaVazia: true }).tipo).toBe('ok')
    expect(
      validarPartes(c(100), [parte('', 60), parte('Pix', 40)], { aceitaFormaVazia: true }).tipo,
    ).toBe('erro')
  })

  it('propriedade: partes válidas somando o valor sempre passam, em qualquer ordem', () => {
    fc.assert(
      fc.property(partesValidas, fc.integer({ min: 0, max: 1000 }), (partes, semente) => {
        const total = somaDasPartes(partes)
        // Uma rotação determinística: a ordem não muda a validade nem a soma.
        const k = semente % partes.length
        const girada = [...partes.slice(k), ...partes.slice(0, k)]
        expect(validarPartes(total, partes).tipo).toBe('ok')
        expect(validarPartes(total, girada).tipo).toBe('ok')
        expect(somaDasPartes(girada).centavos).toBe(total.centavos)
        expect(mesmasPartes(partes, girada)).toBe(true)
      }),
    )
  })

  it('propriedade: qualquer desvio de um centavo no total é recusado', () => {
    fc.assert(
      fc.property(partesValidas, fc.constantFrom(-1n, 1n), (partes, delta) => {
        const total = somaDasPartes(partes).mais(c(delta))
        if (total.centavos <= 0n) return
        const r = validarPartes(total, partes)
        expect(r.tipo).toBe('erro')
      }),
    )
  })
})

describe('quantoFalta — o "falta R$ X" do formulário', () => {
  it('positivo é falta, negativo é sobra, zero fecha', () => {
    expect(quantoFalta(c(500), [parte('Pix', 300)]).centavos).toBe(200n)
    expect(quantoFalta(c(500), [parte('Pix', 300), parte('Dinheiro', 200)]).centavos).toBe(0n)
    expect(quantoFalta(c(500), [parte('Pix', 600)]).centavos).toBe(-100n)
    expect(quantoFalta(c(500), []).centavos).toBe(500n)
  })
})

describe('formaPrincipal — a forma que o legado `recebimentos.forma` recebe', () => {
  it('a maior parte; empate, a primeira; nunca "Mista"', () => {
    expect(formaPrincipal([parte('Pix', 300), parte('Dinheiro', 200)])).toBe('Pix')
    expect(formaPrincipal([parte('Dinheiro', 200), parte('Pix', 300)])).toBe('Pix')
    expect(formaPrincipal([parte('Dinheiro', 250), parte('Pix', 250)])).toBe('Dinheiro')
    expect(formaPrincipal([parte('Pix', 250), parte('Dinheiro', 250)])).toBe('Pix')
    expect(formaPrincipal([])).toBe('')
  })

  it('propriedade: é sempre a forma de alguma das partes e nunca é "Mista"', () => {
    fc.assert(
      fc.property(partesValidas, (partes) => {
        const f = formaPrincipal(partes)
        expect(partes.map((p) => p.forma)).toContain(f)
        expect(f).not.toBe('Mista')
      }),
    )
  })
})

describe('mesmasPartes — o reenvio com a mesma requisição', () => {
  it('ignora a ordem, compara forma e valor', () => {
    expect(
      mesmasPartes([parte('Pix', 1), parte('Dinheiro', 2)], [parte('Dinheiro', 2), parte('Pix', 1)]),
    ).toBe(true)
    expect(mesmasPartes([parte('Pix', 1)], [parte('Pix', 2)])).toBe(false)
    expect(mesmasPartes([parte('Pix', 1)], [parte('Dinheiro', 1)])).toBe(false)
    expect(mesmasPartes([parte('Pix', 1)], [parte('Pix', 1), parte('Dinheiro', 1)])).toBe(false)
  })
})
