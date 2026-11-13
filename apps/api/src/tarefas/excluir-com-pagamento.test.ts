import { randomBytes } from 'node:crypto'
import pg from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { hashDeSenha } from '../autenticacao/senha'
import { apagarOperadorDeTeste, declararAtorSistema } from '../banco/limpeza-de-teste'
import {
  apagar,
  type Cenario,
  desmontarCenario,
  HOJE,
  limparFinanceiro,
  limparProgramas,
  montarCenario,
  pegar,
  postar,
  recebimentosDe,
  receitaDoDia,
  tarefaCrua,
} from './__tests__/cenario'

/**
 * EXCLUIR UMA TAREFA COM PAGAMENTO (ADR 2026-11-13).
 *
 * O ciclo que a cliente encontrou: excluir recusava por haver pagamento,
 * reabrir recusava por ser orçamento fechado, e estornar recusava por o
 * pagamento estar embutido. Agora excluir estorna junto, arquiva o programa e
 * a receita sai UMA vez.
 */
let c: Cenario
const sufixo = randomBytes(4).toString('hex')
const USUARIO_OP = `exc.${sufixo}`
const SENHA_OP = 'doze-pedras-no-caminho'
const URL_MIG =
  process.env['DATABASE_URL_MIGRATE'] ?? 'postgresql://fir_migrate:fir_local_dev@127.0.0.1:4832/fir'
let operadorId: string
let suporte: string
let suporteOutra: string

const pares = (r: { headers: Record<string, string> }): string => {
  const v = r.headers['set-cookie'] as unknown
  const lista = Array.isArray(v) ? (v as string[]) : typeof v === 'string' ? [v] : []
  return lista.map((x) => x.split(';')[0]!).join('; ')
}
const http = () => request(c.app.getHttpServer())
const COM_MOTIVO = { motivo: 'Cliente pediu a correção pelo chamado 4821' }

beforeAll(async () => {
  c = await montarCenario('excluir-pagamento')
  operadorId = (
    await c.migrate.query<{ id: string }>(
      `INSERT INTO operadores (usuario, nome, senha_hash) VALUES ($1, 'Dono do Painel', $2) RETURNING id`,
      [USUARIO_OP, await hashDeSenha(SENHA_OP)],
    )
  ).rows[0]!.id
  const painel = pares(
    await http().post('/v1/superadmin/entrar').send({ usuario: USUARIO_OP, senha: SENHA_OP }).expect(200),
  )
  const abrir = async (clinicaId: string) =>
    pares(
      await http()
        .post(`/v1/superadmin/clinicas/${clinicaId}/sessao-de-suporte`)
        .set('Cookie', painel)
        .expect(201),
    )
  suporte = await abrir(c.clinica)
  suporteOutra = await abrir(c.outraClinica)
})
afterAll(async () => {
  await declararAtorSistema(c.migrate)
  await c.migrate.query('DELETE FROM tentativas_de_operador WHERE identificador = $1', [USUARIO_OP])
  await desmontarCenario(c)
  // `desmontarCenario` fecha a conexão; o operador sai por uma nova.
  const m = new pg.Client({ connectionString: URL_MIG })
  await m.connect()
  await declararAtorSistema(m)
  await apagarOperadorDeTeste(m, operadorId)
  await m.end()
})
beforeEach(async () => {
  await limparFinanceiro(c)
  await limparProgramas(c)
})

const mover = (id: string, corpo: Record<string, unknown>, quem = 'beatriz') =>
  postar(c, `/v1/tarefas/${id}/jornada`, corpo, quem)

const idDoProcedimento = async (chave: string): Promise<string> =>
  (
    await c.migrate.query<{ id: string }>(
      'SELECT id FROM procedimentos WHERE clinica_id = $1 AND nome_chave = $2',
      [c.clinica, chave],
    )
  ).rows[0]!.id

/**
 * O caso de uma clínica: consulta realizada com R$ 500 no Pix embutido, orçamento
 * de R$ 25.000 com programa, FECHADO com R$ 10.000 de entrada + R$ 15.000 em
 * aberto — o que gera a tarefa companheira "Pagamento de orçamento".
 */
