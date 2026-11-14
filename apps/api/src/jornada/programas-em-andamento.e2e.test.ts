import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  type Cenario,
  desmontarCenario,
  HOJE,
  limparProgramas,
  montarCenario,
  pegar,
  postar,
} from '../tarefas/__tests__/cenario'

/**
 * **"EM PROGRAMA" NA JORNADA** (pedido da cliente, 2026-11-13).
 *
 * "O sistema vai precisar puxar programas de tratamento em andamento": o paciente
 * em programa não passa pelo agendamento, então não existia na Jornada. Esta
 * seção lê os programas ATIVOS, sem criar tarefa e sem entrar no funil.
 */
type Doc = Record<string, unknown>
let c: Cenario
let proc: { id: string }[]

beforeAll(async () => {
  c = await montarCenario('programas-em-andamento')
  const p = await c.migrate.query<{ id: string }>(
    'SELECT id FROM procedimentos WHERE clinica_id = $1 ORDER BY nome LIMIT 2',
    [c.clinica],
  )
  proc = p.rows
})
afterAll(async () => {
  await desmontarCenario(c)
})
beforeEach(async () => {
  await limparProgramas(c)
})

/** Fecha um orçamento de programa de 4 sessões para a paciente e devolve o id do programa. */
async function programaDe(paciente: string): Promise<string> {
  const r = await postar(
    c,
    '/v1/tarefas',
    {
      vinculo: 'paciente',
      pacienteId: c.pacientes[paciente],
      tipo: 'Consulta agendada',
      responsavelId: c.pessoas['beatriz'],
      quando: { modo: 'retroativo', em: HOJE },
    },
    'beatriz',
  )
  const id = r.body.tarefa.id as string
  const o = await postar(
    c,
    `/v1/tarefas/${id}/jornada`,
    {
      acao: 'registrarOrcamento',
      valor: '1000000',
      programa: [{ chave: 'p1', procedimentoId: proc[0]!.id, sessoes: 4, intervaloDias: 7 }],
    },
    'beatriz',
  )
  expect(o.statusCode, JSON.stringify(o.body)).toBe(200)
  const f = await postar(
    c,
    `/v1/tarefas/${id}/jornada`,
    {
      acao: 'fechar',
      fechamento: 'tudo',
      recebimento: { valor: '400000', forma: 'Pix', valorAberto: '600000' },
    },
    'beatriz',
  )
  expect(f.statusCode, JSON.stringify(f.body)).toBe(200)
  const p = await c.migrate.query<{ id: string }>(
    'SELECT id FROM programas WHERE tarefa_de_origem_id = $1',
    [id],
  )
  return p.rows[0]!.id
}

const lista = async (quem = 'beatriz') =>
  pegar(c, '/v1/jornada/programas-em-andamento', {}, quem)

describe('seção "Em programa" da Jornada', () => {
  it('lista o programa ativo com as sessões e o nome do procedimento', async () => {
    const id = await programaDe('ana')
    const r = await lista()
    expect(r.statusCode, JSON.stringify(r.body)).toBe(200)
    const itens = r.body.itens as Doc[]
    const meu = itens.find((x) => x['id'] === id)!
    expect(meu).toMatchObject({
      pacienteId: c.pacientes['ana'],
      sessoesFeitas: 0,
      sessoesTotal: 4,
      atrasadas: 0,
    })
    expect(typeof meu['procedimentos']).toBe('string')
    expect(typeof meu['proximaSessaoEm']).toBe('string')
    expect(r.body.restantes).toBe(0)
  })

  it('conta a sessão concluída e a cancelada fica fora do total', async () => {
    const id = await programaDe('ana')
    const s = await c.migrate.query<{ id: string }>(
      `SELECT id FROM tarefas WHERE programa_id = $1 AND tipo = 'Sessão de plano'
        ORDER BY sessao_indice LIMIT 2`,
      [id],
    )
    await c.migrate.query(
      `UPDATE tarefas SET status = 'concluida', concluida_em = now() WHERE id = $1`,
      [s.rows[0]!.id],
    )
    await c.migrate.query(`UPDATE tarefas SET status = 'cancelada' WHERE id = $1`, [s.rows[1]!.id])
    const meu = ((await lista()).body.itens as Doc[]).find((x) => x['id'] === id)!
    expect(meu).toMatchObject({ sessoesFeitas: 1, sessoesTotal: 3 })
  })

  it('programa encerrado ou excluído não aparece', async () => {
    const id = await programaDe('ana')
    await c.migrate.query(
      `UPDATE programas SET situacao = 'encerrado', encerrado_em = now() WHERE id = $1`,
      [id],
    )
    expect(((await lista()).body.itens as Doc[]).some((x) => x['id'] === id)).toBe(false)
  })

  it('não leva dinheiro, dose, produto nem lote na resposta', async () => {
    await programaDe('ana')
    const texto = JSON.stringify((await lista()).body)
    for (const proibido of ['600000', '400000', '1000000', 'dose', 'lote', 'valor', 'insumo']) {
      expect(texto, proibido).not.toContain(proibido)
    }
  })

  it('quem não tem `jornada` recebe 403', async () => {
    await programaDe('ana')
    expect((await lista('camila')).statusCode).toBe(403)
  })

  it('a recepção (jornada, sem valores) vê o mesmo, e a outra clínica não vê nada daqui', async () => {
    const id = await programaDe('ana')
    const r = await lista('juliana')
    expect(r.statusCode).toBe(200)
    expect((r.body.itens as Doc[]).some((x) => x['id'] === id)).toBe(true)
    const vizinha = await c.migrate.query(
      `SELECT count(*)::int AS n FROM programas WHERE clinica_id <> $1 AND id = $2`,
      [c.clinica, id],
    )
    expect(vizinha.rows[0].n).toBe(0)
  })
})
