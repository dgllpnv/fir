import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  formatarRetorno,
  mesesEntre,
  periodoDeCampanhas,
  resumirCampanhas,
  retornoEmDecimos,
  suprimirCampanhas,
  K_CAMPANHAS,
  type CelulaDeCampanha,
  type ResumoDeCampanhas,
  type SupressaoDeCampanhas,
} from './campanhas-carteira'
import { Dinheiro } from './dinheiro'
import { ehErro, exigir } from './resultado'

const R = (c: bigint) => Dinheiro.deCentavos(c)

const base = (sobre: Partial<CelulaDeCampanha> & { id: string }): CelulaDeCampanha => ({
  clienteId: 'cli-1',
  campanhaChave: sobre.id,
  nome: `Campanha ${sobre.id}`,
  tipo: 'Aniversariantes',
  mes: '2026-10-01',
  status: 'ativa',
  receita: R(0n),
  investimento: null,
  orcamentosPagos: 10,
  exigeContagem: true,
  resultado: null,
  meta: null,
  resultadoEmDinheiro: false,
  ...sobre,
})

const PERIODO = { de: '2026-08-01', ate: '2026-10-01', mesAtual: '2026-10-01', mesAnterior: '2026-09-01' }

/**
 * Tudo o que a tela recebe, numa forma comparável. A propriedade (c) compara
 * DUAS execuções por igualdade profunda — então tudo o que vai para a tela
 * precisa estar aqui, e nada que não vai.
 */
function oQueATelaVe(s: SupressaoDeCampanhas, r: ResumoDeCampanhas): string {
  return JSON.stringify({ s, r }, (_k, v: unknown) =>
    v instanceof Dinheiro ? `R$${v.centavos}` : typeof v === 'bigint' ? `${v}n` : v,
  )
}

// ---------------------------------------------------------------------------
// Geradores
// ---------------------------------------------------------------------------
const MESES = ['2026-07-01', '2026-08-01', '2026-09-01', '2026-10-01', '2026-11-01'] as const
const celulaArb = (i: number) =>
  fc.record({
    clienteId: fc.constantFrom('cli-1', 'cli-2', 'cli-3'),
    campanhaChave: fc.constantFrom('a', 'b', 'c', 'd'),
    tipo: fc.constantFrom('Aniversariantes', 'Botox', 'Retorno'),
    mes: fc.constantFrom(...MESES),
    status: fc.constantFrom('planejada' as const, 'ativa' as const, 'encerrada' as const),
    receita: fc.option(fc.bigInt({ min: 0n, max: 10_000_000n }).map(R), { nil: null }),
    investimento: fc.option(fc.bigInt({ min: 0n, max: 2_000_000n }).map(R), { nil: null }),
    orcamentosPagos: fc.option(fc.integer({ min: 0, max: 12 }), { nil: null }),
    exigeContagem: fc.boolean(),
    resultado: fc.option(fc.bigInt({ min: 0n, max: 500n }), { nil: null }),
    meta: fc.option(fc.bigInt({ min: 1n, max: 500n }), { nil: null }),
  }).map((c): CelulaDeCampanha => ({
    ...c,
    id: `cel-${i}`,
    nome: `Campanha ${c.campanhaChave}`,
    resultadoEmDinheiro: false,
  }))

const listaArb = fc
  .integer({ min: 0, max: 14 })
  .chain((n) => fc.tuple(...Array.from({ length: n }, (_, i) => celulaArb(i))))

const ehSuprimida = (c: CelulaDeCampanha, k = K_CAMPANHAS) =>
  c.exigeContagem && (c.orcamentosPagos === null || c.orcamentosPagos < k)

