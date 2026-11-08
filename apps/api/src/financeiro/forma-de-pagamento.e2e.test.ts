import { FORMA_NAO_INFORMADA } from '@fir/domain'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  type Cenario,
  desmontarCenario,
  HOJE,
  limparFinanceiro,
  limparTarefas,
  montarCenario,
  pegar,
  postar,
  remendar,
} from '../tarefas/__tests__/cenario'

/**
 * **FORMA DE PAGAMENTO NAS DESPESAS (ADR 0020)** — os e2e do gate, E1–E9.
 *
 * O que esta suíte prova contra o Postgres de verdade:
 *
 *  - "Pago por forma" é a MESMA partição de `despesasPagas`, pelo VALOR PAGO
 *    e pela DATA DO PAGAMENTO (não pelo vencimento);
 *  - toda linha do bloco é filtrável na lista, e o `total.valorPago` da lista
 *    bate centavo a centavo com a linha — inclusive "Não informada" e forma
 *    desconhecida gravada no banco;
 *  - o Paguei grava EXATAMENTE a forma recebida, nunca a prevista;
 *  - a renovação mensal copia a prevista e não a usada.
 */
let c: Cenario

const MES = '2026-10'
type Corpo = Record<string, unknown>
type Item = { id: string; descricao: string; valorPago: string | null; formaPagamento: string }
type Linha = { forma: string; valor: string }

const criar = (x: Corpo = {}, quem = 'beatriz') =>
  postar(
    c,
    '/v1/contas',
    {
      descricao: 'Conta',
      categoria: 'Ocupação',
      valor: '250000',
      vencimento: HOJE,
      fornecedor: '',
      responsavelId: c.pessoas['beatriz'],
      mensal: false,
      ...x,
    },
    quem,
  )

const pagar = (id: string, x: Corpo = {}, quem = 'beatriz') =>
  postar(c, `/v1/contas/${id}/pagar`, { em: HOJE, valor: '250000', ...x }, quem)

const listar = (consulta: Record<string, string> = {}, quem = 'beatriz') =>
  pegar(c, '/v1/contas', consulta, quem)

const visao = (mes = MES, quem = 'beatriz') => pegar(c, '/v1/visao-do-mes', { mes }, quem)

/**
 * Conta JÁ PAGA, inserida direto no banco. Existe para o que a API não deixa
 * fazer de propósito: pagamento com data FUTURA ao hoje fixo do cenário
 * (24/10 — a fronteira de 31/10 e 01/11), forma fora da lista ("TED", a
 * legada) e conta de OUTRA clínica.
 */
const inserirPaga = async (o: {
  descricao: string
  pagoEm: string
  valorPago: string
  forma: string
  clinica?: string
  responsavel?: string
}): Promise<string> => {
  const clinica = o.clinica ?? c.clinica
  const r = await c.migrate.query<{ id: string }>(
    `INSERT INTO contas_a_pagar
       (clinica_id, descricao, categoria, valor, vencimento, responsavel_id,
        pago_em, valor_pago, forma_pagamento, pago_por)
     VALUES ($1, $2, 'Ocupação', $4, $3::date, $5, $3::date, $4, $6, $5)
     RETURNING id`,
    [
      clinica,
      o.descricao,
      o.pagoEm,
      o.valorPago,
      o.responsavel ??
        (o.clinica === undefined
          ? c.pessoas['beatriz']
          : (
              await c.migrate.query<{ id: string }>(
                'SELECT id FROM pessoas WHERE clinica_id = $1 LIMIT 1',
                [clinica],
              )
            ).rows[0]!.id),
      o.forma,
    ],
  )
  return r.rows[0]!.id
}

const descricoes = (body: { itens: Item[] }): string[] => body.itens.map((x) => x.descricao).sort()

const somaDe = (linhas: readonly Linha[]): bigint =>
  linhas.reduce((s, l) => s + BigInt(l.valor), 0n)

beforeAll(async () => {
  c = await montarCenario('forma-despesa')
}, 60_000)

