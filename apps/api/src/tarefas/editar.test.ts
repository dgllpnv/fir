import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  AMANHA,
  type Cenario,
  desmontarCenario,
  HOJE,
  limparTarefas,
  montarCenario,
  postar,
  remendar,
  tarefaCrua,
} from './__tests__/cenario'

let c: Cenario

beforeAll(async () => {
  c = await montarCenario('editar')
})
afterAll(async () => {
  await desmontarCenario(c)
})
beforeEach(async () => {
  await limparTarefas(c)
})

type Corpo = Record<string, unknown>

const criar = (corpo: Corpo, quem = 'juliana') => postar(c, '/v1/tarefas', corpo, quem)
const editar = (id: string, corpo: Corpo, quem = 'juliana') =>
  remendar(c, `/v1/tarefas/${id}`, corpo, quem)
const concluir = (id: string, corpo: Corpo, quem = 'juliana') =>
  postar(c, `/v1/tarefas/${id}/concluir`, corpo, quem)
const cancelar = (id: string, quem = 'juliana') => postar(c, `/v1/tarefas/${id}/cancelar`, {}, quem)

type TarefaDoCorpo = { readonly id: string; readonly prazo: string; readonly serieId: string | null }

async function nova(corpo: Corpo, quem = 'juliana'): Promise<TarefaDoCorpo> {
  const r = await criar(corpo, quem)
  expect(r.statusCode, JSON.stringify(r.body)).toBe(201)
  // `r.body` do supertest é `any`; o `as` nomeia o que de fato se lê.
  return r.body.tarefa as TarefaDoCorpo
}

/** A série semanal 02/11 · 09/11 · 16/11, em ordem de prazo. */
async function serieSemanal(extra: Corpo = {}): Promise<TarefaDoCorpo[]> {
  const r = await criar({
    vinculo: 'interna',
    responsavelId: c.pessoas['juliana'],
    descricao: 'Conferir o estoque da sala',
    quando: { modo: 'serie', inicio: '2026-11-02', freq: 'semanal', ate: '2026-11-16' },
    ...extra,
  })
  expect(r.statusCode, JSON.stringify(r.body)).toBe(201)
  return r.body.todas as TarefaDoCorpo[]
}

/** Os prazos da série, lidos DO BANCO, em ordem. */
async function prazosDaSerie(serieId: string): Promise<string[]> {
  const r = await c.migrate.query<{ prazo: string }>(
    'SELECT prazo::text AS prazo FROM tarefas WHERE serie_id = $1 AND excluida_em IS NULL ORDER BY prazo',
    [serieId],
  )
  return r.rows.map((x) => x.prazo)
}

const interna = (extra: Corpo = {}): Corpo => ({
  vinculo: 'interna',
  responsavelId: c.pessoas['juliana'],
  descricao: 'Conferir a agenda da tarde',
  quando: { modo: 'agendada', prazo: HOJE },
  ...extra,
})

