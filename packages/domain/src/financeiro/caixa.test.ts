import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { Dinheiro } from '../dinheiro'
import {
  conferirCaixa,
  esperadoDoCaixa,
  FORA_DA_CONFERENCIA,
  FORMAS_DE_CONFERENCIA,
  type Forma,
} from './caixa'

const c = (n: number) => Dinheiro.deCentavos(BigInt(n))

describe('esperadoDoCaixa', () => {
  it('o esperado soma por forma, e ignora a nota promissória', () => {
    const e = esperadoDoCaixa([
      { forma: 'Pix', valor: c(45000) },
      { forma: 'Pix', valor: c(12000) },
      { forma: 'Dinheiro', valor: c(5000) },
      { forma: 'Nota promissória', valor: c(999999) },
    ])
    expect(e.get('Pix')!.centavos).toBe(57000n)
    expect(e.get('Dinheiro')!.centavos).toBe(5000n)
    expect([...e.keys()]).not.toContain('Nota promissória')
  })

  it('uma forma que ninguém declarou LANÇA — somar o que não se declarou é como o dinheiro some', () => {
    expect(() => esperadoDoCaixa([{ forma: 'Bitcoin', valor: c(1) }])).toThrow(/Bitcoin/)
  })

  it('sem recebimento nenhum, o esperado é um mapa vazio — não um mapa de zeros', () => {
    // Quem completa com zero é `conferirCaixa`, que conhece as quatro formas.
    expect(esperadoDoCaixa([]).size).toBe(0)
  })
})

describe('conferirCaixa', () => {
  it('a conferência tem as QUATRO formas, mesmo as que ninguém usou', () => {
    // A gaveta com zero em dinheiro é uma informação; uma linha ausente não é.
    const r = conferirCaixa(esperadoDoCaixa([]), new Map([['Pix', c(0)]]))
    expect(r.linhas.map((l) => l.forma)).toEqual([
      'Pix',
      'Dinheiro',
      'Cartão de crédito',
      'Cartão de débito',
    ])
  })

  it('falta de R$ 50 no dinheiro: diferença negativa, por forma e no total', () => {
    const r = conferirCaixa(
      esperadoDoCaixa([
        { forma: 'Dinheiro', valor: c(15000) },
        { forma: 'Pix', valor: c(45000) },
      ]),
      new Map([
        ['Dinheiro', c(10000)],
        ['Pix', c(45000)],
      ]),
    )
    expect(r.linhas.find((l) => l.forma === 'Dinheiro')!.diferenca.centavos).toBe(-5000n)
    expect(r.linhas.find((l) => l.forma === 'Pix')!.diferenca.ehZero()).toBe(true)
    expect(r.diferenca.centavos).toBe(-5000n)
    expect(r.conferido).toBe(false)
  })

  it('sobra e falta em formas diferentes NÃO se cancelam na leitura por forma', () => {
    // O total zera; as linhas não. É o total que engana, e por isso a tela
    // mostra as quatro linhas antes do total.
    const r = conferirCaixa(
      esperadoDoCaixa([
        { forma: 'Pix', valor: c(10000) },
        { forma: 'Dinheiro', valor: c(10000) },
      ]),
      new Map([
        ['Pix', c(5000)],
        ['Dinheiro', c(15000)],
      ]),
    )
    expect(r.diferenca.ehZero()).toBe(true)
    expect(r.conferido).toBe(false) // conferido NÃO é "total zero"
  })

  it('uma forma que o contado não trouxe conta como zero contado, não como ausente', () => {
    const r = conferirCaixa(esperadoDoCaixa([{ forma: 'Dinheiro', valor: c(15000) }]), new Map())
    const linha = r.linhas.find((l) => l.forma === 'Dinheiro')!
    expect(linha.contado.ehZero()).toBe(true)
    expect(linha.diferenca.centavos).toBe(-15000n)
    expect(r.linhas).toHaveLength(4)
  })

  it('caixa certinho é `conferido`, com diferença zero nas quatro linhas', () => {
    const r = conferirCaixa(
      esperadoDoCaixa([
        { forma: 'Pix', valor: c(45000) },
        { forma: 'Cartão de crédito', valor: c(30000) },
      ]),
      new Map([
        ['Pix', c(45000)],
        ['Cartão de crédito', c(30000)],
      ]),
    )
    expect(r.conferido).toBe(true)
    expect(r.diferenca.ehZero()).toBe(true)
  })

  it('promissória no contado é recusada — ela não está na gaveta', () => {
    expect(() => conferirCaixa(new Map(), new Map([['Nota promissória' as never, c(1)]]))).toThrow(
      /promiss/i,
    )
  })

  it('forma inventada no contado é recusada, em vez de somada em silêncio', () => {
    expect(() => conferirCaixa(new Map(), new Map([['Pix ' as never, c(1)]]))).toThrow()
  })
})