afterAll(async () => {
  await desmontarCenario(c)
})

beforeEach(async () => {
  await limparFinanceiro(c)
  await limparTarefas(c)
})

describe('E1 — o bloco conta pelo VALOR PAGO e pela DATA DO PAGAMENTO', () => {
  it('vence 30/09 R$ 980, pago 02/10 R$ 1.012 por Pix: outubro Pix 1.012,00, setembro nada', async () => {
    const a = await criar({ vencimento: '2026-09-30', valor: '98000' })
    const p = await pagar(a.body.id, { em: '2026-10-02', valor: '101200', formaPagamento: 'Pix' })
    expect(p.statusCode).toBe(201)

    const out = await visao('2026-10')
    expect(out.statusCode).toBe(200)
    expect(out.body.pagoPorForma).toEqual([{ forma: 'Pix', valor: '101200' }])
    expect(out.body.despesasPagas).toBe('101200')

    const set = await visao('2026-09')
    expect(set.body.pagoPorForma).toEqual([])
    expect(set.body.despesasPagas).toBe('0')
  })
})

describe('E2 — cada linha do bloco é a lista filtrada, com o MESMO total', () => {
  it('quantidade e total.valorPago iguais em toda linha, inclusive "Não informada"', async () => {
    // Pela API: Pix ×2, Boleto, Cartão de débito, e duas sem forma ('' e ausente).
    const pagas: [string, string | undefined][] = [
      ['70000', 'Pix'],
      ['33333', 'Pix'],
      ['120000', 'Boleto'],
      ['4599', 'Cartão de débito'],
      ['8000', ''],
      ['1501', undefined],
    ]
    for (const [valor, forma] of pagas) {
      const a = await criar({ valor })
      const corpo: Corpo = { valor, em: '2026-10-05' }
      if (forma !== undefined) corpo['formaPagamento'] = forma
      expect((await pagar(a.body.id, corpo)).statusCode).toBe(201)
    }
    // Forma legada fora da lista, direto no banco.
    await inserirPaga({ descricao: 'Legada', pagoEm: '2026-10-07', valorPago: '2222', forma: 'TED' })
    // Ruído que NÃO pode entrar: paga em setembro, e aberta prevista Pix.
    await inserirPaga({ descricao: 'Setembro', pagoEm: '2026-09-20', valorPago: '99900', forma: 'Pix' })
    await criar({ descricao: 'Aberta', formaPrevista: 'Pix' })

    const v = await visao()
    const linhas = v.body.pagoPorForma as Linha[]
    expect(linhas.map((l) => l.forma).sort()).toEqual(
      ['Boleto', 'Cartão de débito', FORMA_NAO_INFORMADA, 'Pix', 'TED'].sort(),
    )
    expect(somaDe(linhas)).toBe(BigInt(v.body.despesasPagas))

    const quantas: Record<string, number> = {
      Pix: 2,
      Boleto: 1,
      'Cartão de débito': 1,
      [FORMA_NAO_INFORMADA]: 2,
      TED: 1,
    }
    for (const l of linhas) {
      const r = await listar({ situacao: 'pagas', mes: MES, forma: l.forma })
      expect(r.statusCode, l.forma).toBe(200)
      expect((r.body.itens as Item[]).length, l.forma).toBe(quantas[l.forma])
      expect(r.body.total, l.forma).toEqual({ valorPago: l.valor })
    }
    // Ordem: valor decrescente.
    expect(linhas[0]).toEqual({ forma: 'Boleto', valor: '120000' })
  })

  it('o total só vem em `situacao=pagas`', async () => {
    const a = await criar()
    await pagar(a.body.id, { formaPagamento: 'Pix' })
    expect((await listar({ situacao: 'pagas' })).body.total).toEqual({ valorPago: '250000' })
    expect((await listar({ situacao: 'todas' })).body.total).toBeUndefined()
    expect((await listar({ situacao: 'abertas' })).body.total).toBeUndefined()
  })

  it('sem `valores`, o total sai redigido pelo interceptor central', async () => {
    const a = await criar({ responsavelId: c.pessoas['sonia'], valor: '123400' })
    await pagar(a.body.id, { valor: '123400', formaPagamento: 'Pix' }, 'sonia')
    const r = await listar({ situacao: 'pagas', forma: 'Pix' }, 'sonia')
    expect(r.statusCode).toBe(200)
    expect(r.body.itens).toHaveLength(1)
    expect(r.body.total).toEqual({ valorPago: null })
    expect(r.text).not.toContain('123400')
  })
})

