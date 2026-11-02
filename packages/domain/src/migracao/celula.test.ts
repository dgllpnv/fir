import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { Dinheiro } from '../dinheiro'
import { ehErro, exigir } from '../resultado'
import { instanteLocal } from '../relogio'
import {
  type Celula,
  diaDeCelula,
  digitosDeCelula,
  dinheiroDeCelula,
  expandirCientifica,
  horaDeCelula,
  inteiroDeCelula,
  relogioDeParedeDeCelula,
  textoDeCelula,
} from './celula'

/**
 * **A CONVERSÃO DE VALOR É ONDE A MIGRAÇÃO PERDE DINHEIRO EM SILÊNCIO.**
 *
 * Os testes deste arquivo existem com uma pergunta só: *a soma da coluna na
 * origem é igual à soma dos centavos no destino?* Property-based, porque
 * exemplo escolhido a dedo não prova invariante de aritmética — e porque o
 * caso que quebra é sempre `12.3` vindo de `12.30`.
 *
 * Cada `it` marcado com **MUTAÇÃO** diz qual mudança no código ele mata. Uma
 * mutação que sobrevive é teste ruim.
 */

const num = (bruto: string): Celula => ({ bruto, tipo: 'n' })
const txt = (bruto: string): Celula => ({ bruto, tipo: 's' })

/**
 * A referência INDEPENDENTE: literal decimal → centavos, só com string e
 * `BigInt`, escrita de outra forma que a de `celula.ts`.
 *
 * Ela não passa por `Number` em nenhum passo. Sem uma segunda implementação, a
 * propriedade estaria comparando a função consigo mesma.
 */
function centavosPorFora(literal: string): bigint {
  const [inteiros = '0', decimais = ''] = literal.split('.')
  const duas = (decimais + '00').slice(0, 2)
  return BigInt(inteiros) * 100n + BigInt(duas)
}

describe('dinheiroDeCelula — até duas casas, a conversão é EXATA', () => {
  it('bate com a conversão feita por fora, para qualquer literal de 0 a 2 casas', () => {
    fc.assert(
      fc.property(
        fc.nat({ max: 99_999_999 }),
        fc.integer({ min: 0, max: 2 }),
        fc.nat({ max: 99 }),
        (reais, casas, centavos) => {
          const decimais =
            casas === 0 ? '' : casas === 1 ? String(centavos % 10) : String(centavos).padStart(2, '0')
          const literal = decimais === '' ? String(reais) : `${reais}.${decimais}`
          const r = exigir(dinheiroDeCelula(num(literal)))
          expect(r.arredondou).toBe(false)
          expect(r.valor.centavos).toBe(centavosPorFora(literal))
        },
      ),
      { numRuns: 500 },
    )
  })

  /**
   * **MUTAÇÃO:** trocar `decimais.slice(0, 2).padEnd(2, '0')` por
   * `decimais.slice(0, 2)`.
   *
   * `12.3` passaria a valer **1203** centavos em vez de 1230 — e é a forma mais
   * comum do dado real, porque a exportação escreve `450` como `450.0` e
   * `1250.50` como `1250.5`. Sem este caso, a suíte não distingue as duas.
   */
  it('MUTAÇÃO · uma casa decimal é a casa dos DEZ centavos, não a dos centavos', () => {
    expect(exigir(dinheiroDeCelula(num('12.3'))).valor.centavos).toBe(1230n)
    expect(exigir(dinheiroDeCelula(num('1250.5'))).valor.centavos).toBe(125_050n)
    expect(exigir(dinheiroDeCelula(num('450.0'))).valor.centavos).toBe(45_000n)
  })

  /**
   * **A AUDITORIA DA ADR 0009, EM FORMA DE PROPRIEDADE.**
   *
   * `Σ(converter(x)) === converter_por_fora(Σ x)` para qualquer coluna. É
   * literalmente a prova que o relatório de conferência promete: a soma da
   * coluna na origem é igual à soma dos centavos no destino.
   */
  it('a SOMA da coluna é preservada, qualquer que seja a coluna', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.tuple(fc.nat({ max: 999_999 }), fc.nat({ max: 99 })).map(([r, c]) => `${r}.${String(c).padStart(2, '0')}`),
          { maxLength: 60 },
        ),
        (coluna) => {
          const somaConvertida = coluna.reduce(
            (a, l) => a.mais(exigir(dinheiroDeCelula(num(l))).valor),
            Dinheiro.zero(),
          )
          const somaPorFora = coluna.reduce((a, l) => a + centavosPorFora(l), 0n)
          expect(somaConvertida.centavos).toBe(somaPorFora)
        },
      ),
      { numRuns: 300 },
    )
  })

  it('célula de TEXTO aceita as formas que o `lerValor` da v20 aceita', () => {
    expect(exigir(dinheiroDeCelula(txt('450'))).valor.centavos).toBe(45_000n)
    expect(exigir(dinheiroDeCelula(txt('450,00'))).valor.centavos).toBe(45_000n)
    expect(exigir(dinheiroDeCelula(txt('1.250,50'))).valor.centavos).toBe(125_050n)
    expect(exigir(dinheiroDeCelula(txt('R$ 1.250,50'))).valor.centavos).toBe(125_050n)
    expect(exigir(dinheiroDeCelula(txt(''))).valor.centavos).toBe(0n)
  })

  it('célula vazia é zero, não erro — a coluna `valor` é vazia na maioria das linhas', () => {
    expect(exigir(dinheiroDeCelula(num(''))).valor.ehZero()).toBe(true)
  })
})

