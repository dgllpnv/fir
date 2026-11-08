import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { cicloDoContrato, nomeDaSaudacao } from './portal-grupo'

/**
 * O2 — o cartão do ciclo no portal (`fg-portal.js` L104–113). Três formas,
 * como o protótipo: "Mês N de M" quando há fim de contrato, "Nº mês juntos"
 * quando é recorrente, e o programa quando não há data de início.
 */
describe('cicloDoContrato', () => {
  it('sem data de início, mostra o programa (portal:L113)', () => {
    expect(cicloDoContrato(null, null, '2026-11-08')).toEqual({ tipo: 'programa' })
    expect(cicloDoContrato(null, '2027-01-01', '2026-11-08')).toEqual({ tipo: 'programa' })
  })

  it('sem fim, é recorrente: "Nº mês juntos" desde o início (portal:L112)', () => {
    expect(cicloDoContrato('2026-03-10', null, '2026-03-10')).toEqual({ tipo: 'recorrente', mes: 1, inicio: '2026-03-10' })
    expect(cicloDoContrato('2026-03-10', null, '2026-04-09')).toEqual({ tipo: 'recorrente', mes: 1, inicio: '2026-03-10' })
    expect(cicloDoContrato('2026-03-10', null, '2026-04-10')).toEqual({ tipo: 'recorrente', mes: 2, inicio: '2026-03-10' })
  })

  it('início no futuro não dá mês zero nem negativo — o protótipo usa max(1, …)', () => {
    expect(cicloDoContrato('2026-12-01', null, '2026-11-08')).toEqual({ tipo: 'recorrente', mes: 1, inicio: '2026-12-01' })
  })

  it('com fim: "Mês N de M", M pelo número médio de meses entre as datas (portal:L108)', () => {
    // 6 meses: 01/01 a 01/07 = 181 dias ÷ 30,4375 = 5,95 → 6.
    const c = cicloDoContrato('2026-01-01', '2026-07-01', '2026-03-15')
    expect(c).toMatchObject({ tipo: 'com_fim', mes: 3, total: 6, inicio: '2026-01-01', fim: '2026-07-01' })
  })

  it('o mês nunca passa do total, mesmo depois do fim (portal:L109, Math.min)', () => {
    const c = cicloDoContrato('2026-01-01', '2026-07-01', '2027-02-01')
    expect(c).toMatchObject({ tipo: 'com_fim', mes: 6, total: 6, percentual: 100 })
  })

  it('a barra: percentual do caminho, entre 0 e 100, calculado aqui e não na tela', () => {
    expect(cicloDoContrato('2026-01-01', '2026-01-11', '2026-01-06')).toMatchObject({ percentual: 50 })
    expect(cicloDoContrato('2026-01-01', '2026-01-11', '2025-12-01')).toMatchObject({ percentual: 0 })
  })

  it('início igual ao fim não divide por zero', () => {
    expect(cicloDoContrato('2026-01-01', '2026-01-01', '2025-12-31')).toMatchObject({ total: 1, percentual: 0 })
    expect(cicloDoContrato('2026-01-01', '2026-01-01', '2026-01-01')).toMatchObject({ total: 1, percentual: 100 })
  })

  it('propriedade: 1 ≤ mês ≤ total e 0 ≤ percentual ≤ 100, para qualquer trio de datas', () => {
    const dia = fc.integer({ min: 0, max: 20000 }).map((n) => new Date(Date.UTC(2000, 0, 1) + n * 86_400_000).toISOString().slice(0, 10))
    fc.assert(
      fc.property(dia, dia, dia, (inicio, fim, hoje) => {
        const c = cicloDoContrato(inicio, fim, hoje)
        if (c.tipo !== 'com_fim') return false
        return (
          Number.isInteger(c.mes) &&
          Number.isInteger(c.percentual) &&
          c.mes >= 1 &&
          c.mes <= c.total &&
          c.percentual >= 0 &&
          c.percentual <= 100
        )
      }),
    )
  })
})

describe('nomeDaSaudacao', () => {
  it('"Olá, [primeiro nome da decisora]" — as duas primeiras palavras, como o protótipo (portal:L101)', () => {
    expect(nomeDaSaudacao('Dra. Cristina Albuquerque Souza', 'Clínica Bela')).toBe('Dra. Cristina')
    expect(nomeDaSaudacao('Marina', 'Clínica Bela')).toBe('Marina')
  })

  it('sem decisora, usa o nome do cliente', () => {
    expect(nomeDaSaudacao(null, 'Clínica Bela Vista')).toBe('Clínica Bela')
  })

  it('espaços sobrando não viram palavra vazia', () => {
    expect(nomeDaSaudacao('  Ana   Paula  Reis ', 'X')).toBe('Ana Paula')
  })

  it('nada para dizer devolve null — a tela usa "seja bem vinda"', () => {
    expect(nomeDaSaudacao('   ', '  ')).toBeNull()
  })
})
