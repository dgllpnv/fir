import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  apagar,
  type Cenario,
  desmontarCenario,
  HOJE,
  limparTarefas,
  montarCenario,
  pegar,
  postar,
  tarefaCrua,
} from './__tests__/cenario'

let c: Cenario

beforeAll(async () => {
  c = await montarCenario('excluir')
})
afterAll(async () => {
  await desmontarCenario(c)
})
beforeEach(async () => {
  await limparTarefas(c)
})

type Corpo = Record<string, unknown>

const criar = (corpo: Corpo, quem = 'juliana') => postar(c, '/v1/tarefas', corpo, quem)
const excluir = (id: string, consulta: Record<string, string> = {}, quem = 'juliana') =>
  apagar(c, `/v1/tarefas/${id}`, consulta, quem)
const concluir = (id: string, corpo: Corpo, quem = 'juliana') =>
  postar(c, `/v1/tarefas/${id}/concluir`, corpo, quem)

type TarefaDoCorpo = { readonly id: string; readonly serieId: string | null }

async function nova(corpo: Corpo, quem = 'juliana'): Promise<TarefaDoCorpo> {
  const r = await criar(corpo, quem)
  expect(r.statusCode, JSON.stringify(r.body)).toBe(201)
  // `r.body` do supertest é `any`; o `as` nomeia o que de fato se lê.
  return r.body.tarefa as TarefaDoCorpo
}

async function serieSemanal(): Promise<TarefaDoCorpo[]> {
  const r = await criar({
    vinculo: 'interna',
    responsavelId: c.pessoas['juliana'],
    descricao: 'Conferir o estoque da sala',
    quando: { modo: 'serie', inicio: '2026-11-02', freq: 'semanal', ate: '2026-11-16' },
  })
  expect(r.statusCode, JSON.stringify(r.body)).toBe(201)
  return r.body.todas as TarefaDoCorpo[]
}

const interna = (extra: Corpo = {}): Corpo => ({
  vinculo: 'interna',
  responsavelId: c.pessoas['juliana'],
  descricao: 'Conferir a agenda da tarde',
  quando: { modo: 'agendada', prazo: HOJE },
  ...extra,
})

const vivasDaSerie = async (serieId: string): Promise<number> => {
  const r = await c.migrate.query<{ n: string }>(
    'SELECT count(*)::text AS n FROM tarefas WHERE serie_id = $1 AND excluida_em IS NULL',
    [serieId],
  )
  return Number(r.rows[0]!.n)
}

