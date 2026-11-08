import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { Dinheiro } from './dinheiro'
import {
  LIMIAR_ORCAMENTOS_PAGOS,
  totalDasCampanhasExibidas,
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
      // CE-3: uma campanha só no balde — o valor dela não é exibido.
      { tipo: 'outras', quantidade: 1, resultado: null },
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

  it('property-based: com o balde exibido, a soma da saída é EXATAMENTE a soma de entrada', () => {
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
        if (saida.some((c) => c.resultado === null)) return // balde sem valor: ver CE-3 abaixo
        const totalSaida = saida.reduce((acc, c) => (c.resultado === null ? acc : acc.mais(c.resultado)), Dinheiro.zero())
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

describe('CE-3 (gate de números G8): a supressão não vaza por subtração nem por balde de uma campanha só', () => {
  const campanha = (
    id: string,
    nome: string,
    centavos: bigint,
    orcamentosPagos: number | null,
  ): CampanhaParaSupressao => ({ id, nome, resultado: Dinheiro.deCentavos(centavos), orcamentosPagos })

  it('uma única campanha pequena NÃO aparece como \'Outras campanhas (1)\' com o próprio valor', () => {
    const saida = agruparCampanhasComSupressao([
      campanha('g', 'Grande', 500000n, 12),
      campanha('b', 'Botox setembro', 120000n, 1),
    ])
    expect(saida).toEqual([
      { tipo: 'individual', id: 'g', nome: 'Grande', resultado: Dinheiro.deCentavos(500000n) },
      { tipo: 'outras', quantidade: 1, resultado: null },
    ])
  })

  it('várias pequenas cuja soma de orçamentos pagos não chega a k: o balde aparece sem valor', () => {
    const saida = agruparCampanhasComSupressao([campanha('a', 'A', 100n, 2), campanha('b', 'B', 200n, 2)])
    expect(saida).toEqual([{ tipo: 'outras', quantidade: 2, resultado: null }])
  })

  it('várias pequenas que juntas chegam a k: o balde aparece com a soma exata', () => {
    const saida = agruparCampanhasComSupressao([campanha('a', 'A', 100n, 2), campanha('b', 'B', 200n, 3)])
    expect(saida).toEqual([{ tipo: 'outras', quantidade: 2, resultado: Dinheiro.deCentavos(300n) }])
  })

  it('contagem desconhecida (null) conta como zero no balde — a leitura segura esconde', () => {
    const saida = agruparCampanhasComSupressao([campanha('a', 'A', 100n, null), campanha('b', 'B', 200n, 4)])
    expect(saida).toEqual([{ tipo: 'outras', quantidade: 2, resultado: null }])
  })

  it('o total exibido é a soma das linhas visíveis, e o rótulo diz quando há balde sem valor', () => {
    const saida = agruparCampanhasComSupressao([
      campanha('g', 'Grande', 500000n, 12),
      campanha('b', 'Botox setembro', 120000n, 1),
    ])
    expect(totalDasCampanhasExibidas(saida)).toEqual({ total: Dinheiro.deCentavos(500000n), soDasExibidas: true })
  })

  it('property-based (T-8): nenhum número exibido, nem por subtração, isola uma campanha suprimida', () => {
    const arbCampanha = fc.record({
      id: fc.uuid(),
      nome: fc.string({ minLength: 1, maxLength: 20 }),
      centavos: fc.bigInt({ min: 0n, max: 10n ** 9n }),
      orcamentosPagos: fc.option(fc.integer({ min: 0, max: 12 }), { nil: null }),
    })
    fc.assert(
      fc.property(fc.array(arbCampanha, { maxLength: 30 }), (entradas) => {
        const campanhas = entradas.map((e) => campanha(e.id, e.nome, e.centavos, e.orcamentosPagos))
        const saida = agruparCampanhasComSupressao(campanhas)
        const suprimidas = campanhas.filter((c) => deveSuprimirCampanha(c.orcamentosPagos))
        const individuais = saida.filter((c) => c.tipo === 'individual')
        const outras = saida.filter((c) => c.tipo === 'outras')

        // (b) nenhuma individual abaixo de k; no máximo um balde, e ele só tem
        // valor quando a soma das contagens agrupadas chega a k.
        for (const c of individuais) {
          const origem = campanhas.find((x) => x.id === c.id)!
          expect(deveSuprimirCampanha(origem.orcamentosPagos)).toBe(false)
        }
        expect(outras.length).toBe(suprimidas.length > 0 ? 1 : 0)
        const balde = outras[0]
        const somaContagens = suprimidas.reduce((acc, c) => acc + (c.orcamentosPagos ?? 0), 0)
        if (balde !== undefined) {
          expect(balde.quantidade).toBe(suprimidas.length)
          expect(balde.resultado === null).toBe(somaContagens < LIMIAR_ORCAMENTOS_PAGOS)
          // Balde de uma campanha só NUNCA tem valor: seria a própria célula.
          if (suprimidas.length === 1) expect(balde.resultado).toBeNull()
        }

        // (a) com o balde exibido, a saída soma exatamente a entrada.
        const somaEntrada = campanhas.reduce((acc, c) => acc.mais(c.resultado), Dinheiro.zero())
        const somaIndividuais = individuais.reduce((acc, c) => acc.mais(c.resultado), Dinheiro.zero())
        const { total, soDasExibidas } = totalDasCampanhasExibidas(saida)
        if (balde === undefined || balde.resultado !== null) {
          expect(total.centavos).toBe(somaEntrada.centavos)
          expect(soDasExibidas).toBe(false)
        } else {
          expect(soDasExibidas).toBe(true)
        }

        // (c) total exibido menos as linhas visíveis: zero, ou o próprio balde
        // exibido (que agrega >= k). Nunca o valor de uma célula suprimida.
        const resto = total.centavos - somaIndividuais.centavos
        const baldeExibido = balde?.resultado ?? null
        expect(resto).toBe(baldeExibido === null ? 0n : baldeExibido.centavos)
      }),
      { numRuns: 500 },
    )
  })
})
