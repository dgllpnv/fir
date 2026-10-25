import pg from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { declararAtorSistema } from '../banco/limpeza-de-teste'
import {
  AMANHA,
  type Cenario,
  desmontarCenario,
  HOJE,
  limparTarefas,
  montarCenario,
  ONTEM,
  postar,
  tarefaCrua,
} from '../tarefas/__tests__/cenario'

/**
 * `POST /v1/tarefas/:id/jornada` — UMA ROTA, não dez.
 *
 * O invariante que estes testes existem para proteger: **é sempre A MESMA
 * `Tarefa`**. Nunca uma tarefa nova por etapa — se fosse, o funil contaria a
 * mesma paciente cinco vezes e a taxa de no-show seria calculada sobre um
 * denominador inflado.
 *
 * E `faltou`/`desmarcou` mantêm o cartão ABERTO, com `proximo_passo_em` em
 * hoje, até alguém reagendar ou encerrar. É o que faz a ferramenta cobrar
 * sozinha.
 */
let c: Cenario

beforeAll(async () => {
  c = await montarCenario('jornada')
})
afterAll(async () => {
  await desmontarCenario(c)
})
beforeEach(async () => {
  await limparTarefas(c)
})

type Corpo = Record<string, unknown>

const mover = (id: string, corpo: Corpo, quem = 'juliana') =>
  postar(c, `/v1/tarefas/${id}/jornada`, corpo, quem)
const criar = (corpo: Corpo, quem = 'juliana') => postar(c, '/v1/tarefas', corpo, quem)
const concluir = (id: string, corpo: Corpo = { em: HOJE }, quem = 'juliana') =>
  postar(c, `/v1/tarefas/${id}/concluir`, corpo, quem)

const agendada = (extra: Corpo = {}): Corpo => ({
  vinculo: 'paciente',
  pacienteId: c.pacientes['ana'],
  tipo: 'Consulta agendada',
  responsavelId: c.pessoas['juliana'],
  quando: { modo: 'agendada', prazo: HOJE },
  ...extra,
})

/** Cria pela rota e devolve o id, com a mensagem de erro à mão se falhar. */
async function nova(corpo: Corpo = agendada(), quem = 'juliana'): Promise<string> {
  const r = await criar(corpo, quem)
  expect(r.statusCode, JSON.stringify(r.body)).toBe(201)
  return r.body.tarefa.id as string
}

type Tarefa = {
  id: string
  etapa: string | null
  status: string
  prazo: string
  hora: string | null
  proximoPassoEm: string | null
  confirmacaoEnviadaEm: string | null
  historico: { acao: string; etapa: string; nota?: string; porId: string }[]
}

const corpoDe = (r: { body: unknown }): Tarefa => (r.body as { tarefa: Tarefa }).tarefa

const URL_MIG =
  process.env['DATABASE_URL_MIGRATE'] ?? 'postgresql://fir_migrate:fir_local_dev@127.0.0.1:4832/fir'

/**
 * A BARREIRA: espera até o Postgres relatar um lock PEDIDO E NÃO CONCEDIDO.
 *
 * É o que falta para um teste de corrida ser determinístico em vez de
 * provável — o épico 2 desistiu desta prova por não ter a barreira
 * (`epico2-base-report.md`, item 1).
 *
 * `pg_locks`, e NÃO `pg_stat_activity`: medido, `fir_migrate` não é
 * superusuário nem tem `pg_read_all_stats`, então as colunas `state` e
 * `wait_event_type` dos backends de OUTRO papel vêm `NULL` e a `query` vem
 * `<insufficient privilege>`. A espera nunca terminava, e o erro acusava
 * ausência de `FOR UPDATE` onde o que faltava era privilégio de leitura.
 * `pg_locks` não esconde nada de ninguém.
 */
async function esperarLockEmEspera(cli: pg.Client, tentativas = 300): Promise<void> {
  for (let i = 0; i < tentativas; i++) {
    const r = await cli.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM pg_locks WHERE NOT granted',
    )
    if (r.rows[0]!.n > 0) return
    await new Promise((resolver) => setTimeout(resolver, 10))
  }
  throw new Error(
    'nenhum lock ficou em espera: a rota NÃO tomou `FOR UPDATE`, ou a ' +
      'requisição não chegou ao banco',
  )
}

const historicoNoBanco = async (id: string): Promise<unknown[]> =>
  (await tarefaCrua(c, id))!['historico'] as unknown[]

