import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  type Cenario,
  desmontarCenario,
  HOJE,
  limparTarefas,
  montarCenario,
  ONTEM,
  pegar,
  SEGUNDA_DA_SEMANA,
} from './__tests__/cenario'

/**
 * Paciente DESATIVADO some das listas e contadores de trabalho (tarefas
 * ABERTAS), continua na ficha, e reativar devolve tudo como estava.
 * Postgres real, HTTP de verdade. O filtro é `FORA_DE_PACIENTE_DESATIVADO`.
 */
let c: Cenario

beforeAll(async () => {
  c = await montarCenario('paciente-desativado')
})
afterAll(async () => {
  await desmontarCenario(c)
})
beforeEach(async () => {
  await limparTarefas(c)
})

let n = 0
const novoPaciente = async (): Promise<string> =>
  (
    await c.migrate.query<{ id: string }>(
      'INSERT INTO pacientes (clinica_id, nome) VALUES ($1, $2) RETURNING id',
      [c.clinica, `Paciente De Saida ${++n}`],
    )
  ).rows[0]!.id

const desativar = (id: string) =>
  c.migrate.query('UPDATE pacientes SET ativo = false, desativado_em = now() WHERE id = $1', [id])
const reativar = (id: string) =>
  c.migrate.query('UPDATE pacientes SET ativo = true, desativado_em = NULL WHERE id = $1', [id])

async function semear(
  paciente: string | null,
  prazo: string,
  status: 'aberta' | 'concluida' = 'aberta',
): Promise<string> {
  const r = await c.migrate.query<{ id: string }>(
    `INSERT INTO tarefas (clinica_id, solicitante_id, responsavel_id, descricao, prazo, status,
                          concluida_em, paciente_id, tipo)
     VALUES ($1,$2,$2,'Tarefa semeada',$3,$4,$5,$6,$7) RETURNING id`,
    [
      c.clinica,
      c.pessoas['juliana'],
      prazo,
      status,
      status === 'concluida' ? '2026-10-24T12:00:00-03:00' : null,
      paciente,
      paciente === null ? '' : 'Follow-up',
    ],
  )
  return r.rows[0]!.id
}

const idsDe = (corpo: { tarefas: { id: string }[] }): string[] => corpo.tarefas.map((t) => t.id)
const lista = async (quem = 'juliana', q: Record<string, string> = {}) =>
  idsDe((await pegar(c, '/v1/tarefas', q, quem).expect(200)).body)
const doDia = async (quem = 'juliana') => (await pegar(c, '/v1/hoje', {}, quem).expect(200)).body

describe('paciente desativado e as listas de trabalho', () => {
  it('desativar esconde a tarefa ABERTA de /v1/tarefas e /v1/hoje (dia e pendentes)', async () => {
    const p = await novoPaciente()
    const doDiaId = await semear(p, HOJE)
    const atrasada = await semear(p, ONTEM)
    const outra = await semear(null, HOJE)

    expect(await lista()).toEqual(expect.arrayContaining([doDiaId, atrasada, outra]))
    await desativar(p)

    const l = await lista()
    expect(l).toContain(outra)
    expect(l).not.toContain(doDiaId)
    expect(l).not.toContain(atrasada)
    const h = await doDia()
    expect(idsDe(h)).toEqual([outra])
    expect(h.pendentes.total).toBe(0)
  })

  it('a faixa da semana e as ocultas não contam a tarefa escondida', async () => {
    const p = await novoPaciente()
    await semear(p, HOJE)
    await semear(p, SEGUNDA_DA_SEMANA)
    const total = (b: { semana: { abertas: number }[] }) =>
      b.semana.reduce((s, d) => s + d.abertas, 0)
    expect(total(await doDia())).toBe(2)
    await desativar(p)
    expect(total(await doDia())).toBe(0)
    // Escopo `meu` + tarefa de OUTRA pessoa: o aviso de ocultas também zera.
    await c.migrate.query('UPDATE tarefas SET responsavel_id = $2 WHERE paciente_id = $1', [
      p,
      c.pessoas['camila'],
    ])
    expect((await doDia()).ocultasPeloFiltro).toBe(0)
  })

  it('o histórico fica: a CONCLUÍDA do desativado continua na lista', async () => {
    const p = await novoPaciente()
    const feita = await semear(p, HOJE, 'concluida')
    await desativar(p)
    expect(await lista('juliana', { situacao: 'concluida' })).toContain(feita)
    expect(idsDe(await doDia())).not.toContain(feita) // concluída vem em `concluidas`
    expect((await doDia()).concluidas.map((t: { id: string }) => t.id)).toContain(feita)
  })

  it('a FICHA do desativado ainda mostra a tarefa aberta', async () => {
    const p = await novoPaciente()
    const aberta = await semear(p, HOJE)
    await desativar(p)
    const r = await pegar(c, `/v1/pacientes/${p}`, {}, 'beatriz').expect(200)
    expect(r.body.tarefas.map((t: { id: string }) => t.id)).toContain(aberta)
  })

  it('reativar traz de volta, exatamente como estava', async () => {
    const p = await novoPaciente()
    const aberta = await semear(p, HOJE)
    await desativar(p)
    expect(await lista()).not.toContain(aberta)
    await reativar(p)
    expect(await lista()).toContain(aberta)
    expect(idsDe(await doDia())).toContain(aberta)
    const crua = await c.migrate.query<{ excluida_em: Date | null; status: string }>(
      'SELECT excluida_em, status FROM tarefas WHERE id = $1',
      [aberta],
    )
    expect(crua.rows[0]).toEqual({ excluida_em: null, status: 'aberta' })
  })

  it('perfil com escopo equipe (beatriz) também não vê; o filtro vale para todo perfil', async () => {
    const p = await novoPaciente()
    const aberta = await semear(p, HOJE)
    expect(await lista('beatriz', { escopo: 'equipe' })).toContain(aberta)
    await desativar(p)
    expect(await lista('beatriz', { escopo: 'equipe' })).not.toContain(aberta)
  })

  it('o painel de prazos não conta a aberta do desativado', async () => {
    const p = await novoPaciente()
    await semear(p, ONTEM)
    await semear(p, HOJE)
    const prazos = async () =>
      (await pegar(c, '/v1/painel', { periodo: 'mes' }, 'beatriz').expect(200)).body.prazos
    const antes = await prazos()
    expect(antes.atrasadas).toBeGreaterThanOrEqual(1)
    await desativar(p)
    const depois = await prazos()
    expect(depois.atrasadas).toBe(antes.atrasadas - 1)
    expect(depois.aVencer).toBe(antes.aVencer - 1)
    expect(depois.total).toBe(antes.total - 2)
  })

  it('isolamento de clínica: desativar paciente de uma clínica não mexe na outra', async () => {
    const p = await novoPaciente()
    const aberta = await semear(p, HOJE)
    // A clínica vizinha tem a sua tarefa e um paciente desativado próprio.
    await c.migrate.query('UPDATE pacientes SET ativo = false, desativado_em = now() WHERE id = $1', [
      c.pacienteDaOutra,
    ])
    expect(await lista()).toContain(aberta)
    const vizinha = await c.migrate.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM tarefas WHERE clinica_id = $1 AND id = $2',
      [c.outraClinica, c.tarefaDaOutra],
    )
    expect(vizinha.rows[0]!.n).toBe('1')
    expect(await lista()).not.toContain(c.tarefaDaOutra)
  })
})