describe('PATCH /v1/tarefas/:id · a série que anda junto', () => {
  it('adiar 3 dias com `serie` desloca as próximas em 3 dias, sem recalcular', async () => {
    const [primeira] = await serieSemanal()
    await editar(primeira!.id, { prazo: '2026-11-05', serie: true }).expect(200)
    expect(await prazosDaSerie(primeira!.serieId!)).toEqual([
      '2026-11-05',
      '2026-11-12',
      '2026-11-19',
    ])
  })

  it('sem `serie`, só esta muda', async () => {
    const [primeira] = await serieSemanal()
    await editar(primeira!.id, { prazo: '2026-11-05' }).expect(200)
    expect(await prazosDaSerie(primeira!.serieId!)).toEqual([
      '2026-11-05',
      '2026-11-09',
      '2026-11-16',
    ])
  })

  it('`serie` não toca nas CONCLUÍDAS — o passado não se reescreve', async () => {
    const [primeira, segunda, terceira] = await serieSemanal()
    await concluir(segunda!.id, { em: HOJE }).expect(200)

    const r = await editar(primeira!.id, { prazo: '2026-11-05', serie: true }).expect(200)
    expect((await tarefaCrua(c, segunda!.id))!['prazo']).toBe('2026-11-09')
    expect((await tarefaCrua(c, terceira!.id))!['prazo']).toBe('2026-11-19')
    // `todas` nomeia exatamente quem mudou: esta e a terceira.
    expect((r.body.todas as { id: string }[]).map((t) => t.id).sort()).toEqual(
      [primeira!.id, terceira!.id].sort(),
    )
  })

  it('`serie` não toca nas CANCELADAS', async () => {
    const [primeira, segunda] = await serieSemanal()
    await cancelar(segunda!.id).expect(200)
    await editar(primeira!.id, { prazo: '2026-11-05', serie: true }).expect(200)
    expect((await tarefaCrua(c, segunda!.id))!['prazo']).toBe('2026-11-09')
  })

  it('`serie` não toca nas de prazo ANTERIOR ao original', async () => {
    const [primeira, segunda, terceira] = await serieSemanal()
    await editar(segunda!.id, { prazo: '2026-11-12', serie: true }).expect(200)
    expect((await tarefaCrua(c, primeira!.id))!['prazo']).toBe('2026-11-02')
    expect((await tarefaCrua(c, terceira!.id))!['prazo']).toBe('2026-11-19')
  })

  it('`serie` propaga responsável, descrição, hora e prioridade — não o resultado', async () => {
    const [primeira, , terceira] = await serieSemanal()
    await editar(primeira!.id, {
      responsavelId: c.pessoas['beatriz'],
      descricao: 'Conferir o estoque da sala 2',
      hora: '08:15',
      prioridade: 'urgente',
      obs: 'só nesta',
      serie: true,
    }).expect(200)

    const t = (await tarefaCrua(c, terceira!.id))!
    expect(t['responsavel_id']).toBe(c.pessoas['beatriz'])
    expect(t['descricao']).toBe('Conferir o estoque da sala 2')
    expect(t['hora']).toBe('08:15:00')
    expect(t['prioridade']).toBe('urgente')
    // `obs` é desta ocorrência — a anotação de uma visita não vale para as
    // próximas doze.
    expect(t['obs']).toBe('')
  })

  it('`serie` numa tarefa sem série não afeta ninguém', async () => {
    const t = await nova(interna())
    const r = await editar(t.id, { prazo: AMANHA, serie: true }).expect(200)
    expect(r.body.todas).toHaveLength(1)
  })
})

