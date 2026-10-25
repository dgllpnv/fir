import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  AMANHA,
  type Cenario,
  desmontarCenario,
  HOJE,
  limparTarefas,
  montarCenario,
  postar,
  receitaDoDia,
  recebimentosDe,
  tarefaCrua,
  vivosDe,
} from './__tests__/cenario'

let c: Cenario

beforeAll(async () => {
  c = await montarCenario('concluir')
})
afterAll(async () => {
  await desmontarCenario(c)
})
beforeEach(async () => {
  await limparTarefas(c)
})

type Corpo = Record<string, unknown>

const criar = (corpo: Corpo, quem = 'juliana') => postar(c, '/v1/tarefas', corpo, quem)
const concluir = (id: string, corpo: Corpo, quem = 'juliana') =>
  postar(c, `/v1/tarefas/${id}/concluir`, corpo, quem)
const cancelar = (id: string, corpo: Corpo = {}, quem = 'juliana') =>
  postar(c, `/v1/tarefas/${id}/cancelar`, corpo, quem)
const reabrir = (id: string, quem = 'juliana') => postar(c, `/v1/tarefas/${id}/reabrir`, {}, quem)

/** O mínimo que estes testes leem da tarefa criada. */
type TarefaDoCorpo = { readonly id: string; readonly descricao: string; readonly responsavelId: string }

/** Cria pela rota e devolve a tarefa, para encadear sem repetir o `.body`. */
async function nova(corpo: Corpo, quem = 'juliana'): Promise<TarefaDoCorpo> {
  const r = await criar(corpo, quem)
  // A mensagem do `expect` carrega o corpo: sem ela, um 400 aqui vira
  // "esperava 201, recebi 400" e o motivo fica a dez minutos de distância.
  expect(r.statusCode, JSON.stringify(r.body)).toBe(201)
  // `r.body` do supertest é `any`; o `as` nomeia o que de fato se lê.
  return r.body.tarefa as TarefaDoCorpo
}

const agendada = (extra: Corpo = {}): Corpo => ({
  vinculo: 'paciente',
  pacienteId: c.pacientes['ana'],
  tipo: 'Consulta agendada',
  responsavelId: c.pessoas['beatriz'],
  quando: { modo: 'agendada', prazo: HOJE },
  ...extra,
})

const contarTarefasDoPaciente = async (): Promise<number> => {
  const r = await c.migrate.query<{ n: string }>(
    'SELECT count(*)::text AS n FROM tarefas WHERE paciente_id = $1 AND excluida_em IS NULL',
    [c.pacientes['ana']],
  )
  return Number(r.rows[0]!.n)
}