const contarTarefasDaAna = async (): Promise<number> => {
  const r = await c.migrate.query<{ n: string }>(
    'SELECT count(*)::text AS n FROM tarefas WHERE paciente_id = $1 AND excluida_em IS NULL',
    [c.pacientes['ana']],
  )
  return Number(r.rows[0]!.n)
}

/* ------------------------------------------- é a mesma tarefa, sempre */

describe('o invariante: uma tarefa só, andando pelas etapas', () => {
  it('É A MESMA TAREFA — nenhuma tarefa nova por etapa', async () => {
    const id = await nova()
    const antes = await contarTarefasDaAna()
    for (const corpo of [
      { acao: 'confirmar' },
      { acao: 'noshow' },
      { acao: 'reagendar', prazo: AMANHA },
    ]) {
      const r = await mover(id, corpo)
      expect(r.statusCode, JSON.stringify(r.body)).toBe(200)
      expect(corpoDe(r).id).toBe(id)
    }
    expect(await contarTarefasDaAna()).toBe(antes)
  })

  it('NO-SHOW MANTÉM O CARTÃO ABERTO e marca o passo para HOJE', async () => {
    const id = await nova()
    const t = corpoDe(await mover(id, { acao: 'noshow' }).expect(200))
    expect(t.etapa).toBe('faltou')
    expect(t.status).toBe('aberta') // NÃO concluida, NÃO cancelada
    expect(t.proximoPassoEm).toBe(HOJE)
    expect(t.historico.at(-1)).toMatchObject({
      acao: 'noshow',
      etapa: 'faltou',
      nota: `não compareceu em 24/10/2026`,
    })
  })

  it('DESMARCOU MANTÉM O CARTÃO ABERTO, com o motivo livre', async () => {
    const id = await nova()
    const t = corpoDe(await mover(id, { acao: 'desmarcar', nota: 'viagem' }).expect(200))
    expect(t.etapa).toBe('desmarcou')
    expect(t.status).toBe('aberta')
    expect(t.proximoPassoEm).toBe(HOJE)
    expect(t.historico.at(-1)).toMatchObject({ acao: 'desmarcar', nota: 'viagem' })
  })

  it('confirmar muda a etapa e nada mais', async () => {
    const id = await nova()
    const t = corpoDe(await mover(id, { acao: 'confirmar' }).expect(200))
    expect(t.etapa).toBe('confirmado')
    expect(t.status).toBe('aberta')
    expect(t.proximoPassoEm).toBeNull()
    expect(t.historico.at(-1)).toMatchObject({ acao: 'confirmar', etapa: 'confirmado' })
    expect(t.historico.at(-1)?.nota).toBeUndefined()
  })

  it('enviar confirmação registra O ENVIO, não a resposta da paciente', async () => {
    // O disparo pelo WhatsApp é do épico 10. Aqui fica só o registro — e a
    // etapa NÃO vira `confirmado`: a paciente ainda não respondeu.
    const id = await nova()
    const t = corpoDe(await mover(id, { acao: 'enviarConfirmacao' }).expect(200))
    expect(t.etapa).toBe('agendado')
    expect(t.confirmacaoEnviadaEm).not.toBeNull()
    expect(t.historico.at(-1)).toMatchObject({
      acao: 'enviarConfirmacao',
      etapa: 'agendado',
      nota: 'mensagem pelo WhatsApp',
    })
  })
})

/* ------------------------------------------------------------- reagendar */

