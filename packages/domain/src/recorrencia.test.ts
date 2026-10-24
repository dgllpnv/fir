import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { fimDoMes, somarDias, somarMeses } from './relogio'
import { ehErro, exigir, type Result } from './resultado'
import { FREQUENCIAS, gerarSerie, MAX_SERIE, rotuloDaSerie, type Frequencia } from './recorrencia'

const codigoDe = (r: Result<unknown>): string => (ehErro(r) ? r.erro.codigo : 'OK')

describe('gerarSerie — as seis frequências', () => {
  it('mensal a partir de 31/01 volta ao dia 31 depois do mês curto', () => {
    const r = exigir(gerarSerie('2026-01-31', 'mensal', '2026-05-31'))
    expect(r).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
      '2026-05-31',
    ])
  })

  it('mensal a partir de 29/01 em ano bissexto pega o 29 de fevereiro', () => {
    const r = exigir(gerarSerie('2028-01-29', 'mensal', '2028-03-29'))
    expect(r).toEqual(['2028-01-29', '2028-02-29', '2028-03-29'])
  })

  it('mensal a partir de 30/01 em ano COMUM cai no 28 e volta ao 30', () => {
    const r = exigir(gerarSerie('2026-01-30', 'mensal', '2026-04-30'))
    expect(r).toEqual(['2026-01-30', '2026-02-28', '2026-03-30', '2026-04-30'])
  })

  it('dias úteis pula sábado e domingo e não pula a semana', () => {
    // 2026-10-23 é uma sexta.
    const r = exigir(gerarSerie('2026-10-23', 'uteis', '2026-10-28'))
    expect(r).toEqual(['2026-10-23', '2026-10-26', '2026-10-27', '2026-10-28'])
  })

  it('dias úteis começando num sábado começa na segunda', () => {
    // 2026-10-24 é sábado: a primeira data da série é 26, não 24.
    const r = exigir(gerarSerie('2026-10-24', 'uteis', '2026-10-28'))
    expect(r).toEqual(['2026-10-26', '2026-10-27', '2026-10-28'])
  })

  it('diária é todo dia, inclusive fim de semana', () => {
    expect(exigir(gerarSerie('2026-10-23', 'diaria', '2026-10-26'))).toEqual([
      '2026-10-23',
      '2026-10-24',
      '2026-10-25',
      '2026-10-26',
    ])
  })

  it('semanal é de 7 em 7', () => {
    expect(exigir(gerarSerie('2026-10-01', 'semanal', '2026-10-20'))).toEqual([
      '2026-10-01',
      '2026-10-08',
      '2026-10-15',
    ])
  })

  it('quinzenal é de 14 em 14, não "duas vezes por mês"', () => {
    expect(exigir(gerarSerie('2026-01-01', 'quinzenal', '2026-02-01'))).toEqual([
      '2026-01-01',
      '2026-01-15',
      '2026-01-29',
    ])
  })

  it('"a cada X dias" exige X', () => {
    expect(codigoDe(gerarSerie('2026-01-01', 'ndias', '2026-03-01'))).toBe('PASSO_INVALIDO')
    expect(codigoDe(gerarSerie('2026-01-01', 'ndias', '2026-03-01', 1))).toBe('PASSO_INVALIDO')
    expect(codigoDe(gerarSerie('2026-01-01', 'ndias', '2026-03-01', 366))).toBe('PASSO_INVALIDO')
    expect(exigir(gerarSerie('2026-01-01', 'ndias', '2026-01-21', 10)).length).toBe(3)
  })
})

describe('gerarSerie — os limites', () => {
  it('série de uma data só é recusada — isso não é série', () => {
    expect(codigoDe(gerarSerie('2026-10-24', 'semanal', '2026-10-24'))).toBe('SERIE_CURTA')
  })

  it('"repetir até" antes da data inicial é recusado', () => {
    expect(codigoDe(gerarSerie('2026-10-24', 'semanal', '2026-10-01'))).toBe('ATE_ANTES')
  })

  it('acima de 150 é recusado, não truncado', () => {
    const r = gerarSerie('2026-01-01', 'diaria', '2026-12-31')
    expect(codigoDe(r)).toBe('SERIE_LONGA')
    expect(ehErro(r) && r.erro.mensagem).toContain('150')
  })

  it('exatamente 150 passa; 151 não', () => {
    // A borda, escrita: o protótipo gerava 151 e só então recusava. Aqui a
    // série NASCE com no máximo 150 — nenhum caminho devolve 151 datas.
    expect(exigir(gerarSerie('2026-01-01', 'diaria', somarDias('2026-01-01', 149))).length).toBe(150)
    expect(codigoDe(gerarSerie('2026-01-01', 'diaria', somarDias('2026-01-01', 150)))).toBe(
      'SERIE_LONGA',
    )
  })
})