describe('POST /v1/tarefas/:id/concluir', () => {
  it('"Consulta agendada" vira "Consulta realizada" NA MESMA TAREFA', async () => {
    const t = await nova(agendada())
    const antes = await contarTarefasDoPaciente()

    const r = await concluir(t.id, { em: HOJE }).expect(200)
    expect(r.body.tarefa.id).toBe(t.id)
    expect(r.body.tarefa.tipo).toBe('Consulta realizada')
    expect(r.body.tarefa.etapa).toBe('realizado')
    expect(r.body.tarefa.historico.at(-1)).toMatchObject({ acao: 'concluir', etapa: 'realizado' })
    // Nenhuma tarefa nova: a Jornada anda na mesma linha do tempo.
    expect(await contarTarefasDoPaciente()).toBe(antes)
  })

  it('a descrição que ERA o nome do tipo acompanha a mudança', async () => {
    const t = await nova(agendada({ descricao: undefined }))
    expect(t.descricao).toBe('Consulta agendada')
    const r = await concluir(t.id, { em: HOJE }).expect(200)
    expect(r.body.tarefa.descricao).toBe('Consulta realizada')
  })

  it('a descrição escrita à mão sobrevive à conclusão', async () => {
    const t = await nova(agendada({ descricao: 'Consulta de retorno, trazer exames' }))
    const r = await concluir(t.id, { em: HOJE }).expect(200)
    expect(r.body.tarefa.descricao).toBe('Consulta de retorno, trazer exames')
  })

  it('CONCLUIR não é EDITAR: concluir não mexe em prazo nem em responsável', async () => {
    const t = await nova(agendada({ quando: { modo: 'agendada', prazo: AMANHA } }))
    const r = await concluir(t.id, { em: HOJE }).expect(200)
    expect(r.body.tarefa.prazo).toBe(AMANHA)
    expect(r.body.tarefa.responsavelId).toBe(t.responsavelId)
  })

  it('o resultado é guardado, e a tarefa não vira outra coisa', async () => {
    const t = await nova(agendada())
    const r = await concluir(t.id, { em: HOJE, resultado: 'Paciente compareceu' }).expect(200)
    expect(r.body.tarefa.resultado).toBe('Paciente compareceu')
  })

  it('concluir com data futura é 400 — a data vem do servidor', async () => {
    const t = await nova(agendada())
    const r = await concluir(t.id, { em: AMANHA })
    expect(r.statusCode).toBe(400)
    expect(r.body.message).toContain('até hoje')
  })

  it('concluir uma tarefa já concluída é 409, e manda reabrir', async () => {
    const t = await nova(agendada())
    await concluir(t.id, { em: HOJE }).expect(200)
    const r = await concluir(t.id, { em: HOJE })
    expect(r.statusCode).toBe(409)
    expect(r.body.message).toContain('Reabra')
  })

  it('concluir uma tarefa cancelada é 409', async () => {
    const t = await nova(agendada())
    await cancelar(t.id).expect(200)
    const r = await concluir(t.id, { em: HOJE })
    expect(r.statusCode).toBe(409)
  })

  it('qualquer um conclui — concluir é registrar que foi feito', async () => {
    // `camila` não solicitou, não é responsável e não tem `tarefas.equipe`.
    const t = await nova(agendada())
    await concluir(t.id, { em: HOJE }, 'camila').expect(200)
  })

  it('a tarefa de outra clínica é 404, nunca 403 — 403 confirmaria que existe', async () => {
    const r = await concluir(c.tarefaDaOutra, { em: HOJE })
    expect(r.statusCode).toBe(404)
  })

  it('`pagamento` no corpo de EDITAR não existe — mas aqui existe, e conta uma vez', async () => {
    const t = await nova(agendada())
    const r = await concluir(
      t.id,
      { em: HOJE, pagamento: { valor: '45000', forma: 'Pix' } },
      'beatriz',
    ).expect(200)
    expect(r.body.tarefa.pagamento.valor).toBe('45000')
    expect(await vivosDe(c, t.id)).toHaveLength(1)
    expect(await receitaDoDia(c)).toBe(45000n)
  })

  it('o recebimento nasce com o tipo JÁ REALIZADO, não com o agendado', async () => {
    // Sem isso o pagamento ficaria classificado como "Consulta agendada" —
    // um nome que `infoDoTipo` não marca como receita, e o dinheiro sairia do
    // faturamento do mês sem erro nenhum.
    const t = await nova(agendada())
    await concluir(t.id, { em: HOJE, pagamento: { valor: '30000', forma: 'Pix' } }, 'beatriz')
    const [rec] = await recebimentosDe(c, t.id)
    const tipo = await c.migrate.query<{ tipo: string }>(
      'SELECT tipo FROM recebimentos WHERE id = $1',
      [rec!.id],
    )
    expect(tipo.rows[0]!.tipo).toBe('Consulta realizada')
  })

  it('pagamento num tipo que não guarda pagamento é recusado, e a tarefa fica ABERTA', async () => {
    const t = await nova(agendada({ tipo: 'Follow-up' }))
    const r = await concluir(
      t.id,
      { em: HOJE, pagamento: { valor: '45000', forma: 'Pix' } },
      'beatriz',
    )
    expect(r.statusCode).toBe(400)
    // A transação inteira voltou: nem a conclusão ficou.
    expect((await tarefaCrua(c, t.id))!['status']).toBe('aberta')
  })

  it('o instante da conclusão retroativa cai dentro do dia pedido', async () => {
    const t = await nova(agendada())
    const r = await concluir(t.id, { em: '2026-10-20' }).expect(200)
    const dia = await c.migrate.query<{ d: string }>(
      `SELECT (concluida_em AT TIME ZONE 'America/Bahia')::date::text AS d FROM tarefas WHERE id = $1`,
      [t.id],
    )
    expect(dia.rows[0]!.d).toBe('2026-10-20')
    expect(r.body.tarefa.atrasada).toBe(false)
  })
})