describe('reagendar', () => {
  it('volta para agendado, limpa o passo e a confirmação enviada', async () => {
    const id = await nova()
    await mover(id, { acao: 'enviarConfirmacao' }).expect(200)
    await mover(id, { acao: 'noshow' }).expect(200)
    const t = corpoDe(await mover(id, { acao: 'reagendar', prazo: '2026-11-03', hora: '09:30' }).expect(200))
    expect(t.etapa).toBe('agendado')
    expect(t.status).toBe('aberta')
    expect(t.prazo).toBe('2026-11-03')
    expect(t.hora).toBe('09:30')
    expect(t.proximoPassoEm).toBeNull()
    expect(t.confirmacaoEnviadaEm).toBeNull()
    expect(t.historico.at(-1)).toMatchObject({
      acao: 'reagendar',
      etapa: 'agendado',
      nota: 'de 24/10/2026 para 03/11/2026 09:30',
    })
  })

  it('reagendar para uma data passada é 400 — contra o HOJE DO SERVIDOR', async () => {
    // `RelogioFixo` em 2026-10-25T02:00:00Z. Em America/Bahia ainda é 24/10,
    // então "2026-10-24" é HOJE e passa; "2026-10-23" é 400. Um cliente com o
    // relógio adiantado não muda nenhum dos dois (regra 24).
    const id = await nova()
    expect((await mover(id, { acao: 'reagendar', prazo: HOJE })).statusCode).toBe(200)
    const r = await mover(id, { acao: 'reagendar', prazo: ONTEM })
    expect(r.statusCode).toBe(400)
    expect(r.body.message).toContain('a partir de hoje')
    // E o cartão NÃO se moveu.
    expect((await tarefaCrua(c, id))!['prazo']).toBe(HOJE)
  })

  it('reagendar sem hora limpa a hora anterior', async () => {
    const id = await nova(agendada({ quando: { modo: 'agendada', prazo: HOJE, hora: '08:00' } }))
    const t = corpoDe(await mover(id, { acao: 'reagendar', prazo: AMANHA }).expect(200))
    expect(t.hora).toBeNull()
  })

  it('reagendar alcança os quatro estados em aberto', async () => {
    for (const antes of [
      [] as Corpo[],
      [{ acao: 'confirmar' }],
      [{ acao: 'noshow' }],
      [{ acao: 'desmarcar' }],
    ]) {
      const id = await nova()
      for (const p of antes) await mover(id, p).expect(200)
      expect(
        (await mover(id, { acao: 'reagendar', prazo: AMANHA })).statusCode,
        JSON.stringify(antes),
      ).toBe(200)
    }
  })
})

/* -------------------------------------------------------------- encerrar */

describe('encerrar', () => {
  it('cancela mas NÃO apaga — a trilha fica', async () => {
    const id = await nova()
    const antes = (await mover(id, { acao: 'desmarcar', nota: 'viagem' }).expect(200)).body.tarefa
      .historico.length as number
    const t = corpoDe(await mover(id, { acao: 'encerrar', nota: 'mudou de cidade' }).expect(200))
    expect(t.etapa).toBe('encerrado')
    expect(t.status).toBe('cancelada')
    expect(t.proximoPassoEm).toBeNull()
    expect(await tarefaCrua(c, id)).toBeDefined()
    expect(t.historico).toHaveLength(antes + 1)
    expect(t.historico.at(-1)).toMatchObject({ acao: 'encerrar', nota: 'mudou de cidade' })
  })

  it('encerrar um cartão AGENDADO é 409 — para isso existe cancelar', async () => {
    const id = await nova()
    const r = await mover(id, { acao: 'encerrar' })
    expect(r.statusCode).toBe(409)
  })
})

/* --------------------------------------------------------------- reabrir */

describe('reabrir pela rota da jornada', () => {
  it('restaura a etapa anterior, não "agendado" por padrão', async () => {
    const id = await nova()
    await mover(id, { acao: 'noshow' }).expect(200)
    await concluir(id).expect(200)
    const t = corpoDe(await mover(id, { acao: 'reabrir' }).expect(200))
    expect(t.etapa).toBe('faltou')
    expect(t.status).toBe('aberta')
  })

  it('é a MESMA implementação da rota do épico 2 — duas portas, um efeito', async () => {
    const a = await nova()
    const b = await nova()
    for (const id of [a, b]) {
      await mover(id, { acao: 'desmarcar' }).expect(200)
      await concluir(id).expect(200)
    }
    const pelaJornada = corpoDe(await mover(a, { acao: 'reabrir' }).expect(200))
    const pelaRota = corpoDe(await postar(c, `/v1/tarefas/${b}/reabrir`, {}).expect(200))
    expect(pelaJornada.etapa).toBe(pelaRota.etapa)
    expect(pelaJornada.status).toBe(pelaRota.status)
    expect(pelaJornada.historico.at(-1)?.acao).toBe(pelaRota.historico.at(-1)?.acao)
  })

  it('reabrir um cartão JÁ ABERTO é 409', async () => {
    const id = await nova()
    expect((await mover(id, { acao: 'reabrir' })).statusCode).toBe(409)
  })
})

/* ------------------------------------------------------- o que é proibido */

