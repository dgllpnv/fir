import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  type Cenario,
  desmontarCenario,
  HOJE,
  limparProgramas,
  montarCenario,
  postar,
  apagar,
  receitaDoDia,
  recebimentosDe,
  tarefaCrua,
  vivosDe,
} from '../tarefas/__tests__/cenario'

/**
 * O ROTEIRO DA CLÍNICA (pedido 2 da cliente): a consulta já nasce com o
 * pagamento dela (entrada + em aberto), o orçamento é enviado e, ao "Fechou",
 * o valor do orçamento entra de novo — e a tela mostrava "Internal server
 * error". O índice `recebimento_por_tarefa` (regra 3) recusa DOIS pagamentos
 * vivos no mesmo atendimento; o fechamento precisa pôr o dinheiro do orçamento
 * num lançamento PRÓPRIO, como o Recebimento › Orçamento fechado já faz.
 *
 * E o impasse do vídeo 3: com o orçamento enviado, nem reabrir (estorna o
 * pagamento) nem excluir (recusa por ter pagamento) eram possíveis.
 */
let c: Cenario

beforeAll(async () => {
  c = await montarCenario('fechar-apos-pagamento')
})
afterAll(async () => {
  await desmontarCenario(c)
})
beforeEach(async () => {
  await limparProgramas(c)
})

const mover = (id: string, corpo: Record<string, unknown>, quem = 'beatriz') =>
  postar(c, `/v1/tarefas/${id}/jornada`, corpo, quem)

/** A consulta da cliente: realizada, R$ 500 no Pix e R$ 300 em aberto. */
async function consultaPaga(): Promise<string> {
  const r = await postar(
    c,
    '/v1/tarefas',
    {
      vinculo: 'paciente',
      pacienteId: c.pacientes['ana'],
      tipo: 'Consulta agendada',
      responsavelId: c.pessoas['beatriz'],
      quando: {
        modo: 'retroativo',
        em: HOJE,
        pagamento: { valor: '50000', forma: 'Pix', valorAberto: '30000' },
      },
    },
    'beatriz',
  )
  expect(r.statusCode, JSON.stringify(r.body)).toBe(201)
  return r.body.tarefa.id as string
}

async function orcada(): Promise<string> {
  const id = await consultaPaga()
  const r = await mover(id, { acao: 'registrarOrcamento', valor: '1500000' })
  expect(r.statusCode, JSON.stringify(r.body)).toBe(200)
  return id
}

describe('FECHAR um orçamento de consulta que já tem pagamento', () => {
  it('fecha, e o dinheiro do orçamento vira OUTRO recebimento (a consulta não é tocada)', async () => {
    const id = await orcada()
    const antes = await receitaDoDia(c)
    const r = await mover(id, {
      acao: 'fechar',
      recebimento: { valor: '1000000', forma: 'Dinheiro', valorAberto: '500000' },
    })
    expect(r.statusCode, JSON.stringify(r.body)).toBe(200)

    // a consulta continua com o pagamento dela, uma vez só
    const daConsulta = await vivosDe(c, id)
    expect(daConsulta).toHaveLength(1)
    expect(daConsulta[0]!.valor).toBe('50000')

    // o do orçamento entrou uma vez: a receita do dia sobe EXATAMENTE a entrada
    expect((await receitaDoDia(c)) - antes).toBe(1_000_000n)

    // o negócio fechado é o orçamento, e o cartão saiu de "em aberto"
    const t = await tarefaCrua(c, id)
    expect(t!.etapa).toBe('fechado')
    expect(t!.valor_orcamento).toBe('1500000')
  })

  it('o fechamento repetido não duplica o dinheiro (409, e nada novo)', async () => {
    const id = await orcada()
    const corpo = {
      acao: 'fechar',
      recebimento: { valor: '1000000', forma: 'Pix', valorAberto: '500000' },
    }
    await mover(id, corpo).expect(200)
    const depois = await receitaDoDia(c)
    const r2 = await mover(id, corpo)
    expect(r2.statusCode).toBe(409)
    expect(await receitaDoDia(c)).toBe(depois)
  })
})