async function fechadaComPagamento(): Promise<string> {
  const r = await postar(
    c,
    '/v1/tarefas',
    {
      vinculo: 'paciente',
      pacienteId: c.pacientes['ana'],
      tipo: 'Consulta realizada',
      responsavelId: c.pessoas['beatriz'],
      quando: { modo: 'retroativo', em: HOJE, pagamento: { valor: '50000', forma: 'Pix' } },
    },
    'beatriz',
  )
  expect(r.statusCode, JSON.stringify(r.body)).toBe(201)
  const id = r.body.tarefa.id as string
  const tirze = await idDoProcedimento('tirzepatida')
  await mover(id, {
    acao: 'registrarOrcamento',
    valor: '2500000',
    programa: [{ chave: 'a', procedimentoId: tirze, sessoes: 4, intervaloDias: 7 }],
  }).expect(200)
  const f = await mover(id, {
    acao: 'fechar',
    recebimento: { valor: '1000000', forma: 'Pix', valorAberto: '1500000' },
  })
  expect(f.statusCode, JSON.stringify(f.body)).toBe(200)
  return id
}

const vivos = async (): Promise<bigint> => {
  const r = await c.migrate.query<{ t: string }>(
    `SELECT coalesce(sum(valor),0)::text AS t FROM recebimentos
      WHERE clinica_id = $1 AND estornado_em IS NULL AND paciente_id = $2`,
    [c.clinica, c.pacientes['ana']],
  )
  return BigInt(r.rows[0]!.t)
}

const ltvDa = async (quem = 'beatriz'): Promise<string | null> => {
  const r = await pegar(c, '/v1/pacientes', {}, quem)
  expect(r.statusCode, JSON.stringify(r.body)).toBe(200)
  const p = (r.body.pacientes as { id: string; ltv: string | null }[]).find(
    (x) => x.id === c.pacientes['ana'],
  )
  expect(p).toBeDefined()
  return p!.ltv
}

const programasDe = async (origem: string) =>
  (
    await c.migrate.query<{ situacao: string; excluido_em: Date | null }>(
      'SELECT situacao, excluido_em FROM programas WHERE tarefa_de_origem_id = $1',
      [origem],
    )
  ).rows

const semPerm = async (perm: string, durante: () => Promise<void>) => {
  await c.migrate.query(
    `UPDATE perfis SET perms = array_remove(perms, $2) WHERE clinica_id = $1 AND chave = 'pf_sup'`,
    [c.clinica, perm],
  )
  try {
    await durante()
  } finally {
    await c.migrate.query(
      `UPDATE perfis SET perms = array_append(perms, $2) WHERE clinica_id = $1 AND chave = 'pf_sup'`,
      [c.clinica, perm],
    )
  }
}

