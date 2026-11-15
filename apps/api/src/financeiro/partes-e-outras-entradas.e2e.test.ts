import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  apagar,
  type Cenario,
  desmontarCenario,
  HOJE,
  limparFinanceiro,
  limparTarefas,
  montarCenario,
  ONTEM,
  pegar,
  postar,
  receitaDoDia,
} from '../tarefas/__tests__/cenario'
import { reiniciarLimiteDeEscritaDeEntradas } from './limite-de-escrita-de-entradas.guard'

/**
 * FATIA 4 — partes do pagamento (4.1) e outras entradas (4.2), ponta a ponta,
 * contra Postgres real.
 */
let c: Cenario

beforeAll(async () => {
  c = await montarCenario('partes')
}, 60_000)
afterAll(async () => {
  await desmontarCenario(c)
})
beforeEach(async () => {
  reiniciarLimiteDeEscritaDeEntradas()
  await limparTarefas(c)
  await limparFinanceiro(c)
})

const avulso = (extra: Record<string, unknown>, quem = 'beatriz') =>
  postar(
    c,
    '/v1/recebimentos',
    {
      requisicaoId: randomUUID(),
      pacienteId: c.pacientes['ana'],
      em: HOJE,
      ref: 'consulta',
      ...extra,
    },
    quem,
  )

const PIX_E_DINHEIRO = [
  { forma: 'Pix', valor: '30000' },
  { forma: 'Dinheiro', valor: '20000' },
]

const partesNoBanco = async (recebimentoId: string) =>
  (
    await c.migrate.query<{ forma: string; valor: string }>(
      'SELECT forma, valor::text AS valor FROM recebimento_partes WHERE recebimento_id = $1 ORDER BY valor DESC',
      [recebimentoId],
    )
  ).rows

