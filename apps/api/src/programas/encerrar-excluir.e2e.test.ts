import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  type Cenario,
  desmontarCenario,
  limparProgramas,
  montarCenario,
  pegar,
  postar,
  receitaDoDia,
} from '../tarefas/__tests__/cenario'

/**
 * **ENCERRAR × EXCLUIR** — e a diferença que o MANUAL tem uma seção só para
 * explicar (cap. 8).
 *
 * | | **Encerrar** | **Excluir** |
 * |---|---|---|
 * | Quando | a paciente **parou antes do fim** | o registro foi **feito por engano** |
 * | O programa | `situacao = 'encerrado'`, com motivo | `excluido_em` — soft delete |
 * | Sessões **abertas** | `cancelada` | `excluida_em` |
 * | Sessões **realizadas** | **ficam no histórico** | `excluida_em` |
 * | Estoque | **intocado** — o consumo aconteceu | compensado |
 * | Recebimentos | ficam, com `programa_id` | ficam, **sem** `programa_id` |
 *
 * **O que nenhum dos dois legados faz, e nós fazemos: soft delete.** O
 * protótipo dá `splice` (`db.adesoes.filter(x => x.id !== b.id)`); o `Code.gs`
 * dá `deleteRow`. A regra 20 vence os dois.
 *
 * **D-8, decidida pelo dono:** programa com sessão paga é **recusado**, com as
 * duas saídas na mensagem. O estorno em cascata do MANUAL foi oferecido e
 * recusado — deixaria alguém mudar a receita de um mês fechado com um toque.
 */
let c: Cenario
let tirze: string

const montar = (corpo: Record<string, unknown>, quem = 'beatriz') =>
  request(c.app.getHttpServer()).post('/v1/programas').set('Cookie', c.cookies[quem]!).send(corpo)

const encerrar = (id: string, corpo: Record<string, unknown>, quem = 'beatriz') =>
  postar(c, `/v1/programas/${id}/encerrar`, corpo, quem)

const excluir = (id: string, quem = 'beatriz') =>
  request(c.app.getHttpServer()).delete(`/v1/programas/${id}`).set('Cookie', c.cookies[quem]!)

const concluirSessao = (id: string, corpo: Record<string, unknown>, quem = 'beatriz') =>
  postar(c, `/v1/programas/sessoes/${id}/concluir`, corpo, quem)

/** Semanal, 4 sessões, 07/09 a 28/09 — todas no passado do relógio fixo. */
const INICIO = '2026-09-07'

const programa = async (
  pagamento?: Record<string, unknown>,
): Promise<{ id: string; sessoes: string[] }> => {
  const r = await montar({
    pacienteId: c.pacientes['ana'],
    inicio: INICIO,
    itens: [{ chave: 'i1', procedimentoId: tirze, sessoes: 4, intervaloDias: 7 }],
    ...(pagamento === undefined ? {} : { pagamento }),
  })
  expect(r.statusCode, JSON.stringify(r.body)).toBe(201)
  const s = await c.migrate.query<{ id: string }>(
    `SELECT id FROM tarefas WHERE programa_id = $1 AND tipo = 'Sessão de plano'
      ORDER BY sessao_indice`,
    [r.body.id],
  )
  return { id: r.body.id as string, sessoes: s.rows.map((x) => x.id) }
}

const statusDasSessoes = async (programaId: string): Promise<string[]> => {
  const r = await c.migrate.query<{ status: string }>(
    `SELECT status FROM tarefas
      WHERE programa_id = $1 AND tipo = 'Sessão de plano' AND excluida_em IS NULL
      ORDER BY sessao_indice`,
    [programaId],
  )
  return r.rows.map((x) => x.status)
}

const linhaCrua = async (programaId: string) => {
  const r = await c.migrate.query<{
    situacao: string
    motivo_encerramento: string | null
    encerrado_em: Date | null
    excluido_em: Date | null
  }>(
    `SELECT situacao, motivo_encerramento, encerrado_em, excluido_em
       FROM programas WHERE id = $1`,
    [programaId],
  )
  return r.rows[0]
}

/**
 * As SESSÕES vivas do programa — e só elas.
 *
 * `tipo` no filtro de propósito: desde que a tarefa companheira do pagamento da
 * adesão também carrega `programa_id` (paridade com o `adesaoId: aid` do
 * protótipo), contar tudo o que aponta para o programa misturaria a sessão com
 * o lançamento do dinheiro — e a exclusão trata os dois de formas diferentes.
 */