describe('DELETE /v1/tarefas/:id com pagamento e orçamento fechado', () => {
  it('estorna tudo UMA vez, arquiva o programa e a receita cai exatamente o que entrou', async () => {
    const id = await fechadaComPagamento()
    const receitaAntes = await receitaDoDia(c)
    // 500,00 da consulta + 10.000,00 de entrada
    expect(receitaAntes).toBe(1_050_000n)
    expect(await ltvDa()).toBe('1050000')

    // a prévia diz o que vai acontecer — e o valor é o que vai ser estornado
    const previa = await pegar(c, `/v1/tarefas/${id}/exclusao`, {}, 'beatriz')
    expect(previa.statusCode, JSON.stringify(previa.body)).toBe(200)
    expect(previa.body).toEqual({
      temPagamento: true,
      temPrograma: true,
      valor: '1050000',
      exigeMotivo: false,
    })

    const r = await apagar(c, `/v1/tarefas/${id}`, {}, 'beatriz')
    expect(r.statusCode, JSON.stringify(r.body)).toBe(200)

    // soma exata: receita antes − o que entrou = depois (nada dobra, nada some a mais)
    expect(await receitaDoDia(c)).toBe(receitaAntes - 1_050_000n)
    expect(await receitaDoDia(c)).toBe(0n)
    expect(await vivos()).toBe(0n)
    expect(await ltvDa()).toBe('0')

    // append-only: as linhas continuam, estornadas; a companheira também saiu
    const todos = await c.migrate.query<{
      id: string
      estornado_em: Date | null
      tarefa_id: string
    }>('SELECT id, estornado_em, tarefa_id FROM recebimentos WHERE paciente_id = $1 AND clinica_id = $2', [
      c.pacientes['ana'],
      c.clinica,
    ])
    expect(todos.rows).toHaveLength(2)
    expect(todos.rows.every((x) => x.estornado_em !== null)).toBe(true)
    const companheira = todos.rows.find((x) => x.tarefa_id !== id)!
    expect((await tarefaCrua(c, companheira.tarefa_id))!['excluida_em']).not.toBeNull()
    expect((await tarefaCrua(c, id))!['excluida_em']).not.toBeNull()
    expect(await recebimentosDe(c, id)).toHaveLength(1)

    // programa ARQUIVADO, nunca apagado
    expect(await programasDe(id)).toEqual([{ situacao: 'encerrado', excluido_em: null }])
  })

  it('excluir duas vezes é 404 e não estorna nada de novo', async () => {
    const id = await fechadaComPagamento()
    await apagar(c, `/v1/tarefas/${id}`, {}, 'beatriz').expect(200)
    const depois = await receitaDoDia(c)
    expect((await apagar(c, `/v1/tarefas/${id}`, {}, 'beatriz')).statusCode).toBe(404)
    expect(await receitaDoDia(c)).toBe(depois)
  })

  it('sem a permissão de receber (juliana, a solicitante) é recusado, e nada muda', async () => {
    const r = await postar(
      c,
      '/v1/tarefas',
      {
        vinculo: 'paciente',
        pacienteId: c.pacientes['ana'],
        tipo: 'Consulta realizada',
        responsavelId: c.pessoas['juliana'],
        quando: { modo: 'retroativo', em: HOJE, pagamento: { valor: '50000', forma: 'Pix' } },
      },
      'juliana',
    )
    expect(r.statusCode, JSON.stringify(r.body)).toBe(201)
    const id = r.body.tarefa.id as string
    const ex = await apagar(c, `/v1/tarefas/${id}`, {}, 'juliana')
    expect(ex.statusCode, JSON.stringify(ex.body)).toBe(403)
    expect((await tarefaCrua(c, id))!['excluida_em']).toBeNull()
    expect(await receitaDoDia(c)).toBe(50_000n)
  })

  it('quem tem `tarefas.equipe` mas não tem `receber` também é recusado quando há pagamento', async () => {
    const id = await fechadaComPagamento()
    await semPerm('receber', async () => {
      const ex = await apagar(c, `/v1/tarefas/${id}`, {}, 'beatriz')
      expect(ex.statusCode, JSON.stringify(ex.body)).toBe(403)
    })
    expect(await vivos()).toBe(1_050_000n)
    expect((await tarefaCrua(c, id))!['excluida_em']).toBeNull()
  })

  it('a prévia não leva o valor a quem não tem `valores`', async () => {
    const id = await fechadaComPagamento()
    await semPerm('valores', async () => {
      const p = await pegar(c, `/v1/tarefas/${id}/exclusao`, {}, 'beatriz')
      expect(p.statusCode, JSON.stringify(p.body)).toBe(200)
      expect(p.body.temPagamento).toBe(true)
      expect(p.body.valor).toBeNull()
      expect(p.text).not.toContain('1050000')
    })
  })

  it('outro pagamento do mesmo programa bloqueia (não estorna dinheiro que não é da adesão)', async () => {
    const id = await fechadaComPagamento()
    const prog = (
      await c.migrate.query<{ id: string }>('SELECT id FROM programas WHERE tarefa_de_origem_id = $1', [
        id,
      ])
    ).rows[0]!.id
    await c.migrate.query(
      `INSERT INTO recebimentos (clinica_id, paciente_id, tipo, valor, forma, recebido_em, registrado_por, programa_id)
       VALUES ($1,$2,'Pagamento',70000,'Pix', now(), $3, $4)`,
      [c.clinica, c.pacientes['ana'], c.pessoas['beatriz'], prog],
    )
    const ex = await apagar(c, `/v1/tarefas/${id}`, {}, 'beatriz')
    expect(ex.statusCode, JSON.stringify(ex.body)).toBe(409)
    expect((await tarefaCrua(c, id))!['excluida_em']).toBeNull()
  })

  it('a tarefa de outra clínica é 404', async () => {
    expect((await apagar(c, `/v1/tarefas/${c.tarefaDaOutra}`, {}, 'beatriz')).statusCode).toBe(404)
  })

  it('caixa já fechado: o esperado guardado não muda e a marca "mudou depois" acende com o estorno', async () => {
    const id = await fechadaComPagamento()
    const f = await postar(
      c,
      '/v1/caixa',
      { dia: HOJE, obs: '', contado: [{ forma: 'Pix', valor: '1050000' }] },
      'beatriz',
    )
    expect(f.statusCode, JSON.stringify(f.body)).toBe(201)
    await apagar(c, `/v1/tarefas/${id}`, {}, 'beatriz').expect(200)
    const dia = await pegar(c, '/v1/caixa', { dia: HOJE }, 'beatriz')
    expect(dia.body.mudouDepoisDoFechamento).toBe(true)
    const alt = (dia.body.alteracoesDepoisDoFechamento as { forma: string; valor: string }[]).find(
      (a) => a.forma === 'Pix',
    )!
    expect(alt.valor).toBe('-1050000')
    const pix = (dia.body.porForma as { forma: string; esperado: string }[]).find(
      (l) => l.forma === 'Pix',
    )!
    expect(pix.esperado).toBe('1050000')
  })
})