describe('REABRIR e EXCLUIR um atendimento com orçamento ainda em aberto', () => {
  it('reabrir estorna o pagamento da consulta e devolve o cartão; depois exclui', async () => {
    const id = await orcada()
    const antes = await receitaDoDia(c)

    const rr = await postar(c, `/v1/tarefas/${id}/reabrir`, {}, 'beatriz')
    expect(rr.statusCode, JSON.stringify(rr.body)).toBe(200)
    expect(await vivosDe(c, id)).toHaveLength(0)
    expect(antes - (await receitaDoDia(c))).toBe(50000n)
    // append-only: a linha do pagamento continua lá, estornada
    expect((await recebimentosDe(c, id)).length).toBe(1)

    // o orçamento que ela enviou NÃO some em silêncio: ele fica na tarefa
    const t = await tarefaCrua(c, id)
    expect(t!.status).toBe('aberta')
    expect(t!.etapa).not.toBe('orcamento')

    const ex = await apagar(c, `/v1/tarefas/${id}`, {}, 'beatriz')
    expect(ex.statusCode, JSON.stringify(ex.body)).toBe(200)
    expect((await tarefaCrua(c, id))!.excluida_em).not.toBeNull()
  })

  it('com o orçamento já FECHADO a recusa explica a saída em português de balcão', async () => {
    const id = await orcada()
    await mover(id, {
      acao: 'fechar',
      recebimento: { valor: '1000000', forma: 'Pix', valorAberto: '500000' },
    }).expect(200)
    const rr = await postar(c, `/v1/tarefas/${id}/reabrir`, {}, 'beatriz')
    expect(rr.statusCode).toBe(409)
    expect(String((rr.body as { message?: string }).message ?? '')).toMatch(/estorn/i)
  })
})