const sessoesVivasDe = async (programaId: string): Promise<number> => {
  const r = await c.migrate.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM tarefas
      WHERE programa_id = $1 AND excluida_em IS NULL AND tipo = 'Sessão de plano'`,
    [programaId],
  )
  return Number(r.rows[0]!.n)
}

/**
 * Quantas tarefas do programa EXISTEM no banco, vivas ou não.
 *
 * Contar só as vivas não distingue soft delete de `DELETE` — as duas dão
 * zero. Medido: a mutação T10a (`DELETE FROM tarefas`) passou pelo teste de
 * soft delete até esta contagem existir. É o mesmo erro de conferir a ausência
 * de um sintoma em vez da presença do fato.
 */
const tarefasNoBancoDe = async (programaId: string): Promise<number> => {
  const r = await c.migrate.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM tarefas
      WHERE programa_id = $1 AND tipo = 'Sessão de plano'`,
    [programaId],
  )
  return Number(r.rows[0]!.n)
}

const trilhaDe = async (programaId: string) => {
  const r = await c.migrate.query<{ acao: string; de: unknown; para: unknown }>(
    `SELECT acao, de, para FROM auditoria
      WHERE entidade = 'programas' AND entidade_id = $1 ORDER BY id DESC`,
    [programaId],
  )
  return r.rows
}

beforeAll(async () => {
  c = await montarCenario('encerrar')
  const p = await c.migrate.query<{ id: string }>(
    `SELECT id FROM procedimentos WHERE clinica_id = $1 AND nome_chave = 'tirzepatida'`,
    [c.clinica],
  )
  tirze = p.rows[0]!.id
}, 60_000)

afterAll(async () => {
  await desmontarCenario(c)
})

beforeEach(async () => {
  await limparProgramas(c)
})

/* ============================================================== ENCERRAR */

describe('encerrar', () => {
  it('CANCELA as abertas e PRESERVA as realizadas', async () => {
    const p = await programa()
    await concluirSessao(p.sessoes[0]!, { em: INICIO, reprogramar: false }).expect(200)
    await concluirSessao(p.sessoes[1]!, { em: '2026-09-14', reprogramar: false }).expect(200)

    const r = await encerrar(p.id, { motivo: 'Desistiu', obs: 'mudou de cidade' })
    expect(r.statusCode, JSON.stringify(r.body)).toBe(200)
    expect(r.body.situacao).toBe('encerrado')
    // O motivo e a observação num campo só, como o protótipo grava.
    expect(r.body.motivoEncerramento).toBe('Desistiu — mudou de cidade')
    // Uma sessão concluída é um atendimento que aconteceu: cancelá-la apagaria
    // da ficha da paciente uma aplicação que ela recebeu.
    expect(await statusDasSessoes(p.id)).toEqual([
      'concluida',
      'concluida',
      'cancelada',
      'cancelada',
    ])
  })

  it('NÃO APAGA: o programa continua no banco e as sessões também', async () => {
    const p = await programa()
    await encerrar(p.id, { motivo: 'Desistiu' }).expect(200)
    const l = (await linhaCrua(p.id))!
    expect(l.excluido_em).toBeNull()
    expect(l.encerrado_em).not.toBeNull()
    expect(await sessoesVivasDe(p.id)).toBe(4)
  })

  it('sem motivo é 400 — o motivo É o relatório', async () => {
    // É por ele que a clínica descobre que metade das desistências é preço.
    const p = await programa()
    expect((await encerrar(p.id, {})).statusCode).toBe(400)
    expect((await linhaCrua(p.id))!.situacao).toBe('ativo')
  })

  it('encerrar DUAS VEZES é 409, e o motivo da primeira fica', async () => {
    const p = await programa()
    await encerrar(p.id, { motivo: 'Desistiu' }).expect(200)
    const r = await encerrar(p.id, { motivo: 'Outro' })
    expect(r.statusCode).toBe(409)
    expect((await linhaCrua(p.id))!.motivo_encerramento).toBe('Desistiu')
  })

  it('a trilha registra de → para de `situacao`', async () => {
    const p = await programa()
    await encerrar(p.id, { motivo: 'Desistiu' }).expect(200)
    const t = await trilhaDe(p.id)
    const ultima = t[0] as { acao: string; de: Record<string, unknown>; para: Record<string, unknown> }
    expect(ultima.acao).toBe('alterou')
    expect(ultima.de['situacao']).toBe('ativo')
    expect(ultima.para['situacao']).toBe('encerrado')
  })

  it('o CONTATO DE RETORNO aberto do programa também é cancelado', async () => {
    // Quem encerrou o tratamento não deve receber a ligação de "você já pode
    // repetir". O mesmo `UPDATE` alcança os dois: ambos carregam `programa_id`.
    const r = await c.migrate.query<{ id: string }>(
      `INSERT INTO tarefas
         (clinica_id, solicitante_id, responsavel_id, descricao, prazo, paciente_id, tipo,
          historico, programa_id, item_chave, procedimento_id)
       VALUES ($1,$2,$2,'Contato para repetir','2027-01-01',$3,'Retorno de procedimento','[]',$4,'i1',$5)
       RETURNING id`,
      [c.clinica, c.pessoas['beatriz'], c.pacientes['ana'], (await programa()).id, tirze],
    )
    const retornoId = r.rows[0]!.id
    const prog = await c.migrate.query<{ programa_id: string }>(
      'SELECT programa_id FROM tarefas WHERE id = $1',
      [retornoId],
    )
    await encerrar(prog.rows[0]!.programa_id, { motivo: 'Desistiu' }).expect(200)
    const depois = await c.migrate.query<{ status: string }>(
      'SELECT status FROM tarefas WHERE id = $1',
      [retornoId],
    )
    expect(depois.rows[0]!.status).toBe('cancelada')
  })

  it('sem `programas.gerir`, 403 — e o programa continua ativo', async () => {
    // `nara` é enfermagem: tem `programas` e NÃO tem `programas.gerir`.
    const p = await programa()
    expect((await encerrar(p.id, { motivo: 'X' }, 'nara')).statusCode).toBe(403)
    expect((await linhaCrua(p.id))!.situacao).toBe('ativo')
  })

  it('programa de outra clínica é 404, nem com o id na mão', async () => {
    // A RLS: zero linhas é a mesma resposta de "não existe".
    const outro = await c.migrate.query<{ id: string }>(
      `INSERT INTO programas (clinica_id, paciente_id, inicio, criado_por)
       VALUES ($1,$2,'2026-09-07',$3) RETURNING id`,
      [c.outraClinica, c.pacienteDaOutra, c.pessoas['beatriz']],
    )
    expect((await encerrar(outro.rows[0]!.id, { motivo: 'X' })).statusCode).toBe(404)
  })
})