describe('dinheiroDeCelula — mais de duas casas ARREDONDA, e DECLARA (ADR 0009)', () => {
  it('meio para cima na segunda casa, com a bandeira levantada', () => {
    const a = exigir(dinheiroDeCelula(num('12.344')))
    expect(a.valor.centavos).toBe(1234n)
    expect(a.arredondou).toBe(true)

    const b = exigir(dinheiroDeCelula(num('12.345')))
    expect(b.valor.centavos).toBe(1235n)
    expect(b.arredondou).toBe(true)

    // O caso que o float produz: `12.30` que virou `12.299999999999999`.
    const c = exigir(dinheiroDeCelula(num('12.299999999999999')))
    expect(c.valor.centavos).toBe(1230n)
    expect(c.arredondou).toBe(true)
  })

  /**
   * **MUTAÇÃO:** devolver `arredondou: false` sempre.
   *
   * A soma continuaria certa e o relatório diria "0 arredondamentos" — a
   * migração teria mexido em centavos sem ninguém saber, que é exatamente o
   * que a ADR existe para impedir. É o teste que separa "arredondamento
   * declarado e auditado" de "arredondamento".
   */
  it('MUTAÇÃO · a bandeira NÃO é decorativa: 2 casas não levanta, 3 levanta', () => {
    expect(exigir(dinheiroDeCelula(num('12.34'))).arredondou).toBe(false)
    expect(exigir(dinheiroDeCelula(num('12.340'))).arredondou).toBe(false)
    expect(exigir(dinheiroDeCelula(num('12.341'))).arredondou).toBe(true)
  })

  it('valor NEGATIVO é erro, nunca zero em silêncio', () => {
    const r = dinheiroDeCelula(num('-10.00'))
    expect(ehErro(r)).toBe(true)
    if (ehErro(r)) expect(r.erro.codigo).toBe('ValorNegativo')
  })

  it('literal que não é número é erro', () => {
    expect(ehErro(dinheiroDeCelula(num('mil reais')))).toBe(true)
  })
})

describe('expandirCientifica — o telefone que virou float', () => {
  /**
   * **MUTAÇÃO:** usar `String(Number(literal))`.
   *
   * `Number('5.5719999999E10')` até devolve `55719999999` — e aí a mutação
   * sobrevive. O que ela não sobrevive é o expoente grande: `String(Number(
   * '1.2345678901234E22'))` devolve `'1.2345678901234e+22'`, com o `e+22`
   * dentro da string, e o telefone (ou o valor) chega com letra no meio.
   */
  it('MUTAÇÃO · expande pelos DÍGITOS, sem passar por Number', () => {
    expect(expandirCientifica('5.5719999999E10')).toBe('55719999999')
    expect(expandirCientifica('1.2345678901234E22')).toBe('12345678901234000000000')
    expect(expandirCientifica('1.5E-3')).toBe('0.0015')
    expect(expandirCientifica('71999998888')).toBe('71999998888')
  })

  it('o telefone em notação científica volta como dígitos', () => {
    expect(digitosDeCelula(num('5.5719999999E10'))).toBe('55719999999')
  })

  it('o telefone escrito à mão perde a pontuação e mantém os dígitos', () => {
    expect(digitosDeCelula(txt('(71) 99999-8888'))).toBe('71999998888')
    expect(digitosDeCelula(txt('71 9 9999 8888'))).toBe('71999998888')
  })
})