const dinheiro = fc.bigInt({ min: 0n, max: 10_000_000n }).map((n) => Dinheiro.deCentavos(n))
const recebimento = fc.record({
  forma: fc.constantFrom<string>(...FORMAS_DE_CONFERENCIA, FORA_DA_CONFERENCIA),
  valor: dinheiro,
})
const contadoArb = fc.dictionary(fc.constantFrom(...FORMAS_DE_CONFERENCIA), dinheiro)
const comoMapa = (d: Record<string, Dinheiro>) => new Map(Object.entries(d)) as Map<Forma, Dinheiro>

describe('conferirCaixa — propriedades', () => {
  it('a diferença total é exatamente a soma das diferenças por forma', () => {
    fc.assert(
      fc.property(fc.array(recebimento, { maxLength: 40 }), contadoArb, (recs, contado) => {
        const r = conferirCaixa(esperadoDoCaixa(recs), comoMapa(contado))
        const soma = r.linhas.reduce((s, l) => s.mais(l.diferenca), Dinheiro.zero())
        expect(soma.centavos).toBe(r.diferenca.centavos)
      }),
    )
  })

  it('`conferido` é verdadeiro se e somente se TODA linha tem diferença zero', () => {
    fc.assert(
      fc.property(fc.array(recebimento, { maxLength: 40 }), contadoArb, (recs, contado) => {
        const r = conferirCaixa(esperadoDoCaixa(recs), comoMapa(contado))
        expect(r.conferido).toBe(r.linhas.every((l) => l.diferenca.ehZero()))
      }),
    )
  })

  it('dois erros que se cancelam no total NUNCA dão `conferido`', () => {
    // A propriedade acima (`sse toda linha zera`) NÃO pega `conferido =
    // diferenca.ehZero()`: medido — com `contado` sorteado ao acaso, a chance
    // de duas formas errarem por valores exatamente opostos é desprezível, e
    // a mutação passou verde por ela. Esta CONSTRÓI o caso, em vez de esperar
    // o sorteio: é a clínica com dois erros achando que não tem nenhum.
    fc.assert(
      fc.property(fc.bigInt({ min: 1n, max: 1_000_000n }), dinheiro, dinheiro, (delta, pix, din) => {
        const d = Dinheiro.deCentavos(delta)
        const r = conferirCaixa(
          esperadoDoCaixa([
            { forma: 'Pix', valor: pix },
            { forma: 'Dinheiro', valor: din },
          ]),
          new Map<Forma, Dinheiro>([
            ['Pix', pix.mais(d)],
            ['Dinheiro', din.menos(d)],
          ]),
        )
        expect(r.diferenca.ehZero()).toBe(true)
        expect(r.conferido).toBe(false)
      }),
    )
  })

  it('a nota promissória não muda NADA na conferência', () => {
    fc.assert(
      fc.property(
        fc.array(recebimento, { maxLength: 40 }),
        contadoArb,
        dinheiro,
        (recs, contado, promissoria) => {
          const sem = conferirCaixa(
            esperadoDoCaixa(recs.filter((x) => x.forma !== FORA_DA_CONFERENCIA)),
            comoMapa(contado),
          )
          const com = conferirCaixa(
            esperadoDoCaixa([...recs, { forma: FORA_DA_CONFERENCIA, valor: promissoria }]),
            comoMapa(contado),
          )
          expect(com.diferenca.centavos).toBe(sem.diferenca.centavos)
          expect(com.conferido).toBe(sem.conferido)
        },
      ),
    )
  })

  it('as quatro linhas saem sempre, na mesma ordem, aconteça o que acontecer', () => {
    fc.assert(
      fc.property(fc.array(recebimento, { maxLength: 40 }), contadoArb, (recs, contado) => {
        const r = conferirCaixa(esperadoDoCaixa(recs), comoMapa(contado))
        expect(r.linhas.map((l) => l.forma)).toEqual([...FORMAS_DE_CONFERENCIA])
      }),
    )
  })

  it('o esperado por forma independe da ordem dos recebimentos', () => {
    fc.assert(
      fc.property(fc.array(recebimento, { maxLength: 40 }), (recs) => {
        const a = esperadoDoCaixa(recs)
        const b = esperadoDoCaixa([...recs].reverse())
        for (const f of FORMAS_DE_CONFERENCIA) {
          expect(b.get(f)?.centavos ?? 0n).toBe(a.get(f)?.centavos ?? 0n)
        }
      }),
    )
  })
})