describe('4.1 - varias formas por recebimento', () => {
  it('receita-nao-dobra-com-partes: Pix 300 + Dinheiro 200 = UM recebimento de 500', async () => {
    const r = await avulso({ valor: '50000', partes: PIX_E_DINHEIRO })
    expect(r.statusCode, r.text).toBe(201)
    expect(await receitaDoDia(c)).toBe(50000n)
    const n = await c.migrate.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM recebimentos WHERE clinica_id = $1',
      [c.clinica],
    )
    expect(n.rows[0]!.n).toBe('1')
    expect(await partesNoBanco(r.body.id)).toEqual(PIX_E_DINHEIRO)
    // A forma legada e a da MAIOR parte, nunca 'Mista'.
    const legado = await c.migrate.query<{ forma: string }>(
      'SELECT forma FROM recebimentos WHERE id = $1',
      [r.body.id],
    )
    expect(legado.rows[0]!.forma).toBe('Pix')
  })

  it('a soma errada, a promissoria misturada e forma + partes juntos sao 400', async () => {
    expect((await avulso({ valor: '50000', partes: [PIX_E_DINHEIRO[0]] })).statusCode).toBe(400)
    expect(
      (
        await avulso({
          valor: '50000',
          partes: [
            { forma: 'Pix', valor: '30000' },
            { forma: 'Nota promissória', valor: '20000' },
          ],
        })
      ).statusCode,
    ).toBe(400)
    expect(
      (await avulso({ valor: '50000', forma: 'Pix', partes: PIX_E_DINHEIRO })).statusCode,
    ).toBe(400)
    expect(await receitaDoDia(c)).toBe(0n)
  })

  it('reenvio-com-requisicao-id 3x: um recebimento, duas partes; outras partes = 409', async () => {
    const requisicaoId = randomUUID()
    const ids = new Set<string>()
    for (let i = 0; i < 3; i++) {
      const r = await avulso({ requisicaoId, valor: '50000', partes: PIX_E_DINHEIRO })
      expect(r.statusCode, r.text).toBe(201)
      ids.add(r.body.id)
    }
    expect(ids.size).toBe(1)
    expect(await partesNoBanco([...ids][0]!)).toHaveLength(2)
    const outro = await avulso({
      requisicaoId,
      valor: '50000',
      partes: [
        { forma: 'Pix', valor: '10000' },
        { forma: 'Dinheiro', valor: '40000' },
      ],
    })
    expect(outro.statusCode).toBe(409)
  })

  it('caixa-por-forma-com-partes: o esperado vem POR PARTE, e o aberto nao traz numero', async () => {
    await avulso({ valor: '50000', partes: PIX_E_DINHEIRO })
    const aberto = await pegar(c, '/v1/caixa', { dia: HOJE }, 'beatriz')
    for (const n of ['30000', '20000', '50000']) expect(aberto.text).not.toContain(n)
    const r = await postar(
      c,
      '/v1/caixa',
      {
        dia: HOJE,
        obs: '',
        contado: [
          { forma: 'Pix', valor: '30000' },
          { forma: 'Dinheiro', valor: '20000' },
        ],
      },
      'beatriz',
    )
    expect(r.statusCode, r.text).toBe(201)
    expect(r.body.conferido).toBe(true)
    const pix = (r.body.porForma as { forma: string; esperado: string }[]).find(
      (l) => l.forma === 'Pix',
    )
    expect(pix?.esperado).toBe('30000')
  })

  it('estorno-zera-todas-as-partes: o avulso estornado sai de receita e de caixa', async () => {
    const r = await avulso({ valor: '50000', partes: PIX_E_DINHEIRO })
    expect((await apagar(c, `/v1/recebimentos/${r.body.id}`, {}, 'beatriz')).statusCode).toBe(204)
    expect(await receitaDoDia(c)).toBe(0n)
    const fecho = await postar(
      c,
      '/v1/caixa',
      { dia: HOJE, obs: '', contado: [{ forma: 'Pix', valor: '0' }] },
      'beatriz',
    )
    expect(fecho.statusCode, fecho.text).toBe(201)
    for (const l of fecho.body.porForma as { esperado: string }[]) expect(l.esperado).toBe('0')
    // Imutaveis; o estado e do pai.
    expect(await partesNoBanco(r.body.id)).toHaveLength(2)
  })

  it('a lista traz as partes; sem `valores` os valores somem e a forma nao', async () => {
    await avulso({ valor: '50000', partes: PIX_E_DINHEIRO })
    const rita = await pegar(c, '/v1/recebimentos', { dia: HOJE }, 'rita')
    expect(rita.statusCode).toBe(200)
    expect(rita.text).not.toContain('30000')
    expect(rita.text).not.toContain('50000')
    expect(rita.body.itens[0].partes).toHaveLength(2)
  })

  it('o banco recusa no COMMIT: soma errada, promissoria misturada, FK de outra clinica', async () => {
    const pac = c.pacientes['ana']!
    const inserir = async (
      valor: string,
      partes: [string, string][],
      clinicaDaParte = c.clinica,
    ) => {
      await c.migrate.query('BEGIN')
      try {
        const r = await c.migrate.query<{ id: string }>(
          `INSERT INTO recebimentos (clinica_id, paciente_id, tipo, valor, forma, recebido_em, registrado_por)
           VALUES ($1,$2,'Consulta realizada',$3,'Pix', now(), $4) RETURNING id`,
          [c.clinica, pac, valor, c.pessoas['juliana']],
        )
        for (const [forma, v] of partes) {
          await c.migrate.query(
            'INSERT INTO recebimento_partes (clinica_id, recebimento_id, forma, valor) VALUES ($1,$2,$3,$4)',
            [clinicaDaParte, r.rows[0]!.id, forma, v],
          )
        }
        await c.migrate.query('COMMIT')
      } catch (e) {
        await c.migrate.query('ROLLBACK')
        throw e
      }
    }
    await expect(
      inserir('500', [
        ['Pix', '300'],
        ['Dinheiro', '100'],
      ]),
    ).rejects.toThrow(/soma das partes/)
    await expect(
      inserir('500', [
        ['Pix', '300'],
        ['Nota promissória', '200'],
      ]),
    ).rejects.toThrow(/parte única/)
    await expect(inserir('500', [['Pix', '500']], c.outraClinica)).rejects.toThrow()
    await inserir('500', [['Pix', '500']])
    await expect(c.migrate.query('UPDATE recebimento_partes SET valor = 1')).rejects.toThrow(
      /imutável/,
    )
    await expect(c.migrate.query('DELETE FROM recebimento_partes')).rejects.toThrow(/imutável/)
  })

  it('forma-vazia-legada: o recebimento sem forma ganha a parte vazia e entra na receita', async () => {
    const r = await c.migrate.query<{ id: string }>(
      `INSERT INTO recebimentos (clinica_id, paciente_id, tipo, valor, forma, recebido_em, registrado_por)
       VALUES ($1,$2,'Consulta realizada',70000,'', '2026-10-24T15:00:00Z', $3) RETURNING id`,
      [c.clinica, c.pacientes['ana'], c.pessoas['juliana']],
    )
    expect(await partesNoBanco(r.rows[0]!.id)).toEqual([{ forma: '', valor: '70000' }])
    expect(await receitaDoDia(c)).toBe(70000n)
  })
})