// ---------------------------------------------------------------------------
// T-8 / LGPD A21–A23 — a supressão
// ---------------------------------------------------------------------------
describe('suprimirCampanhas — o k vale na célula exibida (LGPD A21)', () => {
  it('CE-3: uma campanha pequena sozinha NÃO vira "Outras campanhas (1)" com o próprio valor', () => {
    const s = suprimirCampanhas([
      base({ id: 'grande', nome: 'Grande', orcamentosPagos: 12, receita: R(500000n) }),
      base({ id: 'botox', nome: 'Botox setembro', orcamentosPagos: 1, receita: R(120000n) }),
    ])
    const r = resumirCampanhas(s, PERIODO)
    const tela = oQueATelaVe(s, r)
    expect(tela).not.toContain('120000')
    expect(tela).not.toContain('620000') // o total com ela dentro também a revelaria por subtração
    expect(r.outras).toEqual({ quantidade: 1 })
    expect(r.periodo.valorGerado.centavos).toBe(500000n)
    expect(r.soDasExibidas).toBe(true)
  })

  it('com complemento: duas pequenas que somam k também ficam sem valor — o balde nunca leva valor', () => {
    // Dar valor ao balde quando a soma chega a k abre a diferença entre
    // requisições: o balde de 3 meses menos o de 6 meses isola a célula que
    // entrou. Sem valor no balde, a saída só depende de células visíveis.
    const s = suprimirCampanhas([
      base({ id: 'grande', orcamentosPagos: 7, receita: R(900000n) }),
      base({ id: 'p1', orcamentosPagos: 3, receita: R(30000n) }),
      base({ id: 'p2', orcamentosPagos: 2, receita: R(45000n) }),
    ])
    const r = resumirCampanhas(s, PERIODO)
    const tela = oQueATelaVe(s, r)
    expect(tela).not.toMatch(/R\$(30000|45000|75000|930000|945000|975000)\b/)
    expect(r.outras).toEqual({ quantidade: 2 })
    expect(r.periodo.valorGerado.centavos).toBe(900000n)
  })

  it('derivados seguem a receita (A23): suprimida não tem resultado, % da meta nem retorno', () => {
    const s = suprimirCampanhas([
      base({
        id: 'p',
        orcamentosPagos: 2,
        receita: R(120000n),
        investimento: R(40000n),
        resultado: 3n,
        meta: 10n,
      }),
    ])
    const c = s.celulas[0]!
    expect(c.suprimida).toBe(true)
    expect(c).not.toHaveProperty('receita')
    expect(c).not.toHaveProperty('resultado')
    expect(c).not.toHaveProperty('retornoEmDecimos')
    expect(c).not.toHaveProperty('percentualDaMeta')
    expect(c).not.toHaveProperty('orcamentosPagos')
    // O retorno do período também não a inclui: retorno × investimento
    // devolveria a receita.
    const r = resumirCampanhas(s, PERIODO)
    expect(r.periodo.retornoEmDecimos).toBeNull()
    expect(r.periodo.investimento.centavos).toBe(0n)
  })

  it('contagem desconhecida (null) suprime — a leitura segura esconde', () => {
    const s = suprimirCampanhas([base({ id: 'x', orcamentosPagos: null, receita: R(100n) })])
    expect(s.celulas[0]!.suprimida).toBe(true)
  })

  it('cliente sem paciente por trás (exigeContagem = false) nunca é suprimido (A24)', () => {
    const s = suprimirCampanhas([base({ id: 'x', orcamentosPagos: null, exigeContagem: false, receita: R(100n) })])
    expect(s.celulas[0]!.suprimida).toBe(false)
  })

  it('(b) nenhuma célula exibida está abaixo de k quando exige contagem', () => {
    fc.assert(
      fc.property(listaArb, (lista) => {
        const s = suprimirCampanhas(lista)
        for (const c of s.celulas) {
          if (c.suprimida) continue
          const original = lista.find((x) => x.id === c.id)!
          expect(ehSuprimida(original)).toBe(false)
        }
      }),
    )
  })

  it('contabilidade: toda célula de entrada sai exatamente uma vez, exibida ou suprimida', () => {
    fc.assert(
      fc.property(listaArb, (lista) => {
        const s = suprimirCampanhas(lista)
        expect(s.celulas.map((c) => c.id).sort()).toEqual(lista.map((c) => c.id).sort())
        expect(s.suprimidas).toBe(lista.filter((c) => ehSuprimida(c)).length)
      }),
    )
  })

  it('(c) NENHUM número exibido depende do valor de uma célula suprimida — logo nenhuma subtração a isola', () => {
    // A forma forte do invariante do gate: trocar à vontade a receita, o
    // resultado e a contagem (ainda abaixo de k) das células suprimidas não
    // muda UM caractere do que a tela recebe. Se total − linhas visíveis
    // devolvesse uma célula suprimida, mudar essa célula mudaria o total.
    fc.assert(
      fc.property(
        listaArb,
        fc.array(fc.bigInt({ min: 0n, max: 10_000_000n }), { minLength: 14, maxLength: 14 }),
        fc.array(fc.option(fc.integer({ min: 0, max: K_CAMPANHAS - 1 }), { nil: null }), {
          minLength: 14,
          maxLength: 14,
        }),
        (lista, novasReceitas, novasContagens) => {
          const perturbada = lista.map((c, i) =>
            ehSuprimida(c)
              ? {
                  ...c,
                  receita: R(novasReceitas[i]!),
                  resultado: novasReceitas[i]! % 97n,
                  orcamentosPagos: novasContagens[i]!,
                }
              : c,
          )
          const a = suprimirCampanhas(lista)
          const b = suprimirCampanhas(perturbada)
          expect(oQueATelaVe(b, resumirCampanhas(b, PERIODO))).toBe(oQueATelaVe(a, resumirCampanhas(a, PERIODO)))
        },
      ),
    )
  })

  it('os totais fecham com as linhas exibidas (A22): período = Σ clientes = Σ meses; tipos = clientes, mês a mês', () => {
    fc.assert(
      fc.property(listaArb, (lista) => {
        const s = suprimirCampanhas(lista)
        const r = resumirCampanhas(s, PERIODO)
        const soma = (xs: readonly Dinheiro[]) => xs.reduce((a, b) => a.mais(b), Dinheiro.zero()).centavos

        expect(soma(r.porCliente.map((c) => c.valorGerado))).toBe(r.periodo.valorGerado.centavos)
        for (const c of r.porCliente) expect(soma(c.meses.map((m) => m.valorGerado))).toBe(c.valorGerado.centavos)
        for (const [i, mes] of r.meses.entries()) {
          const porCliente = soma(r.porCliente.map((c) => c.meses[i]!.valorGerado))
          const porTipo = soma(r.porTipo.map((t) => t.meses[i]!.valorGerado))
          expect(porTipo, mes).toBe(porCliente)
        }
        // O período é exatamente a soma das exibidas dentro dele.
        const esperado = s.celulas
          .filter((c) => !c.suprimida && c.mes >= PERIODO.de && c.mes <= PERIODO.ate)
          .reduce((a, c) => a + (c.suprimida ? 0n : (c.receita?.centavos ?? 0n)), 0n)
        expect(r.periodo.valorGerado.centavos).toBe(esperado)
        expect(r.soDasExibidas).toBe(r.outras.quantidade > 0)
      }),
    )
  })

  it('"mais geraram" tem no máximo 6, só exibidas com valor, em ordem decrescente', () => {
    fc.assert(
      fc.property(listaArb, (lista) => {
        const r = resumirCampanhas(suprimirCampanhas(lista), PERIODO)
        expect(r.maisGeraram.length).toBeLessThanOrEqual(6)
        for (const x of r.maisGeraram) {
          expect(ehSuprimida(lista.find((c) => c.id === x.id)!)).toBe(false)
          expect(x.valorGerado.centavos > 0n).toBe(true)
        }
        for (let i = 1; i < r.maisGeraram.length; i++) {
          expect(r.maisGeraram[i - 1]!.valorGerado.centavos >= r.maisGeraram[i]!.valorGerado.centavos).toBe(true)
        }
      }),
    )
  })

  it('campanhas ativas contam CAMPANHAS (chave), não células de mês', () => {
    const s = suprimirCampanhas([
      base({ id: '1', campanhaChave: 'outubro-rosa', mes: '2026-09-01' }),
      base({ id: '2', campanhaChave: 'outubro-rosa', mes: '2026-10-01' }),
      base({ id: '3', campanhaChave: 'botox', status: 'encerrada' }),
    ])
    expect(resumirCampanhas(s, PERIODO).ativas).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// T-9 / ajuste 28 — retorno = total ÷ investimento, em décimos
// ---------------------------------------------------------------------------
describe('retornoEmDecimos', () => {
  it('investimento nulo ou zero dá null ("—")', () => {
    expect(retornoEmDecimos(R(100n), null)).toBeNull()
    expect(retornoEmDecimos(R(100n), R(0n))).toBeNull()
    expect(retornoEmDecimos(null, R(10n))).toBeNull()
  })

  it('está a menos de meio décimo de r/i (verificação racional, sem ponto flutuante)', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: 10n ** 12n }), fc.bigInt({ min: 1n, max: 10n ** 10n }), (r, i) => {
        const d = retornoEmDecimos(R(r), R(i))!
        const dif = 10n * r - d * i
        expect(2n * (dif < 0n ? -dif : dif) <= i).toBe(true)
      }),
    )
  })

  it('meio para cima: 25 ÷ 10 = 2,5x; 1 ÷ 4 = 0,25 → 0,3x', () => {
    expect(retornoEmDecimos(R(25n), R(10n))).toBe(25n)
    expect(retornoEmDecimos(R(1n), R(4n))).toBe(3n)
  })

  it('formata como o protótipo (L1477): uma casa, sem ",0", com milhar', () => {
    expect(formatarRetorno(32n)).toBe('3,2x')
    expect(formatarRetorno(30n)).toBe('3x')
    expect(formatarRetorno(0n)).toBe('0x')
    expect(formatarRetorno(12345n)).toBe('1.234,5x')
  })
})