describe('PATCH /v1/tarefas/:id · o que muda e o que não', () => {
  it('o responsável edita; quem não tem nada a ver, não', async () => {
    const t = await nova(interna({ responsavelId: c.pessoas['camila'] }))
    await editar(t.id, { descricao: 'Conferir a agenda da noite' }, 'camila').expect(200)

    const outra = await nova(interna({ responsavelId: c.pessoas['juliana'] }))
    expect((await editar(outra.id, { descricao: 'Mudar' }, 'camila')).statusCode).toBe(403)
  })

  it('quem tem `tarefas.equipe` edita a tarefa de qualquer um', async () => {
    const t = await nova(interna())
    await editar(t.id, { descricao: 'Mudado pela supervisão' }, 'beatriz').expect(200)
  })

  it('editar NÃO conclui — `pagamento` não existe no contrato de edição', async () => {
    const t = await nova(interna())
    const r = await editar(t.id, {
      descricao: 'Tentando lançar dinheiro por aqui',
      pagamento: { valor: '45000', forma: 'Pix' },
    })
    expect(r.statusCode).toBe(400)
    expect((await tarefaCrua(c, t.id))!['status']).toBe('aberta')
  })

  it('editar uma tarefa de outra clínica é 404, não 403', async () => {
    // 403 confirmaria que ela existe. A RLS já devolve zero linhas.
    const r = await editar(c.tarefaDaOutra, { descricao: 'Invadindo' })
    expect(r.statusCode).toBe(404)
  })

  it('trocar o paciente troca o vínculo, e o tipo vai junto', async () => {
    const t = await nova({
      vinculo: 'paciente',
      pacienteId: c.pacientes['ana'],
      tipo: 'Consulta agendada',
      responsavelId: c.pessoas['juliana'],
      quando: { modo: 'agendada', prazo: AMANHA },
    })
    const r = await editar(t.id, {
      pacienteId: c.pacientes['bruna'],
      tipo: 'Follow-up',
    }).expect(200)
    expect(r.body.tarefa.pacienteId).toBe(c.pacientes['bruna'])
    expect(r.body.tarefa.tipo).toBe('Follow-up')
  })

  it('tirar o paciente tira o tipo junto — o banco não aceita um sem o outro', async () => {
    const t = await nova({
      vinculo: 'paciente',
      pacienteId: c.pacientes['ana'],
      tipo: 'Follow-up',
      responsavelId: c.pessoas['juliana'],
      quando: { modo: 'agendada', prazo: AMANHA },
    })
    const r = await editar(t.id, { pacienteId: null }).expect(200)
    expect(r.body.tarefa.pacienteId).toBeNull()
    expect(r.body.tarefa.tipo).toBe('')
  })

  it('pôr um paciente numa tarefa interna sem dizer o tipo é recusado', async () => {
    const t = await nova(interna())
    const r = await editar(t.id, { pacienteId: c.pacientes['ana'] })
    expect(r.statusCode).toBe(400)
    expect(r.body.message).toContain('tipo')
  })

  it('o paciente de outra clínica não existe daqui', async () => {
    const t = await nova(interna())
    const r = await editar(t.id, { pacienteId: c.pacienteDaOutra, tipo: 'Follow-up' })
    expect(r.statusCode).toBe(400)
  })

  it('responsável inativo é recusado também na edição', async () => {
    const t = await nova(interna())
    const r = await editar(t.id, { responsavelId: c.pessoas['marta'] })
    expect(r.statusCode).toBe(400)
    expect(r.body.message).toContain('responsável ativo')
  })

  it('tipo do grupo Pagamentos é recusado na edição, como na criação', async () => {
    const t = await nova(interna())
    const r = await editar(t.id, { pacienteId: c.pacientes['ana'], tipo: 'Pagamento de consulta' })
    expect(r.statusCode).toBe(400)
    expect(r.body.message).toContain('Recebimento')
  })
})

describe('PATCH /v1/tarefas/:id · a data de realização', () => {
  it('acerta a data de realização de uma tarefa já concluída', async () => {
    const t = await nova(interna())
    await concluir(t.id, { em: HOJE }).expect(200)
    await editar(t.id, { realizadaEm: '2026-10-20' }).expect(200)

    const dia = await c.migrate.query<{ d: string }>(
      `SELECT (concluida_em AT TIME ZONE 'America/Bahia')::date::text AS d FROM tarefas WHERE id = $1`,
      [t.id],
    )
    expect(dia.rows[0]!.d).toBe('2026-10-20')
  })

  it('a data de realização no futuro é recusada — o servidor decide que dia é hoje', async () => {
    const t = await nova(interna())
    await concluir(t.id, { em: HOJE }).expect(200)
    const r = await editar(t.id, { realizadaEm: AMANHA })
    expect(r.statusCode).toBe(400)
    expect(r.body.message).toContain('até hoje')
  })

  it('data de realização numa tarefa ABERTA é recusada — editar não conclui', async () => {
    const t = await nova(interna())
    const r = await editar(t.id, { realizadaEm: '2026-10-20' })
    expect(r.statusCode).toBe(400)
    expect((await tarefaCrua(c, t.id))!['status']).toBe('aberta')
  })

  it('a data de realização vale SÓ para esta, nunca para a série', async () => {
    const [primeira, , terceira] = await serieSemanal()
    await concluir(primeira!.id, { em: HOJE }).expect(200)
    await editar(primeira!.id, { realizadaEm: '2026-10-20', serie: true }).expect(200)
    expect((await tarefaCrua(c, terceira!.id))!['concluida_em']).toBeNull()
  })
})