describe('4.2 - outras entradas', () => {
  const categoria = async (nome = 'Aluguel de sala') => {
    const r = await postar(c, '/v1/categorias-de-entrada', { nome }, 'beatriz')
    expect(r.statusCode, r.text).toBe(201)
    return r.body.id as string
  }
  const lancar = (categoriaId: string, extra: Record<string, unknown> = {}, quem = 'beatriz') =>
    postar(
      c,
      '/v1/outras-entradas',
      {
        requisicaoId: randomUUID(),
        categoriaId,
        em: HOJE,
        valor: '7000',
        forma: 'Pix',
        descricao: 'Aluguel',
        ...extra,
      },
      quem,
    )

  it('lanca, fica FORA da receita, e o esperado do caixa a inclui', async () => {
    const cat = await categoria()
    expect((await lancar(cat)).statusCode).toBe(201)
    expect(await receitaDoDia(c)).toBe(0n)
    const fecho = await postar(
      c,
      '/v1/caixa',
      { dia: HOJE, obs: '', contado: [{ forma: 'Pix', valor: '7000' }] },
      'beatriz',
    )
    expect(fecho.statusCode, fecho.text).toBe(201)
    expect(fecho.body.conferido).toBe(true)
  })

  it('idempotencia 3x: a mesma requisicao grava uma vez', async () => {
    const cat = await categoria()
    const requisicaoId = randomUUID()
    const ids = new Set<string>()
    for (let i = 0; i < 3; i++) ids.add((await lancar(cat, { requisicaoId })).body.id)
    expect(ids.size).toBe(1)
    const n = await c.migrate.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM outras_entradas WHERE clinica_id = $1',
      [c.clinica],
    )
    expect(n.rows[0]!.n).toBe('1')
  })

  it('recusas: promissoria, futuro, descricao longa, sem permissao, categoria inativa', async () => {
    const cat = await categoria()
    expect((await lancar(cat, { forma: 'Nota promissória' })).statusCode).toBe(400)
    expect((await lancar(cat, { em: '2026-10-25' })).statusCode).toBe(400)
    expect((await lancar(cat, { descricao: 'x'.repeat(121) })).statusCode).toBe(400)
    expect((await lancar(cat, {}, 'juliana')).statusCode).toBe(403)
    expect(
      (await postar(c, '/v1/categorias-de-entrada', { nome: 'Outra' }, 'rita')).statusCode,
    ).toBe(403)
    expect((await lancar(cat, {}, 'rita')).statusCode).toBe(201)
    await c.migrate.query('UPDATE categorias_de_entrada SET ativa = false WHERE id = $1', [cat])
    expect((await lancar(cat)).statusCode).toBe(409)
  })

  it('redacao: sem `valores` o valor some da lista e do corpo do POST', async () => {
    const cat = await categoria()
    const r = await lancar(cat, { valor: '12345' }, 'rita')
    expect(r.statusCode).toBe(201)
    expect(r.text).not.toContain('12345')
    const lista = await pegar(c, '/v1/outras-entradas', { dia: HOJE }, 'rita')
    expect(lista.text).not.toContain('12345')
    expect(lista.body.itens).toHaveLength(1)
  })

  it('estorno por marca: sai da lista; o segundo estorno e 409; a linha fica', async () => {
    const cat = await categoria()
    const e = await lancar(cat)
    expect((await apagar(c, `/v1/outras-entradas/${e.body.id}`, {}, 'beatriz')).statusCode).toBe(204)
    expect((await apagar(c, `/v1/outras-entradas/${e.body.id}`, {}, 'beatriz')).statusCode).toBe(409)
    expect((await pegar(c, '/v1/outras-entradas', { dia: HOJE }, 'beatriz')).body.itens).toHaveLength(0)
    const n = await c.migrate.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM outras_entradas WHERE id = $1',
      [e.body.id],
    )
    expect(n.rows[0]!.n).toBe('1')
  })

  it('caixa fechado: 409 de confirmacao, e confirmada acende `mudouDepoisDoFechamento`', async () => {
    const cat = await categoria()
    await postar(
      c,
      '/v1/caixa',
      { dia: HOJE, obs: '', contado: [{ forma: 'Pix', valor: '0' }] },
      'beatriz',
    )
    expect((await lancar(cat)).statusCode).toBe(409)
    expect((await lancar(cat, { confirmarCaixaFechado: true })).statusCode).toBe(201)
    const dia = await pegar(c, '/v1/caixa', { dia: HOJE }, 'beatriz')
    expect(dia.body.mudouDepoisDoFechamento).toBe(true)
  })

  it('o mes da lista e no fuso da clinica: ontem entra em outubro e nao em setembro', async () => {
    const cat = await categoria()
    await lancar(cat, { em: ONTEM })
    const out = await pegar(c, '/v1/outras-entradas', { mes: '2026-10' }, 'beatriz')
    const set = await pegar(c, '/v1/outras-entradas', { mes: '2026-09' }, 'beatriz')
    expect(out.body.itens).toHaveLength(1)
    expect(set.body.itens).toHaveLength(0)
  })

  it('a Visao do mes as mostra em linha propria, sem mexer em `recebido`', async () => {
    const cat = await categoria()
    await lancar(cat, { valor: '7000' })
    const v = await pegar(c, '/v1/visao-do-mes', { mes: HOJE.slice(0, 7) }, 'beatriz')
    expect(v.statusCode, v.text).toBe(200)
    expect(v.body.outrasEntradas).toBe('7000')
    expect(v.body.recebido).toBe('0')
  })
})