describe('o rótulo que a tela mostra', () => {
  it('cada frequência tem rótulo, e "a cada X dias" traz o X', () => {
    expect(rotuloDaSerie('quinzenal')).toBe('A cada 15 dias')
    expect(rotuloDaSerie('uteis')).toBe('Dias úteis')
    expect(rotuloDaSerie('ndias', 10)).toBe('A cada 10 dias')
    // Sem o número, o rótulo genérico — é o que o `<select>` mostra antes de
    // alguém digitar o intervalo.
    expect(rotuloDaSerie('ndias')).toBe('A cada X dias')
  })
})

/** Dias civis de 2020-01-01 a 2035-12-31, sem passar por `Date` com fuso. */
const diaCivilArb = fc.integer({ min: 0, max: 5843 }).map((n) => somarDias('2020-01-01', n))

describe('as propriedades — exemplo a dedo não prova invariante', () => {
  it('mensal: toda data da série tem o dia original OU é o último dia do mês', () => {
    let ok = 0
    fc.assert(
      fc.property(diaCivilArb, fc.integer({ min: 1, max: 60 }), (inicio, meses) => {
        const diaOriginal = Number(inicio.slice(8, 10))
        const r = gerarSerie(inicio, 'mensal', somarMeses(inicio, meses, diaOriginal))
        if (ehErro(r)) return
        ok++
        for (const dia of r.valor) {
          const n = Number(dia.slice(8, 10))
          expect(n === diaOriginal || dia === fimDoMes(dia.slice(0, 7))).toBe(true)
        }
      }),
    )
    // Sem este piso a propriedade passaria com `gerarSerie` devolvendo erro
    // sempre: um `for` sobre zero datas não executa asserção nenhuma.
    expect(ok).toBeGreaterThan(50)
  })

  it('a série é estritamente crescente, começa em `inicio` ou depois, e nunca passa de `ate`', () => {
    // "nunca passa de `ate`" SOZINHA não distingue crescente de repetida — e
    // uma série com duas tarefas no mesmo dia é exatamente o que a recepção
    // reclama. Por isso a asserção de ordem estrita está aqui junto.
    let ok = 0
    fc.assert(
      fc.property(
        diaCivilArb,
        fc.constantFrom(...FREQUENCIAS),
        fc.integer({ min: 0, max: 400 }),
        fc.integer({ min: 2, max: 365 }),
        (inicio, freq: Frequencia, dias, passo) => {
          const ate = somarDias(inicio, dias)
          const r = gerarSerie(inicio, freq, ate, passo)
          if (ehErro(r)) return
          ok++
          const v = r.valor
          expect(v.length).toBeGreaterThanOrEqual(2)
          expect(v.length).toBeLessThanOrEqual(MAX_SERIE)
          expect(v[0]! >= inicio).toBe(true)
          expect(v[v.length - 1]! <= ate).toBe(true)
          for (let i = 1; i < v.length; i++) expect(v[i]! > v[i - 1]!).toBe(true)
        },
      ),
    )
    expect(ok).toBeGreaterThan(50)
  })

  it('a âncora mensal é a data inicial: 12 meses a partir do dia 31 têm 7 dias 31', () => {
    // A propriedade que separa esta implementação da errada. Se a âncora
    // fosse a data ANTERIOR, a série ficaria presa no dia 28 de fevereiro em
    // diante e nenhum mês posterior teria o dia 31.
    const r = exigir(gerarSerie('2026-01-31', 'mensal', '2026-12-31'))
    expect(r.filter((d) => d.endsWith('-31')).length).toBe(7)
  })
})