/* =============================================================== EXCLUIR */

describe('excluir', () => {
  it('é SOFT DELETE do programa E das sessões', async () => {
    const p = await programa()
    const r = await excluir(p.id)
    expect(r.statusCode, JSON.stringify(r.body)).toBe(200)
    expect(r.body.ids).toHaveLength(4)

    // A linha CONTINUA no banco — a trilha de um programa é prova (regra 20).
    const l = (await linhaCrua(p.id))!
    expect(l).toBeDefined()
    expect(l.excluido_em).not.toBeNull()
    // Vivas: zero. EXISTINDO: quatro. É a segunda asserção que separa soft
    // delete de `DELETE`, e sem ela as duas dão o mesmo resultado.
    expect(await sessoesVivasDe(p.id)).toBe(0)
    expect(await tarefasNoBancoDe(p.id)).toBe(4)

    // E as linhas excluídas carregam `excluida_em`, não um `status` inventado.
    const cruas = await c.migrate.query<{ excluida_em: Date | null; status: string }>(
      'SELECT excluida_em, status FROM tarefas WHERE programa_id = $1',
      [p.id],
    )
    expect(cruas.rows.every((x) => x.excluida_em !== null)).toBe(true)
  })

  it('excluir com SESSÃO PAGA é 409 — e a mensagem dá as DUAS saídas (D-8)', async () => {
    const p = await programa({ valorTotal: '360000', valorEntrada: '120000', forma: 'Pix' })
    await concluirSessao(p.sessoes[0]!, {
      em: INICIO,
      reprogramar: false,
      pagamento: { valor: '30000', forma: 'Pix' },
    }).expect(200)

    const r = await excluir(p.id)
    expect(r.statusCode, JSON.stringify(r.body)).toBe(409)
    expect(String(r.body.message)).toContain('Estorne')
    expect(String(r.body.message)).toContain('Encerrar programa')
    // NADA mudou.
    expect(await sessoesVivasDe(p.id)).toBe(4)
    expect((await linhaCrua(p.id))!.excluido_em).toBeNull()
  })

  it('estornar o pagamento LIBERA a exclusão — a mensagem não é um beco', async () => {
    const p = await programa({ valorTotal: '360000', valorEntrada: '120000', forma: 'Pix' })
    await concluirSessao(p.sessoes[0]!, {
      em: INICIO,
      reprogramar: false,
      pagamento: { valor: '30000', forma: 'Pix' },
    }).expect(200)
    await excluir(p.id).expect(409)

    // Reabrir estorna (épico 2, pela porta da sessão).
    await postar(c, `/v1/programas/sessoes/${p.sessoes[0]!}/reabrir`, {}, 'beatriz').expect(200)
    expect((await excluir(p.id)).statusCode).toBe(200)
  })

  it('o PAGAMENTO DA ADESÃO não impede, e sobrevive perdendo o vínculo', async () => {
    /**
     * A recusa conta recebimento de SESSÃO, não da adesão: o pagamento da
     * adesão fica na tarefa companheira "Adesão ao programa", que não é sessão.
     *
     * Legado: `t.adesaoId = ''`. Aqui: `programa_id = NULL`. O dinheiro não
     * some; ele volta para o grupo geral do saldo, que é onde a cobrança o
     * encontra. Um recebimento apontando para um programa excluído cairia num
     * grupo que a tela não desenha.
     */
    const p = await programa({ valorTotal: '360000', valorEntrada: '120000', forma: 'Pix' })
    const antes = await receitaDoDia(c)

    expect((await excluir(p.id)).statusCode).toBe(200)

    expect(await receitaDoDia(c)).toBe(antes)
    const grupos = (await pegar(c, `/v1/pacientes/${c.pacientes['ana']}/saldo`, {}, 'beatriz')).body
      .grupos as { programaId: string | null; saldo: string | null }[]
    expect(grupos.map((g) => g.programaId)).toEqual([null])
    expect(grupos[0]!.saldo).toBe('240000')
  })

  it('a tarefa de ORIGEM (o orçamento fechado) não é tocada', async () => {
    // O orçamento fechou de verdade, e `fechado` é terminal (épico 3).
    // Reabri-lo seria mudar a receita de um mês que já fechou.
    const t = await postar(
      c,
      '/v1/tarefas',
      {
        vinculo: 'paciente',
        pacienteId: c.pacientes['ana'],
        tipo: 'Consulta agendada',
        responsavelId: c.pessoas['beatriz'],
        quando: { modo: 'retroativo', em: INICIO },
      },
      'beatriz',
    )
    const cartao = t.body.tarefa.id as string
    await postar(
      c,
      `/v1/tarefas/${cartao}/jornada`,
      {
        acao: 'registrarOrcamento',
        valor: '360000',
        programa: [{ chave: 'a', procedimentoId: tirze, sessoes: 4, intervaloDias: 7 }],
      },
      'beatriz',
    ).expect(200)
    await postar(
      c,
      `/v1/tarefas/${cartao}/jornada`,
      { acao: 'fechar', recebimento: { valor: '120000', forma: 'Pix', valorAberto: '240000' } },
      'beatriz',
    ).expect(200)

    const prog = await c.migrate.query<{ id: string }>(
      'SELECT id FROM programas WHERE tarefa_de_origem_id = $1',
      [cartao],
    )
    expect((await excluir(prog.rows[0]!.id)).statusCode).toBe(200)

    const depois = await c.migrate.query<{ etapa: string; status: string }>(
      'SELECT etapa::text AS etapa, status FROM tarefas WHERE id = $1',
      [cartao],
    )
    expect(depois.rows[0]!.etapa).toBe('fechado')
    expect(depois.rows[0]!.status).toBe('concluida')

    // E fechar DE NOVO continua 409: quem impede é a máquina de estados, não o
    // índice `programa_por_origem` (que é parcial em `excluido_em` e liberou).
    const r = await postar(
      c,
      `/v1/tarefas/${cartao}/jornada`,
      { acao: 'fechar', recebimento: { valor: '1000', forma: 'Pix' } },
      'beatriz',
    )
    expect(r.statusCode).toBe(409)
  })

  it('o programa EXCLUÍDO não se encerra nem se exclui de novo — 404', async () => {
    const p = await programa()
    await excluir(p.id).expect(200)
    expect((await excluir(p.id)).statusCode).toBe(404)
    expect((await encerrar(p.id, { motivo: 'X' })).statusCode).toBe(404)
  })

  it('sem `programas.gerir`, 403 — e nada foi apagado', async () => {
    const p = await programa()
    expect((await excluir(p.id, 'nara')).statusCode).toBe(403)
    expect((await linhaCrua(p.id))!.excluido_em).toBeNull()
    expect(await sessoesVivasDe(p.id)).toBe(4)
  })
})
