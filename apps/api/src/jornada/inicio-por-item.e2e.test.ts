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
 * "COMEÇAR EM OUTRA DATA" (pedido da cliente, spec 1.1).
 *
 * A data da primeira sessão de cada item viaja na proposta, fica em
 * `programa_orcado` e é a que o fechamento usa. Data que já passou no dia do
 * fechamento é PERGUNTA (409 `INICIO_NO_PASSADO`), nunca correção silenciosa.
 */
type Doc = Record<string, unknown>

let c: Cenario
let proc: { id: string }[]

beforeAll(async () => {
  c = await montarCenario('inicio-por-item')
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

const mover = (id: string, corpo: Record<string, unknown>) =>
  postar(c, `/v1/tarefas/${id}/jornada`, corpo, 'beatriz')

async function realizada(): Promise<string> {
  const r = await postar(
    c,
    '/v1/tarefas',
    {
      vinculo: 'paciente',
      pacienteId: c.pacientes['ana'],
      tipo: 'Consulta agendada',
      responsavelId: c.pessoas['beatriz'],
      quando: { modo: 'retroativo', em: HOJE },
    },
    'beatriz',
  )
  expect(r.statusCode, JSON.stringify(r.body)).toBe(201)
  return r.body.tarefa.id as string
}

const somar = (dia: string, n: number): string => {
  const d = new Date(`${dia}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

const proposta = (inicio?: string) => [
  {
    chave: 'i1',
    procedimentoId: proc[0]!.id,
    sessoes: 3,
    intervaloDias: 7,
    ...(inicio === undefined ? {} : { inicio }),
  },
  { chave: 'i2', procedimentoId: proc[1]!.id, sessoes: 2, intervaloDias: 7, depoisDe: 'i1' },
]

const orcar = (id: string, programa: unknown) =>
  mover(id, { acao: 'registrarOrcamento', valor: '1000000', programa })

const fechar = (id: string, extra: Record<string, unknown> = {}) =>
  mover(id, {
    acao: 'fechar',
    fechamento: 'tudo',
    recebimento: { valor: '400000', forma: 'Pix', valorAberto: '600000' },
    ...extra,
  })

const sessoesDe = async (id: string) => {
  const r = await c.migrate.query<{ prazo: string; chave: string }>(
    `SELECT to_char(t.prazo, 'YYYY-MM-DD') AS prazo, t.item_chave AS chave
       FROM tarefas t
       JOIN programas p ON p.id = t.programa_id
      WHERE p.tarefa_de_origem_id = $1 AND t.tipo = 'Sessão de plano'
      ORDER BY t.prazo`,
    [id],
  )
  return r.rows
}

describe('inicio por item no orçamento de programa', () => {
  it('registra com `inicio`, devolve nas leituras e o fechamento começa NA data', async () => {
    const id = await realizada()
    const dia = somar(HOJE, 10)
    const o = await orcar(id, proposta(dia))
    expect(o.statusCode, JSON.stringify(o.body)).toBe(200)

    const t = await pegar(c, `/v1/tarefas/${id}`, {}, 'beatriz')
    const prog = t.body.tarefa.programaOrcado as Doc[]
    expect(prog[0]).toMatchObject({ chave: 'i1', inicio: dia })
    expect(prog[1]).not.toHaveProperty('inicio')

    const f = await fechar(id)
    expect(f.statusCode, JSON.stringify(f.body)).toBe(200)
    const todas = await sessoesDe(id)
    expect(todas.filter((x) => x.chave === 'i1').map((x) => x.prazo)).toEqual([
      dia,
      somar(dia, 7),
      somar(dia, 14),
    ])
    // O item 2 continua encadeado: começa depois do último do item 1.
    expect(todas.filter((x) => x.chave === 'i2')[0]!.prazo).toBe(somar(dia, 21))
  })

  it('sem `inicio` nada muda: começa hoje da clínica', async () => {
    const id = await realizada()
    expect((await orcar(id, proposta())).statusCode).toBe(200)
    expect((await fechar(id)).statusCode).toBe(200)
    expect((await sessoesDe(id))[0]!.prazo).toBe(HOJE)
  })

  it('data que já passou: 409 INICIO_NO_PASSADO, nada gravado; confirmando, usa a data pedida', async () => {
    const id = await realizada()
    const passada = somar(HOJE, -5)
    expect((await orcar(id, proposta(passada))).statusCode).toBe(200)

    const antes = await c.migrate.query('SELECT 1 FROM recebimentos WHERE tarefa_id = $1', [id])
    const r = await fechar(id)
    expect(r.statusCode, JSON.stringify(r.body)).toBe(409)
    expect(r.body).toMatchObject({ codigo: 'CONFIRMACAO_NECESSARIA', avisos: ['INICIO_NO_PASSADO'] })
    // Sem número nenhum no 409.
    expect(JSON.stringify(r.body)).not.toMatch(/400000|600000|1000000/)
    expect((await sessoesDe(id)).length).toBe(0)
    const depois = await c.migrate.query('SELECT 1 FROM recebimentos WHERE tarefa_id = $1', [id])
    expect(depois.rowCount).toBe(antes.rowCount)

    const ok = await fechar(id, { confirmarInicioNoPassado: true })
    expect(ok.statusCode, JSON.stringify(ok.body)).toBe(200)
    expect((await sessoesDe(id))[0]!.prazo).toBe(passada)
  })

  it('hoje não é passado: não pergunta', async () => {
    const id = await realizada()
    expect((await orcar(id, proposta(HOJE))).statusCode).toBe(200)
    expect((await fechar(id)).statusCode).toBe(200)
  })

  it('fechamento parcial: o item fechado mantém a própria data', async () => {
    const id = await realizada()
    const dia = somar(HOJE, 3)
    expect((await orcar(id, proposta(dia))).statusCode).toBe(200)
    const f = await mover(id, {
      acao: 'fechar',
      fechamento: 'parte',
      itensFechados: ['i1'],
      recebimento: { valor: '100000', forma: 'Pix', valorAberto: '200000' },
    })
    expect(f.statusCode, JSON.stringify(f.body)).toBe(200)
    expect((await sessoesDe(id))[0]!.prazo).toBe(dia)
  })

  it('parcial: o item NO PASSADO que não foi fechado não gera pergunta', async () => {
    const id = await realizada()
    const dia = somar(HOJE, 3)
    const programa = [
      { chave: 'i1', procedimentoId: proc[0]!.id, sessoes: 3, intervaloDias: 7, inicio: dia },
      { chave: 'i2', procedimentoId: proc[1]!.id, sessoes: 2, intervaloDias: 7, inicio: somar(HOJE, -5) },
    ]
    expect((await orcar(id, programa)).statusCode).toBe(200)
    const f = await mover(id, {
      acao: 'fechar',
      fechamento: 'parte',
      itensFechados: ['i1'],
      recebimento: { valor: '100000', forma: 'Pix', valorAberto: '200000' },
    })
    expect(f.statusCode, JSON.stringify(f.body)).toBe(200)
    expect((await sessoesDe(id))[0]!.prazo).toBe(dia)
  })

  it('orçamento LEGADO (programa_orcado sem `inicio`) fecha como antes, sem pergunta', async () => {
    const id = await realizada()
    expect((await orcar(id, proposta())).statusCode).toBe(200)
    const crua = await c.migrate.query<{ p: Doc[] }>(
      'SELECT programa_orcado AS p FROM tarefas WHERE id = $1',
      [id],
    )
    expect(crua.rows[0]!.p.every((i) => !('inicio' in i))).toBe(true)
    const f = await fechar(id)
    expect(f.statusCode, JSON.stringify(f.body)).toBe(200)
    expect((await sessoesDe(id))[0]!.prazo).toBe(HOJE)
  })

  it('a correção do orçamento também guarda `inicio`', async () => {
    const id = await realizada()
    expect((await orcar(id, proposta())).statusCode).toBe(200)
    const dia = somar(HOJE, 20)
    const r = await mover(id, {
      acao: 'corrigirOrcamento',
      chaveIdempotencia: crypto.randomUUID(),
      programa: proposta(dia),
    })
    expect(r.statusCode, JSON.stringify(r.body)).toBe(200)
    const t = await pegar(c, `/v1/tarefas/${id}`, {}, 'beatriz')
    expect((t.body.tarefa.programaOrcado as Doc[])[0]).toMatchObject({ inicio: dia })
  })

  it('mais de um ano à frente do dia da clínica: 400 no registro e na correção', async () => {
    const id = await realizada()
    const longe = somar(HOJE, 400)
    const o = await orcar(id, proposta(longe))
    expect(o.statusCode, JSON.stringify(o.body)).toBe(400)
    // No limite (um ano) passa.
    expect((await orcar(id, proposta(somar(HOJE, 365)))).statusCode).toBe(200)
    const r = await mover(id, {
      acao: 'corrigirOrcamento',
      chaveIdempotencia: crypto.randomUUID(),
      programa: proposta(longe),
    })
    expect(r.statusCode, JSON.stringify(r.body)).toBe(400)
  })

  it('data que não existe é recusada na borda', async () => {
    const id = await realizada()
    expect((await orcar(id, proposta('2026-02-31'))).statusCode).toBe(400)
  })
})
