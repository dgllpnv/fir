import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  type Cenario,
  desmontarCenario,
  HOJE,
  limparTarefas,
  montarCenario,
  pegar,
  postar,
  receitaDoDia,
  tarefaCrua,
} from '../tarefas/__tests__/cenario'

/**
 * `POST /v1/tarefas/orcamentos` — ORÇAMENTO DIRETO, sem consulta antes
 * (ADR 2026-11-19-orcamento-direto).
 *
 * O caso da cliente: a paciente veio para a reavaliação final do programa e
 * recebeu um orçamento novo. Não havia cartão de consulta onde registrá-lo, e a
 * recepção lançou só um valor recebido — que não abriu saldo nenhum.
 *
 * O que estes testes provam, pela rota HTTP e contra Postgres real:
 *  - o cartão nasce no orçamento, sem atendimento de mentira (sem `concluir`);
 *  - orçamento não é receita (regra 4);
 *  - ele fecha com entrada e saldo em aberto pelo Fechou de sempre;
 *  - aparece na aba Orçamentos da paciente;
 *  - as conferências do `registrarOrcamento` valem aqui também;
 *  - permissão `jornada`, e a paciente da vizinha não é alcançável.
 */
let c: Cenario

beforeAll(async () => {
  c = await montarCenario('orcamento-direto')
})
afterAll(async () => {
  await desmontarCenario(c)
})
beforeEach(async () => {
  await limparTarefas(c)
})

type Corpo = Record<string, unknown>
type Tarefa = {
  id: string
  tipo: string
  etapa: string | null
  status: string
  pacienteId: string | null
  valorOrcamento: string | null
  proximoPassoEm: string | null
  historico: { acao: string; etapa: string; valor?: string | null; nota?: string }[]
}

const criarOrcamento = (corpo: Corpo, quem = 'beatriz') =>
  postar(c, '/v1/tarefas/orcamentos', corpo, quem)
const mover = (id: string, corpo: Corpo, quem = 'beatriz') =>
  postar(c, `/v1/tarefas/${id}/jornada`, corpo, quem)

async function novo(extra: Corpo = {}): Promise<Tarefa> {
  const r = await criarOrcamento({ pacienteId: c.pacientes['ana'], valor: '360000', ...extra })
  expect(r.statusCode, JSON.stringify(r.body)).toBe(201)
  return r.body.tarefa as Tarefa
}

describe('o cartão nasce no orçamento, sem consulta', () => {
  it('Orçamento enviado, concluído, com o valor e a retomada padrão — sem evento concluir', async () => {
    const t = await novo({ nota: 'reavaliação final: novo ciclo' })
    expect(t).toMatchObject({
      tipo: 'Orçamento enviado',
      etapa: 'orcamento',
      status: 'concluida',
      pacienteId: c.pacientes['ana'],
      valorOrcamento: '360000',
      // O padrão do servidor: hoje + 2, no fuso da clínica (regra 24).
      proximoPassoEm: '2026-10-26',
    })
    // Um evento só: o funil não o conta como atendimento realizado.
    expect(t.historico.map((e) => e.acao)).toEqual(['registrarOrcamento'])
    expect(t.historico[0]).toMatchObject({ etapa: 'orcamento', nota: 'reavaliação final: novo ciclo' })

    const cru = await tarefaCrua(c, t.id)
    // A unidade herda a principal da paciente, como a Nova tarefa.
    expect(cru!['unidade_id']).not.toBeNull()
    expect(cru!['prazo']).toBeDefined()
  })

  it('orçamento NÃO é receita (regra 4): a receita do dia não muda', async () => {
    const antes = await receitaDoDia(c)
    await novo()
    expect(await receitaDoDia(c)).toBe(antes)
  })

  it('aparece na aba Orçamentos da paciente, como orçamento em aberto', async () => {
    const t = await novo()
    const r = await pegar(c, `/v1/pacientes/${c.pacientes['ana']}/orcamentos`, {}, 'beatriz')
    expect(r.statusCode, JSON.stringify(r.body)).toBe(200)
    const meu = (r.body.itens as { tarefaId: string; situacao: string; tipoDoAtendimento: string }[]).find(
      (o) => o.tarefaId === t.id,
    )
    expect(meu).toMatchObject({ tipoDoAtendimento: 'Orçamento enviado' })
    expect(meu!.situacao).not.toBe('fechado')
  })
})