describe('o SUPORTE (superadmin em sessão de suporte) exclui, e só isso', () => {
  it('exclui a tarefa com pagamento; a trilha registra o operador e a clínica o vê como Suporte', async () => {
    const id = await fechadaComPagamento()
    const r = await http().delete(`/v1/tarefas/${id}`).set('Cookie', suporte).send(COM_MOTIVO)
    expect(r.statusCode, JSON.stringify(r.body)).toBe(200)
    expect(await vivos()).toBe(0n)
    expect(await programasDe(id)).toEqual([{ situacao: 'encerrado', excluido_em: null }])

    // trilha: o estorno, a exclusão e o arquivamento têm ator_tipo = operador
    const trilha = await c.migrate.query<{ entidade: string; ator_id: string }>(
      `SELECT entidade, ator_id::text FROM auditoria
        WHERE clinica_id = $1 AND acao = 'alterou' AND ator_tipo = 'operador'
          AND entidade IN ('recebimentos','tarefas','programas')`,
      [c.clinica],
    )
    expect(new Set(trilha.rows.map((x) => x.entidade))).toEqual(
      new Set(['recebimentos', 'tarefas', 'programas']),
    )
    expect(trilha.rows.every((x) => x.ator_id === operadorId)).toBe(true)

    // a clínica enxerga "superadmin" (rótulo "Suporte Firmare"), sem id nem nome
    const at = await pegar(c, '/v1/atividades', {}, 'beatriz')
    expect(at.statusCode, JSON.stringify(at.body)).toBe(200)
    const doSuporte = (
      at.body.itens as { quem: { tipo: string; id: string | null; nome: string | null } }[]
    ).filter((x) => x.quem.tipo === 'superadmin')
    expect(doSuporte.length).toBeGreaterThan(0)
    expect(doSuporte.every((x) => x.quem.id === null && x.quem.nome === null)).toBe(true)
    expect(at.text).not.toContain(operadorId)
  })

  it('excluir de novo é 404 também para o suporte', async () => {
    const id = await fechadaComPagamento()
    await http().delete(`/v1/tarefas/${id}`).set('Cookie', suporte).send(COM_MOTIVO).expect(200)
    expect((await http().delete(`/v1/tarefas/${id}`).set('Cookie', suporte).send(COM_MOTIVO)).statusCode).toBe(404)
  })

  it('NÃO se afrouxou o geral: as outras escritas de tarefa continuam recusadas ao suporte (403)', async () => {
    const id = await fechadaComPagamento()
    const recusado = async (r: request.Test, rotulo: string) => {
      const res = await r
      expect(res.statusCode, `${rotulo}: ${JSON.stringify(res.body)}`).toBe(403)
      expect(res.body.codigo, rotulo).toBe('SESSAO_DE_SUPORTE_NAO_ASSINA')
    }
    await recusado(
      http()
        .post('/v1/tarefas')
        .set('Cookie', suporte)
        .send({
          vinculo: 'interna',
          responsavelId: c.pessoas['beatriz'],
          descricao: 'x',
          quando: { modo: 'agendada', prazo: HOJE },
        }),
      'criar',
    )
    await recusado(
      http().patch(`/v1/tarefas/${id}`).set('Cookie', suporte).send({ descricao: 'y' }),
      'editar',
    )
    await recusado(http().post(`/v1/tarefas/${id}/reabrir`).set('Cookie', suporte).send({}), 'reabrir')
    await recusado(
      http().post(`/v1/tarefas/${id}/concluir`).set('Cookie', suporte).send({ em: HOJE }),
      'concluir',
    )
    await recusado(
      http().post(`/v1/tarefas/${id}/jornada`).set('Cookie', suporte).send({ acao: 'reabrir' }),
      'jornada',
    )
    expect(await vivos()).toBe(1_050_000n)
  })

  it('isolamento: a sessão de suporte de OUTRA clínica não alcança esta tarefa (404)', async () => {
    const id = await fechadaComPagamento()
    const r = await http().delete(`/v1/tarefas/${id}`).set('Cookie', suporteOutra).send(COM_MOTIVO)
    expect(r.statusCode).toBe(404)
    expect((await tarefaCrua(c, id))!['excluida_em']).toBeNull()
    expect(await vivos()).toBe(1_050_000n)
  })
})