describe('transição proibida, 404 × 409 × 403', () => {
  it('transição proibida é 409, com a mensagem que a recepção já conhece', async () => {
    const id = await nova()
    await mover(id, { acao: 'confirmar' }).expect(200)
    const r = await mover(id, { acao: 'confirmar' })
    expect(r.statusCode).toBe(409)
    expect(r.body.message).toContain('ainda não aconteceu')
  })

  it('um cartão CONCLUÍDO recusa as ações de agenda', async () => {
    const id = await nova()
    await concluir(id).expect(200)
    for (const acao of ['confirmar', 'noshow', 'desmarcar', 'enviarConfirmacao'] as const) {
      const r = await mover(id, { acao })
      expect(r.statusCode, acao).toBe(409)
      expect(r.body.message, acao).toContain('não vale para a situação atual')
    }
    // E o cartão continua onde estava.
    expect((await tarefaCrua(c, id))!['etapa']).toBe('realizado')
  })

  it('TAREFA QUE NÃO É DA JORNADA é 404, não 409', async () => {
    // Uma tarefa interna, ou um Follow-up: `etapa IS NULL`. 409 diria que ela
    // existe e que a AÇÃO é que está errada — e ela nem é um agendamento.
    const interna = await nova({
      vinculo: 'interna',
      descricao: 'Pedir toner',
      responsavelId: c.pessoas['juliana'],
      quando: { modo: 'agendada', prazo: HOJE },
    })
    const r = await mover(interna, { acao: 'confirmar' })
    expect(r.statusCode).toBe(404)
    expect(r.body.message).toContain('Agendamento não encontrado')

    const followUp = await nova(agendada({ tipo: 'Follow-up' }))
    expect((await mover(followUp, { acao: 'confirmar' })).statusCode).toBe(404)
  })

  it('tarefa inexistente é 404', async () => {
    const r = await mover('11111111-1111-4111-8111-111111111111', { acao: 'confirmar' })
    expect(r.statusCode).toBe(404)
  })

  it('SEM a permissão `jornada`, 403 — e o cartão não se move', async () => {
    // `camila` tem `valores` e não tem `jornada`: o 403 não pode ser confundido
    // com falta de permissão de dinheiro.
    const id = await nova()
    const r = await mover(id, { acao: 'confirmar' }, 'camila')
    expect(r.statusCode).toBe(403)
    expect((await tarefaCrua(c, id))!['etapa']).toBe('agendado')
  })

  it('cartão de OUTRA CLÍNICA é 404, nem com o id na mão', async () => {
    const r = await mover(c.tarefaDaOutra, { acao: 'confirmar' })
    expect(r.statusCode).toBe(404)
  })

  it('corpo inválido é 400, e a etapa NÃO vem do cliente', async () => {
    const id = await nova()
    expect((await mover(id, { acao: 'arquivar' })).statusCode).toBe(400)
    expect((await mover(id, { acao: 'confirmar', etapa: 'fechado' })).statusCode).toBe(400)
    expect((await mover(id, { acao: 'reagendar' })).statusCode).toBe(400)
    expect((await tarefaCrua(c, id))!['etapa']).toBe('agendado')
  })
})

/* ------------------------------------------------- histórico e concorrência */