describe('daí em diante é um cartão da jornada como qualquer outro', () => {
  it('Fechou com entrada e saldo em aberto: entra só a entrada, e o saldo fica aberto', async () => {
    const t = await novo()
    const antes = await receitaDoDia(c)
    const f = await mover(t.id, {
      acao: 'fechar',
      recebimento: { valor: '100000', forma: 'Pix', valorAberto: '260000' },
    })
    expect(f.statusCode, JSON.stringify(f.body)).toBe(200)
    expect((f.body.tarefa as Tarefa).etapa).toBe('fechado')
    // Exatamente a entrada: o orçamento continua fora, a dívida não é receita.
    expect((await receitaDoDia(c)) - antes).toBe(100000n)

    const aberto = await c.migrate.query<{ total: string }>(
      `SELECT coalesce(sum(valor_aberto), 0)::text AS total FROM recebimentos
        WHERE clinica_id = $1 AND paciente_id = $2 AND estornado_em IS NULL`,
      [c.clinica, c.pacientes['ana']],
    )
    expect(BigInt(aberto.rows[0]!.total)).toBe(260000n)
  })

  it('o dinheiro vai para a companheira "Pagamento de orçamento", e reabrir o estorna', async () => {
    const t = await novo()
    const antes = await receitaDoDia(c)
    await mover(t.id, {
      acao: 'fechar',
      recebimento: { valor: '100000', forma: 'Pix', valorAberto: '260000' },
    }).expect(200)
    const rec = await c.migrate.query<{ tipo: string; tarefa: string }>(
      `SELECT r.tipo, t.tipo AS tarefa FROM recebimentos r JOIN tarefas t ON t.id = r.tarefa_id
        WHERE r.paciente_id = $1 AND r.estornado_em IS NULL`,
      [c.pacientes['ana']],
    )
    expect(rec.rows).toEqual([{ tipo: 'Pagamento de orçamento', tarefa: 'Pagamento de orçamento' }])

    const r = await mover(t.id, { acao: 'reabrirOrcamento', motivo: 'fechou por engano, era outra paciente' })
    expect(r.statusCode, JSON.stringify(r.body)).toBe(200)
    expect((r.body.tarefa as Tarefa).etapa).toBe('orcamento')
    // Estornado: a receita volta exatamente ao que era (regra 3).
    expect(await receitaDoDia(c)).toBe(antes)
  })

  it('Follow-up funciona no cartão direto', async () => {
    const t = await novo()
    const fu = await mover(t.id, { acao: 'followUp', nota: 'mandei a proposta de novo' })
    expect(fu.statusCode, JSON.stringify(fu.body)).toBe(200)
    expect((fu.body.tarefa as Tarefa).etapa).toBe('orcamento')
  })
})

describe('as conferências do registrarOrcamento valem aqui', () => {
  it('valor zero, valor em reais e sem valor: 400, e nenhum cartão nasce', async () => {
    for (const valor of ['0', '3600.00', undefined]) {
      const r = await criarOrcamento({ pacienteId: c.pacientes['ana'], ...(valor === undefined ? {} : { valor }) })
      expect(r.statusCode, String(valor)).toBe(400)
    }
    const n = await c.migrate.query('SELECT 1 FROM tarefas WHERE clinica_id = $1 AND tipo = $2', [
      c.clinica,
      'Orçamento enviado',
    ])
    expect(n.rowCount).toBe(0)
  })

  it('lista de procedimentos E programa no mesmo orçamento: 400, e o cartão não fica', async () => {
    const r = await criarOrcamento({
      pacienteId: c.pacientes['ana'],
      valor: '360000',
      itens: [{ chave: 'i1', procedimentoId: '00000000-0000-4000-8000-000000000001' }],
      programa: [
        { chave: 'i1', procedimentoId: '00000000-0000-4000-8000-000000000001', sessoes: 4, intervaloDias: 7 },
      ],
    })
    expect(r.statusCode, JSON.stringify(r.body)).toBe(400)
    // A transação inteira volta: nada de cartão "realizado" órfão.
    const n = await c.migrate.query('SELECT 1 FROM tarefas WHERE clinica_id = $1', [c.clinica])
    expect(n.rowCount).toBe(0)
  })

  it('campo fora do contrato é 400 (strict)', async () => {
    const r = await criarOrcamento({ pacienteId: c.pacientes['ana'], valor: '360000', etapa: 'fechado' })
    expect(r.statusCode).toBe(400)
  })
})

describe('quem pode, e de qual clínica', () => {
  it('sem `jornada`, 403 — `camila` tem `valores`', async () => {
    const r = await criarOrcamento({ pacienteId: c.pacientes['ana'], valor: '360000' }, 'camila')
    expect(r.statusCode).toBe(403)
  })

  it('a recepção com `jornada` e sem `valores` registra (como no cartão)', async () => {
    const r = await criarOrcamento({ pacienteId: c.pacientes['ana'], valor: '360000' }, 'juliana')
    expect(r.statusCode, JSON.stringify(r.body)).toBe(201)
    // Sem `valores`, o valor que ela digitou não volta na resposta (regra 17).
    expect((r.body.tarefa as Tarefa).valorOrcamento).toBeNull()
  })

  it('a paciente da clínica vizinha é "não encontrada", e nada é criado lá', async () => {
    const r = await criarOrcamento({ pacienteId: c.pacienteDaOutra, valor: '360000' })
    expect(r.statusCode).toBe(400)
    expect(r.body.message).toBe('Paciente não encontrado.')
    const n = await c.migrate.query('SELECT 1 FROM tarefas WHERE paciente_id = $1', [c.pacienteDaOutra])
    expect(n.rowCount).toBe(0)
  })

  it('o dia do cartão é o HOJE do servidor', async () => {
    const t = await novo()
    const cru = await tarefaCrua(c, t.id)
    const prazo = cru!['prazo']
    const dia = prazo instanceof Date ? prazo.toISOString().slice(0, 10) : String(prazo)
    expect(dia).toBe(HOJE)
  })
})