// ---------------------------------------------------------------------------
// K2 / ajuste 29 — o período
// ---------------------------------------------------------------------------
describe('periodoDeCampanhas', () => {
  const HOJE = '2026-11-08'
  it('este mês, 3, 6 e 12 meses, este ano', () => {
    expect(exigir(periodoDeCampanhas('mes', HOJE))).toMatchObject({ de: '2026-11-01', ate: '2026-11-01' })
    expect(exigir(periodoDeCampanhas('3m', HOJE))).toMatchObject({ de: '2026-09-01', ate: '2026-11-01' })
    expect(exigir(periodoDeCampanhas('6m', HOJE))).toMatchObject({ de: '2026-06-01', ate: '2026-11-01' })
    expect(exigir(periodoDeCampanhas('12m', HOJE))).toMatchObject({ de: '2025-12-01', ate: '2026-11-01' })
    expect(exigir(periodoDeCampanhas('ano', HOJE))).toMatchObject({ de: '2026-01-01', ate: '2026-11-01' })
  })

  it('3 meses atravessando o ano', () => {
    expect(exigir(periodoDeCampanhas('3m', '2027-01-31'))).toMatchObject({ de: '2026-11-01', ate: '2027-01-01' })
  })

  it('escolher: de-até por mês, invertido é desinvertido (L1467)', () => {
    expect(exigir(periodoDeCampanhas('custom', HOJE, { de: '2026-10', ate: '2026-07' }))).toMatchObject({
      de: '2026-07-01',
      ate: '2026-10-01',
      meses: ['2026-07-01', '2026-08-01', '2026-09-01', '2026-10-01'],
    })
  })

  it('escolher sem as duas pontas é erro de entrada; janela acima de 60 meses também', () => {
    expect(ehErro(periodoDeCampanhas('custom', HOJE, { de: '2026-10' }))).toBe(true)
    expect(ehErro(periodoDeCampanhas('custom', HOJE, { de: '2000-01', ate: '2026-10' }))).toBe(true)
  })

  it('ciclo do contrato vai do início até min(fim, mês corrente); sem início cai em 3 meses (L1445)', () => {
    expect(
      exigir(periodoDeCampanhas('ciclo', HOJE, { inicioDoContrato: '2026-03-15', fimDoContrato: '2027-03-14' })),
    ).toMatchObject({ de: '2026-03-01', ate: '2026-11-01' })
    expect(
      exigir(periodoDeCampanhas('ciclo', HOJE, { inicioDoContrato: '2026-03-15', fimDoContrato: '2026-06-30' })),
    ).toMatchObject({ de: '2026-03-01', ate: '2026-06-01' })
    expect(exigir(periodoDeCampanhas('ciclo', HOJE))).toMatchObject({ de: '2026-09-01', ate: '2026-11-01' })
  })

  it('mesesEntre: contíguos, do primeiro ao último, sempre dia 1', () => {
    fc.assert(
      fc.property(fc.integer({ min: 2000, max: 2100 }), fc.integer({ min: 1, max: 12 }), fc.integer({ min: 0, max: 40 }), (a, m, n) => {
        const de = `${a}-${String(m).padStart(2, '0')}-01`
        const ms = mesesEntre(de, exigir(periodoDeCampanhas('custom', `${a}-01-01`, { de: de.slice(0, 7), ate: de.slice(0, 7) })).ate)
        expect(ms).toEqual([de])
        const lista = mesesEntre(de, somarMeses(de, n))
        expect(lista.length).toBe(n + 1)
        expect(lista[0]).toBe(de)
        for (const x of lista) expect(x.endsWith('-01')).toBe(true)
      }),
    )
  })
})

function somarMeses(mes: string, n: number): string {
  const total = Number(mes.slice(0, 4)) * 12 + Number(mes.slice(5, 7)) - 1 + n
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}-01`
}
