import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { Dinheiro } from './dinheiro'
import {
  LIMIAR_ORCAMENTOS_PAGOS,
  agruparCampanhasComSupressao,
  deveSuprimirCampanha,
  mesesJuntos,
  type CampanhaParaSupressao,
} from './portal-grupo'

describe('mesesJuntos', () => {
  it('no próprio dia de início, é o mês 1', () => {
    expect(mesesJuntos(new Date('2026-03-10T00:00:00Z'), new Date('2026-03-10T00:00:00Z'))).toBe(1)
  })

  it('um dia antes de completar um mês, ainda é o mês 1', () => {
    expect(mesesJuntos(new Date('2026-03-10T00:00:00Z'), new Date('2026-04-09T00:00:00Z'))).toBe(1)
  })

  it('no dia que completa o mês, vira o mês 2', () => {
    expect(mesesJuntos(new Date('2026-03-10T00:00:00Z'), new Date('2026-04-10T00:00:00Z'))).toBe(2)
  })

  it('dia 31 cai no fim de um mês de 28/30 dias (mesma régua da regra 25)', () => {
    // Início em 31/01; em 28/02 (último dia de fevereiro) ainda não virou mês —
    // vira em 01/03.
    expect(mesesJuntos(new Date('2026-01-31T00:00:00Z'), new Date('2026-02-28T00:00:00Z'))).toBe(1)
    expect(mesesJuntos(new Date('2026-01-31T00:00:00Z'), new Date('2026-03-01T00:00:00Z'))).toBe(2)
  })

  it('recusa data de referência anterior ao início', () => {
    expect(() => mesesJuntos(new Date('2026-03-10T00:00:00Z'), new Date('2026-01-01T00:00:00Z'))).toThrow()
  })

  it('nunca é menor que 1', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 3650 }), (dias) => {
        const inicio = new Date('2020-01-01T00:00:00Z')
        const agora = new Date(inicio.getTime() + dias * 86_400_000)
        expect(mesesJuntos(inicio, agora)).toBeGreaterThanOrEqual(1)
      }),
    )
  })
})

describe('deveSuprimirCampanha', () => {
  it('suprime null — enquanto a contagem real não existe, a leitura segura é esconder', () => {
    expect(deveSuprimirCampanha(null)).toBe(true)
  })

  it('suprime abaixo do limiar, nunca no limiar exato nem acima', () => {
    expect(deveSuprimirCampanha(0)).toBe(true)
    expect(deveSuprimirCampanha(LIMIAR_ORCAMENTOS_PAGOS - 1)).toBe(true)
    expect(deveSuprimirCampanha(LIMIAR_ORCAMENTOS_PAGOS)).toBe(false)
    expect(deveSuprimirCampanha(LIMIAR_ORCAMENTOS_PAGOS + 1)).toBe(false)
  })
})

describe('agruparCampanhasComSupressao', () => {
  const campanha = (
    id: string,
    nome: string,
    centavos: bigint,
    orcamentosPagos: number | null,
  ): CampanhaParaSupressao => ({ id, nome, resultado: Dinheiro.deCentavos(centavos), orcamentosPagos })

  it('campanha grande aparece individualizada; pequena some dentro de "Outras"', () => {
    const saida = agruparCampanhasComSupressao([
      campanha('1', 'Outubro Rosa', 500_00n, 12),
      campanha('2', 'Campanha da Dra. Ana (3 pacientes)', 9_00n, 3),
    ])
    expect(saida).toEqual([
      { tipo: 'individual', id: '1', nome: 'Outubro Rosa', resultado: Dinheiro.deCentavos(500_00n) },
      { tipo: 'outras', quantidade: 1, resultado: Dinheiro.deCentavos(9_00n) },
    ])
  })

  it('nunca individualiza nome nem id de campanha suprimida', () => {
    const saida = agruparCampanhasComSupressao([campanha('segredo', 'Nome que não pode vazar', 100n, 1)])
    const texto = JSON.stringify(saida, (_chave, valor) => (typeof valor === 'bigint' ? valor.toString() : valor))
    expect(texto).not.toContain('segredo')
    expect(texto).not.toContain('Nome que não pode vazar')
  })

  it('sem campanhas pequenas, não há bucket "Outras"', () => {
    const saida = agruparCampanhasComSupressao([campanha('1', 'Grande', 10_00n, 10)])
    expect(saida).toEqual([{ tipo: 'individual', id: '1', nome: 'Grande', resultado: Dinheiro.deCentavos(10_00n) }])
  })

  it('property-based: a soma da saída é EXATAMENTE a soma de entrada, sempre', () => {
    const arbCampanha = fc.record({
      id: fc.uuid(),
      nome: fc.string({ minLength: 1, maxLength: 20 }),
      centavos: fc.bigInt({ min: 0n, max: 10n ** 9n }),
      orcamentosPagos: fc.option(fc.integer({ min: 0, max: 50 }), { nil: null }),
    })

    fc.assert(
      fc.property(fc.array(arbCampanha, { maxLength: 30 }), (entradas) => {
        const campanhas = entradas.map((e) => campanha(e.id, e.nome, e.centavos, e.orcamentosPagos))
        const saida = agruparCampanhasComSupressao(campanhas)
        const totalEntrada = campanhas.reduce((acc, c) => acc.mais(c.resultado), Dinheiro.zero())
        const totalSaida = saida.reduce((acc, c) => acc.mais(c.resultado), Dinheiro.zero())
        expect(totalSaida.centavos).toBe(totalEntrada.centavos)
      }),
    )
  })

  it('property-based: nenhuma campanha suprimida aparece como "individual"', () => {
    const arbCampanha = fc.record({
      id: fc.uuid(),
      nome: fc.string({ minLength: 1, maxLength: 20 }),
      centavos: fc.bigInt({ min: 0n, max: 10n ** 9n }),
      orcamentosPagos: fc.option(fc.integer({ min: 0, max: 50 }), { nil: null }),
    })

    fc.assert(
      fc.property(fc.array(arbCampanha, { maxLength: 30 }), (entradas) => {
        const campanhas = entradas.map((e) => campanha(e.id, e.nome, e.centavos, e.orcamentosPagos))
        const saida = agruparCampanhasComSupressao(campanhas)
        const idsIndividuais = new Set(
          saida.filter((c): c is Extract<typeof c, { tipo: 'individual' }> => c.tipo === 'individual').map((c) => c.id),
        )
        for (const c of campanhas) {
          if (deveSuprimirCampanha(c.orcamentosPagos)) expect(idsIndividuais.has(c.id)).toBe(false)
        }
      }),
    )
  })
})