describe('POST /v1/tarefas/:id/cancelar', () => {
  it('o responsável NÃO pode cancelar; quem solicitou pode', async () => {
    // Solicitante: juliana. Responsável: beatriz — que TEM `tarefas.equipe`,
    // então ela cancelaria por outro caminho. A tarefa aqui é responsabilidade
    // de `camila`, que não tem nada além de ver pacientes.
    const t = await nova(agendada({ responsavelId: c.pessoas['camila'] }))
    expect((await cancelar(t.id, {}, 'camila')).statusCode).toBe(403)
    expect((await cancelar(t.id, {}, 'juliana')).statusCode).toBe(200)
  })

  it('quem tem `tarefas.equipe` cancela a tarefa de outra pessoa', async () => {
    const t = await nova(agendada({ responsavelId: c.pessoas['camila'] }), 'camila')
    await cancelar(t.id, {}, 'beatriz').expect(200)
    expect((await tarefaCrua(c, t.id))!['status']).toBe('cancelada')
  })

  it('cancelar guarda o motivo em obs e não carimba conclusão', async () => {
    const t = await nova(agendada())
    const r = await cancelar(t.id, { obs: 'Paciente desmarcou por telefone' }).expect(200)
    expect(r.body.tarefa.status).toBe('cancelada')
    expect(r.body.tarefa.obs).toBe('Paciente desmarcou por telefone')
    expect(r.body.tarefa.concluidaEm).toBeNull()
  })

  it('cancelar uma tarefa já concluída é 409', async () => {
    const t = await nova(agendada())
    await concluir(t.id, { em: HOJE }).expect(200)
    expect((await cancelar(t.id)).statusCode).toBe(409)
  })
})

describe('POST /v1/tarefas/:id/reabrir', () => {
  it('reabrir ESTORNA o recebimento embutido e a receita do dia volta a zero', async () => {
    const t = await nova(agendada())
    await concluir(t.id, { em: HOJE, pagamento: { valor: '45000', forma: 'Pix' } }, 'beatriz')
    expect(await receitaDoDia(c)).toBe(45000n)

    const r = await reabrir(t.id).expect(200)
    expect(r.body.tarefa.status).toBe('aberta')
    expect(r.body.tarefa.concluidaEm).toBeNull()
    expect(r.body.tarefa.pagamento).toBeNull()
    expect(await receitaDoDia(c)).toBe(0n)
    const [rec] = await recebimentosDe(c, t.id)
    expect(rec!.estornado_em).not.toBeNull()
  })

  it('concluir de novo depois de reabrir cria UM recebimento vivo, não dois', async () => {
    const t = await nova(agendada())
    await concluir(t.id, { em: HOJE, pagamento: { valor: '45000', forma: 'Pix' } }, 'beatriz')
    await reabrir(t.id).expect(200)
    await concluir(t.id, { em: HOJE, pagamento: { valor: '50000', forma: 'Pix' } }, 'beatriz').expect(200)

    expect(await vivosDe(c, t.id)).toHaveLength(1)
    expect(await recebimentosDe(c, t.id)).toHaveLength(2)
    expect(await receitaDoDia(c)).toBe(50000n)
  })

  it('o estorno é um registro NOVO na trilha, nunca um DELETE', async () => {
    const t = await nova(agendada())
    await concluir(t.id, { em: HOJE, pagamento: { valor: '45000', forma: 'Pix' } }, 'beatriz')
    const [rec] = await recebimentosDe(c, t.id)

    await reabrir(t.id).expect(200)

    const trilha = await c.migrate.query<{ acao: string; de: unknown; para: unknown }>(
      `SELECT acao, de, para FROM auditoria
        WHERE clinica_id = $1 AND entidade = 'recebimentos' AND entidade_id = $2
        ORDER BY id`,
      [c.clinica, rec!.id],
    )
    expect(trilha.rows.map((x) => x.acao)).toEqual(['criou', 'alterou'])
    // A linha continua lá: estornar é um estado, nunca uma exclusão (regra 20).
    const ainda = await c.migrate.query('SELECT 1 FROM recebimentos WHERE id = $1', [rec!.id])
    expect(ainda.rowCount).toBe(1)
  })

  it('reabrir uma tarefa ABERTA é 409 — não há o que reabrir', async () => {
    const t = await nova(agendada())
    const r = await reabrir(t.id)
    expect(r.statusCode).toBe(409)
  })

  it('reabrir uma CANCELADA a devolve para aberta', async () => {
    const t = await nova(agendada())
    await cancelar(t.id).expect(200)
    const r = await reabrir(t.id).expect(200)
    expect(r.body.tarefa.status).toBe('aberta')
  })

  it('quem não tem nada a ver com a tarefa não reabre', async () => {
    const t = await nova(agendada({ responsavelId: c.pessoas['juliana'] }), 'juliana')
    expect((await reabrir(t.id, 'camila')).statusCode).toBe(403)
  })
})