describe('E3 — `finmes` sem `contas.gerir`: a lista não alcança as contas alheias', () => {
  it('o bloco conta a clínica inteira; a lista filtrada, só as da pessoa', async () => {
    // **O COMPORTAMENTO, documentado:** com `finmes` + `valores` + `contas` e
    // SEM `contas.gerir`, a Visão do mês soma TODAS as contas pagas da
    // clínica (é o resultado do mês), enquanto `GET /v1/contas` aplica o
    // alcance e traz só as contas em que a pessoa é responsável. O total da
    // lista fica MENOR que a linha do bloco — e é exatamente por isso que a
    // tela só deixa tocar na linha com `contas.gerir` (ADR 0020, decisão 5).
    await c.migrate.query(
      `UPDATE perfis SET perms = ARRAY['pacientes','contas','finmes','valores']
        WHERE clinica_id = $1 AND chave = 'pf_cxa'`,
      [c.clinica],
    )
    try {
      await inserirPaga({ descricao: 'Pró-labore', pagoEm: '2026-10-10', valorPago: '1500000', forma: 'Pix' })
      await inserirPaga({
        descricao: 'Da Sonia',
        pagoEm: '2026-10-11',
        valorPago: '20000',
        forma: 'Pix',
        responsavel: c.pessoas['sonia']!,
      })

      const v = await visao(MES, 'sonia')
      expect(v.statusCode).toBe(200)
      expect(v.body.pagoPorForma).toEqual([{ forma: 'Pix', valor: '1520000' }])

      const r = await listar({ situacao: 'pagas', mes: MES, forma: 'Pix' }, 'sonia')
      expect(r.statusCode).toBe(200)
      expect(descricoes(r.body)).toEqual(['Da Sonia'])
      expect(r.body.total).toEqual({ valorPago: '20000' })
      expect(r.text).not.toContain('Pró-labore')
      expect(r.text).not.toContain('1500000')
    } finally {
      await c.migrate.query(
        `UPDATE perfis SET perms = ARRAY['pacientes','receber','caixa','contas','cobrancas']
          WHERE clinica_id = $1 AND chave = 'pf_cxa'`,
        [c.clinica],
      )
    }
  })
})

describe('E4 — o Paguei grava EXATAMENTE a forma recebida, nunca a prevista', () => {
  const gravada = async (id: string): Promise<string> =>
    (
      await c.migrate.query<{ f: string }>(
        'SELECT forma_pagamento AS f FROM contas_a_pagar WHERE id = $1',
        [id],
      )
    ).rows[0]!.f

  it('forma explícita grava a forma — prevista Boleto, pago por Pix, fica Pix', async () => {
    const a = await criar({ formaPrevista: 'Boleto' })
    expect(a.body.formaPrevista).toBe('Boleto')
    const p = await pagar(a.body.id, { formaPagamento: 'Pix' })
    expect(p.body.conta.formaPagamento).toBe('Pix')
    expect(p.body.conta.formaPrevista).toBe('Boleto')
    expect(p.body.conta.pagoPor).toBe('Beatriz')
    expect(await gravada(a.body.id)).toBe('Pix')
  })

  it("'' explícito grava ''", async () => {
    const a = await criar({ formaPrevista: 'Boleto' })
    await pagar(a.body.id, { formaPagamento: '' })
    expect(await gravada(a.body.id)).toBe('')
  })

  it("AUSENTE grava '' — MESMO com prevista Boleto (sem fallback)", async () => {
    const a = await criar({ formaPrevista: 'Boleto' })
    const p = await pagar(a.body.id)
    expect(p.statusCode).toBe(201)
    expect(p.body.conta.formaPagamento).toBe('')
    expect(await gravada(a.body.id)).toBe('')
  })

  it('a conta aberta não tem quem pagou', async () => {
    const a = await criar()
    expect(a.body.pagoPor).toBeNull()
  })

  it('a prevista sai da lista e é editável; fora da lista é 400', async () => {
    const a = await criar({ formaPrevista: 'Boleto' })
    const e = await remendar(
      c,
      `/v1/contas/${a.body.id}`,
      {
        descricao: 'Conta',
        categoria: 'Ocupação',
        valor: '250000',
        vencimento: HOJE,
        responsavelId: c.pessoas['beatriz'],
        formaPrevista: 'Cartão de débito',
      },
      'beatriz',
    )
    expect(e.statusCode).toBe(200)
    expect(e.body.formaPrevista).toBe('Cartão de débito')
    expect((await criar({ formaPrevista: 'TED' })).statusCode).toBe(400)
    // Sem o campo, nasce não prevista.
    expect((await criar()).body.formaPrevista).toBe('')
  })
})