describe('DELETE /v1/tarefas/:id', () => {
  it('excluir é SOFT DELETE: a linha fica, com o instante', async () => {
    const t = await nova(interna())
    const r = await excluir(t.id).expect(200)
    expect(r.body.ids).toEqual([t.id])

    // Contra a v20, que faz `sh.deleteRow`. A tarefa que alguém excluiu "por
    // engano" às vezes é a que tinha o pagamento (regra 20).
    const crua = await tarefaCrua(c, t.id)
    expect(crua).toBeDefined()
    expect(crua!['excluida_em']).not.toBeNull()
  })

  it('a exclusão entra na trilha como alteração, nunca como remoção', async () => {
    const t = await nova(interna())
    await excluir(t.id).expect(200)
    const trilha = await c.migrate.query<{ acao: string }>(
      `SELECT acao FROM auditoria WHERE entidade = 'tarefas' AND entidade_id = $1 ORDER BY id`,
      [t.id],
    )
    expect(trilha.rows.map((x) => x.acao)).toEqual(['criou', 'alterou'])
  })

  it('excluir só esta deixa as outras da série em paz', async () => {
    const [, segunda] = await serieSemanal()
    const r = await excluir(segunda!.id).expect(200)
    expect(r.body.ids).toHaveLength(1)
    expect(await vivasDaSerie(segunda!.serieId!)).toBe(2)
  })

  it('excluir "esta e as próximas" não toca nas anteriores nem nas concluídas', async () => {
    const [primeira, segunda, terceira] = await serieSemanal()
    const r = await excluir(segunda!.id, { serie: 'true' }).expect(200)

    expect((r.body.ids as string[]).sort()).toEqual([segunda!.id, terceira!.id].sort())
    expect((await tarefaCrua(c, primeira!.id))!['excluida_em']).toBeNull()
  })

  it('`serie=true` não alcança as concluídas', async () => {
    const [primeira, segunda, terceira] = await serieSemanal()
    await concluir(terceira!.id, { em: HOJE }).expect(200)
    const r = await excluir(primeira!.id, { serie: 'true' }).expect(200)
    expect((r.body.ids as string[]).sort()).toEqual([primeira!.id, segunda!.id].sort())
    expect((await tarefaCrua(c, terceira!.id))!['excluida_em']).toBeNull()
  })

  it('`serie=false` na consulta NÃO vira `true` — a string "false" é falsa aqui', async () => {
    // `z.coerce.boolean()` faria `Boolean('false') === true`, e a recepção que
    // pediu para excluir UMA ocorrência perderia a série inteira.
    const [, segunda] = await serieSemanal()
    const r = await excluir(segunda!.id, { serie: 'false' }).expect(200)
    expect(r.body.ids).toHaveLength(1)
    expect(await vivasDaSerie(segunda!.serieId!)).toBe(2)
  })

  it('excluir uma tarefa com recebimento é recusado — estorne primeiro', async () => {
    const t = await nova({
      vinculo: 'paciente',
      pacienteId: c.pacientes['ana'],
      tipo: 'Consulta realizada',
      responsavelId: c.pessoas['juliana'],
      quando: { modo: 'retroativo', em: HOJE, pagamento: { valor: '45000', forma: 'Pix' } },
    }, 'beatriz')

    const r = await excluir(t.id, {}, 'beatriz')
    expect(r.statusCode).toBe(409)
    expect(r.body.message).toContain('Reabra a tarefa')
    expect((await tarefaCrua(c, t.id))!['excluida_em']).toBeNull()
  })

  it('depois de reabrir — que estorna — a exclusão passa', async () => {
    const t = await nova({
      vinculo: 'paciente',
      pacienteId: c.pacientes['ana'],
      tipo: 'Consulta realizada',
      responsavelId: c.pessoas['juliana'],
      quando: { modo: 'retroativo', em: HOJE, pagamento: { valor: '45000', forma: 'Pix' } },
    }, 'beatriz')

    await postar(c, `/v1/tarefas/${t.id}/reabrir`, {}, 'beatriz').expect(200)
    await excluir(t.id, {}, 'beatriz').expect(200)
  })

  it('o responsável NÃO exclui — ele conserta o que vai executar, não apaga o pedido', async () => {
    const t = await nova(interna({ responsavelId: c.pessoas['camila'] }))
    const r = await excluir(t.id, {}, 'camila')
    expect(r.statusCode).toBe(403)
    expect((await tarefaCrua(c, t.id))!['excluida_em']).toBeNull()
  })

  it('quem tem `tarefas.equipe` exclui a de outra pessoa', async () => {
    const t = await nova(interna({ responsavelId: c.pessoas['camila'] }), 'camila')
    await excluir(t.id, {}, 'beatriz').expect(200)
  })

  it('excluir a tarefa de outra clínica é 404', async () => {
    expect((await excluir(c.tarefaDaOutra)).statusCode).toBe(404)
  })

  it('excluir duas vezes é 404 na segunda — ela já não existe para ninguém', async () => {
    const t = await nova(interna())
    await excluir(t.id).expect(200)
    expect((await excluir(t.id)).statusCode).toBe(404)
  })

  it('a tarefa excluída some da ficha do paciente', async () => {
    const t = await nova({
      vinculo: 'paciente',
      pacienteId: c.pacientes['ana'],
      tipo: 'Follow-up',
      responsavelId: c.pessoas['juliana'],
      quando: { modo: 'agendada', prazo: HOJE },
    })
    await excluir(t.id).expect(200)

    const ficha = await pegar(c, `/v1/pacientes/${c.pacientes['ana']}`).expect(200)
    expect((ficha.body.tarefas as { id: string }[]).map((x) => x.id)).not.toContain(t.id)
  })
})