describe('textoDeCelula — o `1.0` que era `1`, e o espaço duplo', () => {
  it('apara o zero à direita do número', () => {
    expect(textoDeCelula(num('1.0'))).toBe('1')
    expect(textoDeCelula(num('12.300'))).toBe('12.3')
    expect(textoDeCelula(num('0.0'))).toBe('0')
  })

  /**
   * **MUTAÇÃO:** usar `.trim()` sem o `replace(/\s+/g, ' ')`.
   *
   * `"Maria  Souza"` chegaria com o espaço duplo. O índice
   * `pacientes_nome_unico` normaliza, então ele aceitaria a linha; e o LTV
   * passaria a ter duas chaves para uma paciente só na hora de comparar por
   * nome. O nome com espaço duplo está no dado real.
   */
  it('MUTAÇÃO · colapsa espaço interno, não só as pontas', () => {
    expect(textoDeCelula(txt('  Maria   Souza  '))).toBe('Maria Souza')
    expect(textoDeCelula(txt('Maria Souza'))).toBe('Maria Souza')
  })
})

describe('diaDeCelula — serial do Excel e texto ISO na MESMA coluna', () => {
  it('o serial 45678 é 2025-01-21 (época 1899-12-30)', () => {
    expect(exigir(diaDeCelula(num('45678')))).toBe('2025-01-21')
  })

  it('a parte fracionária do serial é HORA, e não muda o dia', () => {
    expect(exigir(diaDeCelula(num('45678.9999')))).toBe('2025-01-21')
  })

  /**
   * **MUTAÇÃO:** usar `Date.UTC(1900, 0, 1)` como época.
   *
   * É o erro clássico: o Excel trata 1900 como bissexto, que não foi, e a
   * convenção universal compensa com dois dias. A mutação desloca TODA data
   * em serial de dois dias — e o dado real tem `aniversario` e `inicio` de
   * adesão em serial.
   */
  it('MUTAÇÃO · a época é 1899-12-30, e um dia de erro é um dia de erro', () => {
    expect(exigir(diaDeCelula(num('1')))).toBe('1899-12-31')
    expect(exigir(diaDeCelula(num('61')))).toBe('1900-03-01')
  })

  it('ida e volta do serial, para qualquer dia de 1950 a 2060', () => {
    fc.assert(
      fc.property(fc.integer({ min: 18_264, max: 58_804 }), (serial) => {
        const dia = exigir(diaDeCelula(num(String(serial))))
        expect(dia).not.toBeNull()
        expect(exigir(diaDeCelula(txt(dia ?? '')))).toBe(dia)
      }),
      { numRuns: 300 },
    )
  })

  it('texto ISO com e sem hora devolve o DIA', () => {
    expect(exigir(diaDeCelula(txt('2026-01-05')))).toBe('2026-01-05')
    expect(exigir(diaDeCelula(txt('2026-01-05T09:30')))).toBe('2026-01-05')
    expect(exigir(diaDeCelula(txt('2026-01-05 09:30')))).toBe('2026-01-05')
  })

  it('dia fora do calendário é erro', () => {
    expect(ehErro(diaDeCelula(txt('2026-02-30')))).toBe(true)
    expect(ehErro(diaDeCelula(txt('05/01/2026')))).toBe(true)
  })

  it('vazio é nulo, não 1899-12-30', () => {
    expect(exigir(diaDeCelula(num('')))).toBeNull()
    expect(exigir(diaDeCelula(txt('')))).toBeNull()
  })
})