/* ------------------------------------------------- a etapa, depois da 0007 */

describe('cancelar e reabrir movem a ETAPA — o CHECK da 0007 não deixa escolha', () => {
  it('cancelar um cartão da jornada o deixa em `encerrado`, não em `agendado`', async () => {
    // Antes da 0007 esta rota gravava `cancelada` sem tocar na etapa, e o
    // cartão ficava `agendado`/`cancelada`: saber onde ele está exigia DUAS
    // colunas, que é o que o protótipo faz.
    const t = await nova(agendada())
    const r = await cancelar(t.id, { obs: 'mudou de cidade' }).expect(200)
    expect(r.body.tarefa.etapa).toBe('encerrado')
    expect(r.body.tarefa.status).toBe('cancelada')
    expect(r.body.tarefa.historico.at(-1)).toMatchObject({
      acao: 'encerrar',
      etapa: 'encerrado',
      nota: 'mudou de cidade',
    })
    // NÃO SOME do banco: encerrar é um estado (regra 20).
    expect(await tarefaCrua(c, t.id)).toBeDefined()
  })

  it('cancelar uma tarefa INTERNA não inventa etapa nenhuma', async () => {
    const r0 = await criar({
      vinculo: 'interna',
      descricao: 'Pedir toner',
      responsavelId: c.pessoas['juliana'],
      quando: { modo: 'agendada', prazo: HOJE },
    })
    const id = r0.body.tarefa.id as string
    const r = await cancelar(id).expect(200)
    expect(r.body.tarefa.etapa).toBeNull()
    expect(r.body.tarefa.historico).toEqual([])
  })

  it('reabrir uma CANCELADA devolve a etapa anterior, não `agendado` por padrão', async () => {
    // O cartão volta para onde estava. Com um `etapa = agendado` escrito à mão
    // no serviço, quem nunca faltou iria para o Recontatar e quem faltou sairia.
    const t = await nova(agendada())
    await cancelar(t.id).expect(200)
    const r = await reabrir(t.id).expect(200)
    expect(r.body.tarefa.etapa).toBe('agendado')
    expect(r.body.tarefa.status).toBe('aberta')
    expect(r.body.tarefa.historico.at(-1)).toMatchObject({ acao: 'reabrir', etapa: 'agendado' })
  })

  it('reabrir uma CONCLUÍDA devolve a etapa para `agendado` e o histórico CRESCE', async () => {
    const t = await nova(agendada())
    await concluir(t.id, { em: HOJE }).expect(200)
    const r = await reabrir(t.id).expect(200)
    expect(r.body.tarefa.etapa).toBe('agendado')
    expect(r.body.tarefa.status).toBe('aberta')
    // Três eventos: agendar, concluir, reabrir. Nenhum foi apagado — desfazer
    // é um evento novo (regra 20).
    expect(r.body.tarefa.historico.map((h: { acao: string }) => h.acao)).toEqual([
      'agendar',
      'concluir',
      'reabrir',
    ])
  })

  it('o histórico de cancelar/reabrir é APPEND-ONLY: o prefixo nunca muda', async () => {
    const t = await nova(agendada())
    const antes = (await buscarHistorico(t.id)).length
    await cancelar(t.id).expect(200)
    await reabrir(t.id).expect(200)
    const depois = await buscarHistorico(t.id)
    expect(depois).toHaveLength(antes + 2)
  })

  it('cancelar e reabrir deixam o par etapa↔status SEMPRE válido no banco', async () => {
    // Se não deixassem, o `CHECK` recusaria e a rota devolveria 500. Este
    // teste existe para que o 500 não volte em silêncio num caminho novo.
    const t = await nova(agendada())
    for (const passo of [cancelar, reabrir, cancelar, reabrir]) {
      await passo(t.id).expect(200)
      const crua = (await tarefaCrua(c, t.id))!
      expect([crua.etapa, crua.status]).toEqual(
        crua.status === 'cancelada' ? ['encerrado', 'cancelada'] : ['agendado', 'aberta'],
      )
    }
  })
})

async function buscarHistorico(id: string): Promise<unknown[]> {
  const crua = (await tarefaCrua(c, id))!
  return crua['historico'] as unknown[]
}