describe('E5 — a renovação mensal copia a PREVISTA, não a usada', () => {
  const contarDaSerie = async (contaId: string): Promise<number> => {
    const r = await c.migrate.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM contas_a_pagar
        WHERE excluida_em IS NULL
          AND serie_id = (SELECT serie_id FROM contas_a_pagar WHERE id = $1)`,
      [contaId],
    )
    return Number(r.rows[0]!.n)
  }

  it('prevista Boleto paga por Pix: a próxima nasce prevista Boleto e sem forma usada', async () => {
    const a = await criar({ vencimento: '2026-10-10', mensal: true, formaPrevista: 'Boleto' })
    const p = await pagar(a.body.id, { formaPagamento: 'Pix' })
    expect(p.body.proxima.formaPrevista).toBe('Boleto')
    expect(p.body.proxima.formaPagamento).toBe('')
    expect(p.body.proxima.pagoPor).toBeNull()

    const cru = await c.migrate.query<{ prev: string; usada: string }>(
      'SELECT forma_prevista AS prev, forma_pagamento AS usada FROM contas_a_pagar WHERE id = $1',
      [p.body.proxima.id],
    )
    expect(cru.rows[0]).toEqual({ prev: 'Boleto', usada: '' })
  })

  it('pagar duas vezes gera UMA próxima', async () => {
    const a = await criar({ vencimento: '2026-10-10', mensal: true, formaPrevista: 'Boleto' })
    await pagar(a.body.id, { formaPagamento: 'Pix' })
    expect((await pagar(a.body.id, { formaPagamento: 'Pix' })).statusCode).toBe(409)
    expect(await contarDaSerie(a.body.id)).toBe(2)
  })

  it('a âncora 31/01 → 28/02 → 31/03 preserva a prevista', async () => {
    const a = await criar({ vencimento: '2027-01-31', mensal: true, formaPrevista: 'Boleto' })
    const p1 = await pagar(a.body.id, { formaPagamento: 'Pix' })
    expect(p1.body.proxima.vencimento).toBe('2027-02-28')
    expect(p1.body.proxima.formaPrevista).toBe('Boleto')
    const p2 = await pagar(p1.body.proxima.id)
    expect(p2.body.proxima.vencimento).toBe('2027-03-31')
    expect(p2.body.proxima.formaPrevista).toBe('Boleto')
  })
})

describe('E6 — o filtro olha a forma USADA na paga e a PREVISTA na aberta', () => {
  it('A prevista Boleto paga Pix; B aberta prevista Pix', async () => {
    const a = await criar({ descricao: 'A', formaPrevista: 'Boleto', valor: '11100' })
    await pagar(a.body.id, { formaPagamento: 'Pix', valor: '11100' })
    await criar({ descricao: 'B', formaPrevista: 'Pix' })

    expect(descricoes((await listar({ situacao: 'todas', mes: MES, forma: 'Pix' })).body)).toEqual([
      'A',
      'B',
    ])
    expect((await listar({ situacao: 'todas', mes: MES, forma: 'Boleto' })).body.itens).toEqual([])

    const pagas = await listar({ situacao: 'pagas', mes: MES, forma: 'Pix' })
    expect(descricoes(pagas.body)).toEqual(['A'])
    expect(pagas.body.total).toEqual({ valorPago: '11100' })

    expect(descricoes((await listar({ situacao: 'abertas', forma: 'Pix' })).body)).toEqual(['B'])
  })

  it('forma vazia ou acima de 30 é 400', async () => {
    expect((await listar({ forma: '' })).statusCode).toBe(400)
    expect((await listar({ forma: 'x'.repeat(31) })).statusCode).toBe(400)
  })
})

describe('E7 — forma desconhecida gravada no banco', () => {
  it("'TED' ganha linha própria, a soma fica intacta, e o filtro a acha", async () => {
    await inserirPaga({ descricao: 'Ted', pagoEm: '2026-10-03', valorPago: '5000', forma: 'TED' })
    await inserirPaga({ descricao: 'Pix', pagoEm: '2026-10-04', valorPago: '10000', forma: 'Pix' })

    const v = await visao()
    expect(v.body.pagoPorForma).toEqual([
      { forma: 'Pix', valor: '10000' },
      { forma: 'TED', valor: '5000' },
    ])
    expect(somaDe(v.body.pagoPorForma)).toBe(BigInt(v.body.despesasPagas))
    expect(v.body.despesasPagas).toBe('15000')

    const r = await listar({ situacao: 'pagas', mes: MES, forma: 'TED' })
    expect(descricoes(r.body)).toEqual(['Ted'])
    expect(r.body.total).toEqual({ valorPago: '5000' })
    // A linha volta com a forma GRAVADA, sem o enum recusá-la na saída.
    expect((r.body.itens as Item[])[0]!.formaPagamento).toBe('TED')
  })
})

describe('E8 — a fronteira do mês, no bloco e na lista', () => {
  it('01/10 e 31/10 entram; 30/09 e 01/11 não', async () => {
    await inserirPaga({ descricao: '30-09', pagoEm: '2026-09-30', valorPago: '100', forma: 'Pix' })
    await inserirPaga({ descricao: '01-10', pagoEm: '2026-10-01', valorPago: '2000', forma: 'Pix' })
    await inserirPaga({ descricao: '31-10', pagoEm: '2026-10-31', valorPago: '30000', forma: 'Pix' })
    await inserirPaga({ descricao: '01-11', pagoEm: '2026-11-01', valorPago: '400000', forma: 'Pix' })

    const v = await visao()
    expect(v.body.pagoPorForma).toEqual([{ forma: 'Pix', valor: '32000' }])

    const r = await listar({ situacao: 'pagas', mes: MES, forma: 'Pix' })
    expect(descricoes(r.body)).toEqual(['01-10', '31-10'])
    expect(r.body.total).toEqual({ valorPago: '32000' })
  })
})

describe('E9 — isolamento entre clínicas', () => {
  it('a conta paga da vizinha não entra no bloco nem no filtro', async () => {
    await inserirPaga({
      descricao: 'Segredo da vizinha',
      pagoEm: '2026-10-05',
      valorPago: '999900',
      forma: 'Pix',
      clinica: c.outraClinica,
    })
    await inserirPaga({ descricao: 'Nossa', pagoEm: '2026-10-05', valorPago: '1000', forma: 'Pix' })

    const v = await visao()
    expect(v.body.pagoPorForma).toEqual([{ forma: 'Pix', valor: '1000' }])
    expect(v.text).not.toContain('999900')

    const r = await listar({ situacao: 'pagas', mes: MES, forma: 'Pix' })
    expect(descricoes(r.body)).toEqual(['Nossa'])
    expect(r.body.total).toEqual({ valorPago: '1000' })
    expect(r.text).not.toContain('Segredo da vizinha')
  })
})
