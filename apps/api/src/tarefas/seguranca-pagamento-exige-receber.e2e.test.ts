import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  type Cenario,
  desmontarCenario,
  HOJE,
  limparFinanceiro,
  limparProgramas,
  montarCenario,
  postar,
  tarefaCrua,
} from './__tests__/cenario'

/**
 * **F6 — PAGAMENTO EMBUTIDO EXIGE `receber`, EM TODA PORTA.**
 *
 * Concluir tarefa com `pagamento` e criar tarefa já concluída com pagamento
 * gravavam recebimento sem checar `receber` — só a rota de sessão e a jornada
 * checavam, no controlador. Agora `registrarPagamento` cobra a permissão uma
 * vez, para as quatro portas. `juliana` (Recepção do cenário: `jornada` +
 * `pacientes`, sem `receber`) é quem prova; `rita` (`receber` sem `valores`)
 * prova que quem pode continua podendo.
 *
 * Postgres real.
 */
let c: Cenario

beforeAll(async () => {
  c = await montarCenario('seguranca-receber')
}, 60_000)

afterAll(async () => {
  await desmontarCenario(c)
})

beforeEach(async () => {
  await limparFinanceiro(c)
  await limparProgramas(c)
})

const recebimentos = async (): Promise<number> =>
  Number(
    (
      await c.migrate.query<{ n: string }>(
        'SELECT count(*)::text AS n FROM recebimentos WHERE clinica_id = $1',
        [c.clinica],
      )
    ).rows[0]!.n,
  )

const tarefas = async (): Promise<number> =>
  Number(
    (
      await c.migrate.query<{ n: string }>(
        'SELECT count(*)::text AS n FROM tarefas WHERE clinica_id = $1',
        [c.clinica],
      )
    ).rows[0]!.n,
  )

const PAGAMENTO = { valor: '45000', forma: 'Pix', valorAberto: '30000' }

/** Consulta agendada para hoje, da juliana — ela pode concluí-la. */
const consulta = async (quem: string): Promise<string> => {
  const r = await postar(
    c,
    '/v1/tarefas',
    {
      vinculo: 'paciente',
      pacienteId: c.pacientes['ana'],
      tipo: 'Consulta agendada',
      responsavelId: c.pessoas[quem],
      quando: { modo: 'agendada', prazo: HOJE },
    },
    quem,
  )
  expect(r.statusCode, r.text).toBe(201)
  return r.body.tarefa.id as string
}

const retroativa = (quem: string, pagamento?: typeof PAGAMENTO) =>
  postar(
    c,
    '/v1/tarefas',
    {
      vinculo: 'paciente',
      pacienteId: c.pacientes['ana'],
      tipo: 'Consulta agendada',
      responsavelId: c.pessoas[quem],
      quando: { modo: 'retroativo', em: HOJE, ...(pagamento === undefined ? {} : { pagamento }) },
    },
    quem,
  )

describe('F6 — concluir com pagamento', () => {
  it('sem `receber`: 403, nenhum recebimento, e a tarefa continua ABERTA', async () => {
    const id = await consulta('juliana')
    const r = await postar(c, `/v1/tarefas/${id}/concluir`, { em: HOJE, pagamento: PAGAMENTO }, 'juliana')
    expect(r.statusCode, r.text).toBe(403)
    expect(await recebimentos()).toBe(0)
    expect((await tarefaCrua(c, id))!['status']).toBe('aberta')
  })

  it('sem `receber` mas SEM pagamento: conclui normalmente (a permissão é do dinheiro, não da tarefa)', async () => {
    const id = await consulta('juliana')
    const r = await postar(c, `/v1/tarefas/${id}/concluir`, { em: HOJE }, 'juliana')
    expect(r.statusCode, r.text).toBe(200)
    expect(await recebimentos()).toBe(0)
  })

  it('com `receber` (sem `valores`): grava UM recebimento', async () => {
    const id = await consulta('rita')
    const r = await postar(c, `/v1/tarefas/${id}/concluir`, { em: HOJE, pagamento: PAGAMENTO }, 'rita')
    expect(r.statusCode, r.text).toBe(200)
    expect(await recebimentos()).toBe(1)
  })
})

describe('F6 — criar tarefa já concluída com pagamento', () => {
  it('sem `receber`: 403, e nem a tarefa nem o recebimento nascem', async () => {
    const r = await retroativa('juliana', PAGAMENTO)
    expect(r.statusCode, r.text).toBe(403)
    expect(await recebimentos()).toBe(0)
    expect(await tarefas()).toBe(0)
  })

  it('sem `receber` e sem pagamento: cria normalmente', async () => {
    const r = await retroativa('juliana')
    expect(r.statusCode, r.text).toBe(201)
    expect(await recebimentos()).toBe(0)
  })

  it('com `receber`: cria a tarefa e UM recebimento', async () => {
    const r = await retroativa('rita', PAGAMENTO)
    expect(r.statusCode, r.text).toBe(201)
    expect(await recebimentos()).toBe(1)
  })
})