describe('o histórico cresce no BANCO, nunca em JavaScript', () => {
  it('é append-only pela rota: nenhum evento some, e o prefixo nunca muda', async () => {
    const id = await nova()
    const antes = await historicoNoBanco(id)
    await mover(id, { acao: 'confirmar' }).expect(200)
    const depois = await historicoNoBanco(id)
    expect(depois.slice(0, antes.length)).toEqual(antes)
    expect(depois).toHaveLength(antes.length + 1)
  })

  it('a segunda vez que o MESMO botão é tocado é 409, não um evento repetido', async () => {
    // Sequencial de propósito. A versão concorrente deste teste, por HTTP, é
    // NÃO-DETERMINÍSTICA nesta árvore — medido: cinco requisições em
    // `Promise.all` com o `FOR UPDATE` REMOVIDO passam em 4 de 5 rodadas,
    // porque `resolver_sessao` toma um lock na linha da sessão e serializa
    // requisições do MESMO cookie. Teste que passa em 4 de 5 ensina a equipe
    // a rodar de novo até passar.
    //
    // A corrida de verdade é provada no banco, de forma determinística, em
    // `teste/jornada-banco.test.ts` ("a corrida de duas escritas"): lá as duas
    // transações são conduzidas à mão e o interleave é escolhido, não
    // esperado.
    const id = await nova()
    expect((await mover(id, { acao: 'confirmar' })).statusCode).toBe(200)
    const r = await mover(id, { acao: 'confirmar' })
    expect(r.statusCode).toBe(409)
    expect(await historicoNoBanco(id)).toHaveLength(2) // agendar + confirmar
  })

  it('duas ações legítimas em sequência gravam as DUAS', async () => {
    // `enviarConfirmacao` sai de `agendado` E volta para `agendado`, então
    // chamá-la duas vezes é duas vezes válido — e as duas TÊM de ficar no
    // histórico. É o caso que distingue "recusei a segunda" de "perdi uma".
    const id = await nova()
    const antes = (await historicoNoBanco(id)).length
    await mover(id, { acao: 'enviarConfirmacao' }).expect(200)
    await mover(id, { acao: 'enviarConfirmacao' }).expect(200)
    expect(await historicoNoBanco(id)).toHaveLength(antes + 2)
  })

  it('O LOCK É REAL: a transição julga o estado COMMITADO, não o que leu antes', async () => {
    /**
     * A prova determinística do `FOR UPDATE` da rota — com BARREIRA, não com
     * espera por tempo.
     *
     * Roteiro:
     *   1. um cliente de fora toma `SELECT … FOR UPDATE` na linha e NÃO comita;
     *   2. a requisição é disparada e fica presa no `FOR UPDATE` do serviço;
     *   3. espera-se até o Postgres relatar um backend BLOQUEADO em lock —
     *      é esta a barreira, e é ela que torna a ordem garantida em vez de
     *      provável;
     *   4. o cliente de fora move o cartão para `confirmado` e comita;
     *   5. a requisição volta a andar, RELÊ `confirmado`, e `confirmar` passa a
     *      ser transição proibida → 409.
     *
     * Sem o `FOR UPDATE`, o passo 2 não bloqueia: o serviço já teria lido
     * `agendado`, `transicao` diria sim, e a resposta seria 200 — um segundo
     * evento `confirmar` para uma paciente que confirmou uma vez.
     */
    const id = await nova()
    const fora = new pg.Client({ connectionString: URL_MIG })
    await fora.connect()
    try {
      await declararAtorSistema(fora)
      await fora.query('BEGIN')
      await fora.query('SELECT 1 FROM tarefas WHERE id = $1 FOR UPDATE', [id])

      // `.then(…)` não é enfeite: o `Test` do supertest é LAZY — a requisição
      // só é enviada quando alguém a encadeia. Sem isto, a barreira abaixo
      // espera por um backend que nunca chegou ao banco.
      const pedido = mover(id, { acao: 'confirmar' }).then((r) => r)
      await esperarLockEmEspera(fora)

      await fora.query(`UPDATE tarefas SET etapa = 'confirmado' WHERE id = $1`, [id])
      await fora.query('COMMIT')

      const r = await pedido
      expect(r.statusCode, JSON.stringify(r.body)).toBe(409)
      // E nenhum evento novo entrou: o cartão tem só `agendar`.
      expect(await historicoNoBanco(id)).toHaveLength(1)
    } finally {
      await fora.query('ROLLBACK').catch(() => undefined)
      await fora.end()
    }
  })

  it('cada evento guarda QUEM fez — a trilha nomeia a pessoa', async () => {
    const id = await nova()
    const t = corpoDe(await mover(id, { acao: 'confirmar' }, 'beatriz').expect(200))
    expect(t.historico.at(-1)?.porId).toBe(c.pessoas['beatriz'])
  })
})

/* ------------------------------------------------------------- LGPD / log */

describe('a nota nunca vai para log', () => {
  it('nem a nota, nem o nome da paciente, nem o telefone', async () => {
    const id = await nova()
    const linhas: string[] = []
    const metodos = ['log', 'warn', 'error', 'info', 'debug'] as const
    const originais = metodos.map((m) => console[m])
    for (const m of metodos) {
      console[m] = (...args: unknown[]) => {
        linhas.push(args.map((a) => String(a)).join(' '))
      }
    }
    try {
      await mover(id, { acao: 'desmarcar', nota: 'o marido da Ana Lúcia não deixou' }).expect(200)
      // E também no caminho de ERRO, que é por onde um `console.error` com o
      // corpo inteiro entraria sem ninguém notar.
      await mover(id, { acao: 'confirmar' }).expect(409)
    } finally {
      for (const [i, m] of metodos.entries()) console[m] = originais[i]!
    }
    const tudo = linhas.join('\n')
    expect(tudo).not.toMatch(/marido|Ana Lúcia|98888/)
  })
})