describe('relogioDeParedeDeCelula — as DUAS formas de data-hora da v20', () => {
  /**
   * **MUTAÇÃO:** aceitar só `T` entre o dia e a hora.
   *
   * As três planilhas reais têm as duas formas **na mesma coluna**
   * (`criadaEm`), e numa delas a forma com espaço é a maioria. Com só o `T`, a
   * data-hora com espaço cairia em `null` e a tarefa nasceria com
   * `criada_em = now()` — o histórico inteiro com a data da migração.
   */
  it('MUTAÇÃO · `T` e ESPAÇO são a mesma data-hora', () => {
    expect(exigir(relogioDeParedeDeCelula(txt('2026-01-05T09:30')))).toEqual({
      dia: '2026-01-05',
      hora: '09:30',
    })
    expect(exigir(relogioDeParedeDeCelula(txt('2026-01-05 09:30')))).toEqual({
      dia: '2026-01-05',
      hora: '09:30',
    })
  })

  it('o serial fracionário é arredondado ao MINUTO', () => {
    // 0.5 = 12:00 exatas.
    expect(exigir(relogioDeParedeDeCelula(num('45678.5')))).toEqual({
      dia: '2025-01-21',
      hora: '12:00',
    })
    // 13:00 como o float o representa.
    expect(exigir(relogioDeParedeDeCelula(num('45678.5416666666667')))).toEqual({
      dia: '2025-01-21',
      hora: '13:00',
    })
  })

  it('a hora pode virar o dia no serial, e o dia acompanha', () => {
    expect(exigir(relogioDeParedeDeCelula(num('45678.99999')))).toEqual({
      dia: '2025-01-22',
      hora: '00:00',
    })
  })

  /**
   * **MUTAÇÃO:** devolver um `Date` montado como UTC.
   *
   * A v20 grava `Utilities.formatDate(…, 'America/Bahia', …)`: o que está no
   * arquivo é a hora LOCAL. Interpretá-la como UTC desloca o histórico de três
   * horas, e três horas mudam o DIA de tudo o que foi lançado antes das 03:00
   * — a receita de 1º de maio aparece em 30 de abril (regra 22).
   */
  it('MUTAÇÃO · o relógio de parede + o fuso da clínica dão instantes DIFERENTES', () => {
    const r = exigir(relogioDeParedeDeCelula(txt('2026-05-01 01:00')))!
    const naBahia = instanteLocal(r.dia, r.hora, 'America/Bahia')
    expect(naBahia.toISOString()).toBe('2026-05-01T04:00:00.000Z')
    // E a clínica de outro estado NÃO é a mesma coisa: Fernando de Noronha é
    // UTC−2, e a v20 fixava Bahia num `const`.
    const emNoronha = instanteLocal(r.dia, r.hora, 'America/Noronha')
    expect(emNoronha.toISOString()).toBe('2026-05-01T03:00:00.000Z')
    expect(naBahia.getTime()).not.toBe(emNoronha.getTime())
  })

  it('o horário de verão que a Bahia TEVE é respeitado', () => {
    // 2012-01-15: Bahia em horário de verão, UTC−2.
    expect(instanteLocal('2012-01-15', '10:00', 'America/Bahia').toISOString()).toBe(
      '2012-01-15T12:00:00.000Z',
    )
    // 2013-01-15: já sem horário de verão, UTC−3.
    expect(instanteLocal('2013-01-15', '10:00', 'America/Bahia').toISOString()).toBe(
      '2013-01-15T13:00:00.000Z',
    )
  })
})

describe('horaDeCelula e inteiroDeCelula', () => {
  it('a coluna `hora` aceita `HH:mm` e a data-hora inteira', () => {
    expect(exigir(horaDeCelula(txt('09:30')))).toBe('09:30')
    expect(exigir(horaDeCelula(txt('2026-01-05T09:30')))).toBe('09:30')
    expect(exigir(horaDeCelula(txt('')))).toBeNull()
  })

  it('hora fora do relógio é erro', () => {
    expect(ehErro(horaDeCelula(txt('25:00')))).toBe(true)
  })

  it('`7.0` é sete; `7.5` é erro — meia sessão não existe', () => {
    expect(exigir(inteiroDeCelula(num('7.0'), 0))).toBe(7)
    expect(exigir(inteiroDeCelula(num('7'), 0))).toBe(7)
    expect(ehErro(inteiroDeCelula(num('7.5'), 0))).toBe(true)
  })

  /**
   * **MUTAÇÃO:** usar `Number(x) || padrao`.
   *
   * `0` é falso em JavaScript, então `antecedencia = 0` viraria `15` — a
   * clínica que pediu o contato NO DIA passaria a receber quinze dias antes. O
   * dado real tem `antecedencia = 0`.
   */
  it('MUTAÇÃO · zero é ZERO, e o padrão vale só para a célula VAZIA', () => {
    expect(exigir(inteiroDeCelula(num('0'), 15))).toBe(0)
    expect(exigir(inteiroDeCelula(num('0.0'), 15))).toBe(0)
    expect(exigir(inteiroDeCelula(num(''), 15))).toBe(15)
  })
})
