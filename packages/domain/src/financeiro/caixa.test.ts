import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { Dinheiro } from '../dinheiro'
import {
  alteracoesDepoisDoFechamento,
  avisosDoRecebimento,
  conferirCaixa,
  esperadoDoCaixa,
  FORA_DA_CONFERENCIA,
  FORMAS_DE_CONFERENCIA,
  type Forma,
  mudouDepoisDoFechamento,
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

describe('alteracoesDepoisDoFechamento', () => {
  const formaArb = fc.constantFrom(...FORMAS_DE_CONFERENCIA)
  const mapaArb = fc
    .array(fc.tuple(formaArb, fc.bigInt({ min: 0n, max: 10n ** 12n })), { maxLength: 8 })
    .map((pares) => {
      const m = new Map<Forma, Dinheiro>()
      for (const [f, v] of pares) m.set(f, (m.get(f) ?? Dinheiro.zero()).mais(Dinheiro.deCentavos(v)))
      return m as ReadonlyMap<Forma, Dinheiro>
    })
  const soma = (xs: Iterable<Dinheiro>) => [...xs].reduce((s, x) => s.mais(x), Dinheiro.zero())

  it('números à mão: fechou Pix 100,00; entrou 50,00 em Pix depois → Pix +50,00, demais 0', () => {
    const r = alteracoesDepoisDoFechamento(new Map([['Pix', c(10000)]]), new Map([['Pix', c(15000)]]))
    expect(r.map((l) => [l.forma, l.valor.centavos])).toEqual([
      ['Pix', 5000n],
      ['Dinheiro', 0n],
      ['Cartão de crédito', 0n],
      ['Cartão de débito', 0n],
    ])
  })

  it('estorno depois do fechamento sai NEGATIVO', () => {
    const r = alteracoesDepoisDoFechamento(new Map([['Dinheiro', c(10000)]]), new Map())
    expect(r.find((l) => l.forma === 'Dinheiro')!.valor.centavos).toBe(-10000n)
  })

  it('PROPRIEDADE: Σ alterações = Σ vivo − Σ guardado, e cada linha é vivo − guardado da forma', () => {
    fc.assert(
      fc.property(mapaArb, mapaArb, (guardado, vivo) => {
        const r = alteracoesDepoisDoFechamento(guardado, vivo)
        expect(r.map((l) => l.forma)).toEqual([...FORMAS_DE_CONFERENCIA])
        expect(soma(r.map((l) => l.valor)).centavos).toBe(
          soma(vivo.values()).menos(soma(guardado.values())).centavos,
        )
        for (const l of r) {
          const v = vivo.get(l.forma) ?? Dinheiro.zero()
          const g = guardado.get(l.forma) ?? Dinheiro.zero()
          expect(l.valor.centavos).toBe(v.menos(g).centavos)
        }
      }),
    )
  })

  it('PROPRIEDADE: sem mudança posterior (vivo = guardado), toda alteração é zero e nada acende', () => {
    fc.assert(
      fc.property(mapaArb, (m) => {
        const r = alteracoesDepoisDoFechamento(m, m)
        expect(r.every((l) => l.valor.ehZero())).toBe(true)
        expect(mudouDepoisDoFechamento(r, false)).toBe(false)
      }),
    )
  })

  it('a marca acende com evento posterior mesmo quando a diferença se anula', () => {
    const r = alteracoesDepoisDoFechamento(new Map([['Pix', c(10000)]]), new Map([['Pix', c(10000)]]))
    expect(mudouDepoisDoFechamento(r, true)).toBe(true)
  })

  it('a promissória no guardado é defeito — ela não está na gaveta', () => {
    expect(() =>
      alteracoesDepoisDoFechamento(new Map([['Nota promissória' as Forma, c(1)]]), new Map()),
    ).toThrow(/promissória/)
  })
})

describe('avisosDoRecebimento', () => {
  const base = {
    forma: 'Pix',
    valor: c(10000),
    caixaFechado: false,
    haRecebimentoIgual: false,
    confirmarCaixaFechado: false,
    confirmarDuplicidade: false,
  }

  it('nada a avisar → lista vazia', () => {
    expect(avisosDoRecebimento(base)).toEqual([])
  })

  it('caixa fechado avisa; confirmado, não', () => {
    expect(avisosDoRecebimento({ ...base, caixaFechado: true })).toEqual(['CAIXA_FECHADO'])
    expect(avisosDoRecebimento({ ...base, caixaFechado: true, confirmarCaixaFechado: true })).toEqual([])
  })

  it('caixa fechado NÃO se aplica a nota promissória nem a valor zero (fora da gaveta)', () => {
    expect(avisosDoRecebimento({ ...base, caixaFechado: true, forma: FORA_DA_CONFERENCIA })).toEqual([])
    expect(avisosDoRecebimento({ ...base, caixaFechado: true, valor: c(0), forma: '' })).toEqual([])
  })

  it('duplicidade avisa em qualquer forma, promissória inclusive; confirmada, não', () => {
    expect(avisosDoRecebimento({ ...base, haRecebimentoIgual: true })).toEqual(['POSSIVEL_DUPLICIDADE'])
    expect(
      avisosDoRecebimento({ ...base, haRecebimentoIgual: true, forma: FORA_DA_CONFERENCIA }),
    ).toEqual(['POSSIVEL_DUPLICIDADE'])
    expect(avisosDoRecebimento({ ...base, haRecebimentoIgual: true, confirmarDuplicidade: true })).toEqual([])
  })

  it('valor zero nunca é duplicidade', () => {
    expect(avisosDoRecebimento({ ...base, haRecebimentoIgual: true, valor: c(0), forma: '' })).toEqual([])
  })

  it('os dois juntos, e cada confirmação só apaga o seu', () => {
    const ambos = { ...base, caixaFechado: true, haRecebimentoIgual: true }
    expect(avisosDoRecebimento(ambos)).toEqual(['CAIXA_FECHADO', 'POSSIVEL_DUPLICIDADE'])
    expect(avisosDoRecebimento({ ...ambos, confirmarCaixaFechado: true })).toEqual(['POSSIVEL_DUPLICIDADE'])
    expect(avisosDoRecebimento({ ...ambos, confirmarDuplicidade: true })).toEqual(['CAIXA_FECHADO'])
  })
})