describe('CORRIGIR os itens do orçamento enviado', () => {
  const idDoProcedimento = async (chave: string): Promise<string> => {
    const r = await c.migrate.query<{ id: string }>(
      'SELECT id FROM procedimentos WHERE clinica_id = $1 AND nome_chave = $2',
      [c.clinica, chave],
    )
    return r.rows[0]!.id
  }

  it('troca os itens, e o fechamento monta o programa NOVO', async () => {
    const tirze = await idDoProcedimento('tirzepatida')
    const id = await consultaPaga()
    await mover(id, {
      acao: 'registrarOrcamento',
      valor: '1500000',
      programa: [{ procedimentoId: tirze, sessoes: 4, intervaloDias: 7, chave: 'a' }],
    }).expect(200)

    const r = await mover(id, {
      acao: 'corrigirOrcamento',
      chaveIdempotencia: '11111111-1111-4111-8111-111111111111',
      programa: [{ procedimentoId: tirze, sessoes: 8, intervaloDias: 7, chave: 'a' }],
    })
    expect(r.statusCode, JSON.stringify(r.body)).toBe(200)
    const crua = await tarefaCrua(c, id)
    const itens = crua!.programa_orcado as { sessoes: number }[]
    expect(itens).toHaveLength(1)
    expect(itens[0]!.sessoes).toBe(8)
    expect(crua!.valor_orcamento).toBe('1500000')
    expect(crua!.etapa).toBe('orcamento')

    // o mesmo envio repetido não grava de novo
    const outra = await mover(id, {
      acao: 'corrigirOrcamento',
      chaveIdempotencia: '11111111-1111-4111-8111-111111111111',
      programa: [{ procedimentoId: tirze, sessoes: 8, intervaloDias: 7, chave: 'a' }],
    })
    expect(outra.statusCode).toBe(200)
    const eventos = (await tarefaCrua(c, id))!.historico as { acao: string }[]
    expect(eventos.filter((e) => e.acao === 'corrigirOrcamento')).toHaveLength(1)
  })

  it('item com preço que passa do valor do orçamento é recusado (409)', async () => {
    const tirze = await idDoProcedimento('tirzepatida')
    const id = await orcada()
    const r = await mover(id, {
      acao: 'corrigirOrcamento',
      chaveIdempotencia: '22222222-2222-4222-8222-222222222222',
      programa: [{ procedimentoId: tirze, sessoes: 2, intervaloDias: 7, chave: 'a', valor: '9999999' }],
    })
    expect(r.statusCode, JSON.stringify(r.body)).toBe(409)
  })

  it('sem `valores`, trocar os itens de um orçamento COM preço por item é recusado (nada se perde)', async () => {
    const tirze = await idDoProcedimento('tirzepatida')
    // a consulta é da recepção (juliana: pode editar, não vê valores)
    const r0 = await postar(
      c,
      '/v1/tarefas',
      {
        vinculo: 'paciente',
        pacienteId: c.pacientes['ana'],
        tipo: 'Consulta agendada',
        responsavelId: c.pessoas['juliana'],
        quando: { modo: 'retroativo', em: HOJE },
      },
      'beatriz',
    )
    expect(r0.statusCode, JSON.stringify(r0.body)).toBe(201)
    const id = r0.body.tarefa.id as string
    await mover(id, {
      acao: 'registrarOrcamento',
      valor: '1500000',
      programa: [{ procedimentoId: tirze, sessoes: 4, intervaloDias: 7, chave: 'a', valor: '800000' }],
    }).expect(200)

    const r = await mover(
      id,
      {
        acao: 'corrigirOrcamento',
        chaveIdempotencia: '33333333-3333-4333-8333-333333333333',
        programa: [{ procedimentoId: tirze, sessoes: 6, intervaloDias: 7, chave: 'a' }],
      },
      'juliana',
    )
    expect(r.statusCode, JSON.stringify(r.body)).toBe(403)
    const itens = (await tarefaCrua(c, id))!.programa_orcado as { valor?: string }[]
    expect(itens[0]!.valor).toBe('800000') // o preço do item continua lá
  })

  it('o pagamento do orçamento só se desfaz em Recebimentos; a consulta fechada não some por baixo', async () => {
    const id = await orcada()
    await mover(id, {
      acao: 'fechar',
      recebimento: { valor: '1000000', forma: 'Pix', valorAberto: '500000' },
    }).expect(200)
    const antes = await receitaDoDia(c)

    // a tarefa companheira "Pagamento de orçamento"
    const comp = await c.migrate.query<{ rid: string; tid: string }>(
      `SELECT r.id AS rid, r.tarefa_id AS tid FROM recebimentos r
        WHERE r.paciente_id = $1 AND r.tarefa_id <> $2 AND r.estornado_em IS NULL
          AND r.tipo = 'Pagamento de orçamento'`,
      [c.pacientes['ana'], id],
    )
    expect(comp.rows).toHaveLength(1)

    // reabrir a companheira é recusado: a saída é Estornar
    const rb = await postar(c, `/v1/tarefas/${comp.rows[0]!.tid}/reabrir`, {}, 'beatriz')
    expect(rb.statusCode, JSON.stringify(rb.body)).toBe(409)
    expect(String((rb.body as { message?: string }).message)).toMatch(/Estornar/)
    expect(await receitaDoDia(c)).toBe(antes)

    // a consulta fechada não é reaberta (fechado é terminal); EXCLUIR é a saída
    // (ADR 2026-11-13) e é testado em tarefas/excluir-com-pagamento.test.ts
    expect((await postar(c, `/v1/tarefas/${id}/reabrir`, {}, 'beatriz')).statusCode).toBe(409)

    // Estornar (a porta certa) desfaz o dinheiro do orçamento e tira a companheira das listas
    const est = await apagar(c, `/v1/recebimentos/${comp.rows[0]!.rid}`, {}, 'beatriz')
    expect(est.statusCode).toBe(204)
    expect(antes - (await receitaDoDia(c))).toBe(1_000_000n)
    expect((await tarefaCrua(c, comp.rows[0]!.tid))!.excluida_em).not.toBeNull()
    // o pagamento da consulta continua, uma vez só
    expect(await vivosDe(c, id)).toHaveLength(1)
  })
})
