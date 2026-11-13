import { randomBytes } from 'node:crypto'
import pg from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { hashDeSenha } from '../autenticacao/senha'
import { apagarOperadorDeTeste, declararAtorSistema } from '../banco/limpeza-de-teste'
import {
  type Cenario,
  desmontarCenario,
  HOJE,
  limparFinanceiro,
  limparProgramas,
  montarCenario,
  pegar,
  postar,
  tarefaCrua,
} from './__tests__/cenario'

/**
 * I1 (revisão LGPD) + I2' + I6.
 *
 * I1: o Suporte Firmare (sessão de operador) só exclui tarefa, estorna
 * recebimento e reativa/desativa paciente COM motivo; o motivo vai para
 * `auditoria.motivo`, e a tela Atividades da clínica diz QUAL registro ele
 * mexeu e por quê — sem nome do operador, sem id dele, sem dado do paciente.
 * A pessoa da clínica não muda: motivo opcional.
 * I2': excluir trava o programa de origem — uma cobrança em voo não passa.
 * I6: a mensagem do 409 aponta o caminho que de fato funciona.
 */
let c: Cenario
const sufixo = randomBytes(4).toString('hex')
const USUARIO_OP = `mot.${sufixo}`
const SENHA_OP = 'doze-pedras-no-caminho'
const MOTIVO = 'Chamado 4821: exclusao pedida pela gestora'
const URL_MIG =
  process.env['DATABASE_URL_MIGRATE'] ?? 'postgresql://fir_migrate:fir_local_dev@127.0.0.1:4832/fir'
let operadorId: string
let suporte: string

const pares = (r: { headers: Record<string, string> }): string => {
  const v = r.headers['set-cookie'] as unknown
  const lista = Array.isArray(v) ? (v as string[]) : typeof v === 'string' ? [v] : []
  return lista.map((x) => x.split(';')[0]!).join('; ')
}
const http = () => request(c.app.getHttpServer())
const comoSuporte = {
  apagar: (url: string, corpo?: Record<string, unknown>) => {
    const p = http().delete(url).set('Cookie', suporte)
    return corpo === undefined ? p : p.send(corpo)
  },
  postar: (url: string, corpo: Record<string, unknown>) =>
    http().post(url).set('Cookie', suporte).send(corpo),
}

beforeAll(async () => {
  c = await montarCenario('suporte-motivo')
  operadorId = (
    await c.migrate.query<{ id: string }>(
      `INSERT INTO operadores (usuario, nome, senha_hash) VALUES ($1, 'Dono do Painel', $2) RETURNING id`,
      [USUARIO_OP, await hashDeSenha(SENHA_OP)],
    )
  ).rows[0]!.id
  const painel = pares(
    await http().post('/v1/superadmin/entrar').send({ usuario: USUARIO_OP, senha: SENHA_OP }).expect(200),
  )
  suporte = pares(
    await http()
      .post(`/v1/superadmin/clinicas/${c.clinica}/sessao-de-suporte`)
      .set('Cookie', painel)
      .expect(201),
  )
})
afterAll(async () => {
  await declararAtorSistema(c.migrate)
  await c.migrate.query('DELETE FROM tentativas_de_operador WHERE identificador = $1', [USUARIO_OP])
  await c.migrate.query('DELETE FROM sessoes WHERE operador_id = $1', [operadorId])
  await desmontarCenario(c)
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

const idDoProcedimento = async (chave: string): Promise<string> =>
  (
    await c.migrate.query<{ id: string }>(
      'SELECT id FROM procedimentos WHERE clinica_id = $1 AND nome_chave = $2',
      [c.clinica, chave],
    )
  ).rows[0]!.id

async function consultaSimples(): Promise<string> {
  const r = await postar(
    c,
    '/v1/tarefas',
    {
      vinculo: 'paciente',
      pacienteId: c.pacientes['ana'],
      tipo: 'Consulta realizada',
      responsavelId: c.pessoas['beatriz'],
      quando: { modo: 'retroativo', em: HOJE },
    },
    'beatriz',
  )
  expect(r.statusCode, JSON.stringify(r.body)).toBe(201)
  return r.body.tarefa.id as string
}

/** Consulta com R$ 500 embutidos + orçamento com programa fechado com entrada. */
async function fechadaComPrograma(): Promise<{ id: string; programa: string }> {
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
  await postar(
    c,
    `/v1/tarefas/${id}/jornada`,
    {
      acao: 'registrarOrcamento',
      valor: '2500000',
      programa: [{ chave: 'a', procedimentoId: tirze, sessoes: 4, intervaloDias: 7 }],
    },
    'beatriz',
  ).expect(200)
  const f = await postar(
    c,
    `/v1/tarefas/${id}/jornada`,
    { acao: 'fechar', recebimento: { valor: '1000000', forma: 'Pix', valorAberto: '1500000' } },
    'beatriz',
  )
  expect(f.statusCode, JSON.stringify(f.body)).toBe(200)
  const programa = (
    await c.migrate.query<{ id: string }>('SELECT id FROM programas WHERE tarefa_de_origem_id = $1', [id])
  ).rows[0]!.id
  return { id, programa }
}

const motivosDaTrilha = async (entidade: string, id: string) =>
  (
    await c.migrate.query<{ ator_tipo: string; motivo: string | null }>(
      `SELECT ator_tipo, motivo FROM auditoria
        WHERE clinica_id = $1 AND entidade = $2 AND entidade_id = $3 AND acao = 'alterou'
        ORDER BY id`,
      [c.clinica, entidade, id],
    )
  ).rows

describe('I1 — excluir tarefa pelo suporte exige motivo', () => {
  it('sem motivo, ou com motivo curto, é 400 e nada muda', async () => {
    const id = await consultaSimples()
    for (const corpo of [undefined, {}, { motivo: '   ' }, { motivo: 'curto' }, { motivo: 'x'.repeat(201) }]) {
      const r = await comoSuporte.apagar(`/v1/tarefas/${id}`, corpo)
      expect(r.statusCode, JSON.stringify(corpo)).toBe(400)
    }
    expect((await tarefaCrua(c, id))!['excluida_em']).toBeNull()
  })

  it('com motivo: a trilha da tarefa leva o motivo, como OPERADOR', async () => {
    const id = await consultaSimples()
    const r = await comoSuporte.apagar(`/v1/tarefas/${id}`, { motivo: MOTIVO })
    expect(r.statusCode, JSON.stringify(r.body)).toBe(200)
    const t = await motivosDaTrilha('tarefas', id)
    expect(t.at(-1)).toEqual({ ator_tipo: 'operador', motivo: MOTIVO })
  })

  it('com pagamento e programa: estorno, companheira e programa levam o MESMO motivo', async () => {
    const { id, programa } = await fechadaComPrograma()
    const r = await comoSuporte.apagar(`/v1/tarefas/${id}`, { motivo: MOTIVO })
    expect(r.statusCode, JSON.stringify(r.body)).toBe(200)
    const sem = await c.migrate.query<{ entidade: string; motivo: string | null }>(
      `SELECT entidade, motivo FROM auditoria
        WHERE clinica_id = $1 AND ator_tipo = 'operador' AND acao = 'alterou'
          AND entidade IN ('recebimentos','tarefas','programas')`,
      [c.clinica],
    )
    expect(sem.rows.length).toBeGreaterThanOrEqual(3)
    expect(sem.rows.every((x) => x.motivo === MOTIVO)).toBe(true)
    expect((await motivosDaTrilha('programas', programa)).at(-1)!.motivo).toBe(MOTIVO)
  })

  it('a pessoa da clínica continua SEM motivo: opcional, trilha com motivo nulo', async () => {
    const id = await consultaSimples()
    const r = await request(c.app.getHttpServer()).delete(`/v1/tarefas/${id}`).set('Cookie', c.cookies['beatriz']!)
    expect(r.statusCode, JSON.stringify(r.body)).toBe(200)
    expect((await motivosDaTrilha('tarefas', id)).at(-1)).toEqual({ ator_tipo: 'pessoa', motivo: null })
  })

  it('o motivo NÃO vaza para a transação seguinte (variável local à transação)', async () => {
    const a = await consultaSimples()
    await comoSuporte.apagar(`/v1/tarefas/${a}`, { motivo: MOTIVO }).expect(200)
    const b = await consultaSimples()
    await request(c.app.getHttpServer()).delete(`/v1/tarefas/${b}`).set('Cookie', c.cookies['beatriz']!).expect(200)
    expect((await motivosDaTrilha('tarefas', b)).at(-1)!.motivo).toBeNull()
  })

  it('a prévia diz à tela se o motivo é exigido: sim para o suporte, não para a pessoa', async () => {
    const id = await consultaSimples()
    expect((await comoSuporteGet(`/v1/tarefas/${id}/exclusao`)).body.exigeMotivo).toBe(true)
    expect((await pegar(c, `/v1/tarefas/${id}/exclusao`, {}, 'beatriz')).body.exigeMotivo).toBe(false)
  })

  it('a tela Atividades diz QUAL registro o suporte mexeu e por quê — sem nome nem id do operador', async () => {
    const id = await consultaSimples()
    await comoSuporte.apagar(`/v1/tarefas/${id}`, { motivo: MOTIVO }).expect(200)
    const at = await pegar(c, '/v1/atividades', {}, 'beatriz')
    expect(at.statusCode, JSON.stringify(at.body)).toBe(200)
    const itens = at.body.itens as {
      quem: { tipo: string; id: string | null; nome: string | null }
      assunto: string
      entidadeId: string | null
      motivo: string | null
    }[]
    const dele = itens.find((x) => x.quem.tipo === 'superadmin' && x.assunto === 'tarefas')
    expect(dele).toBeDefined()
    expect(dele!.entidadeId).toBe(id)
    expect(dele!.motivo).toBe(MOTIVO)
    expect(dele!.quem).toMatchObject({ id: null, nome: null })
    expect(at.text).not.toContain(operadorId)
    expect(at.text).not.toContain('Dono do Painel')
    // linhas da equipe NÃO ganham id de registro nem motivo
    for (const x of itens.filter((y) => y.quem.tipo !== 'superadmin')) {
      expect(x.entidadeId).toBeNull()
      expect(x.motivo).toBeNull()
    }
  })
})

const comoSuporteGet = (url: string) => http().get(url).set('Cookie', suporte)

describe('I1 — estorno de recebimento e paciente', () => {
  const umPagamentoAvulso = async (): Promise<string> =>
    (
      await c.migrate.query<{ id: string }>(
        `INSERT INTO recebimentos (clinica_id, paciente_id, tipo, valor, forma, recebido_em, registrado_por)
         VALUES ($1,$2,'Pagamento de saldo em aberto',70000,'Pix', now(), $3) RETURNING id`,
        [c.clinica, c.pacientes['ana'], c.pessoas['beatriz']],
      )
    ).rows[0]!.id

  it('estorno pelo suporte exige motivo e o grava', async () => {
    const id = await umPagamentoAvulso()
    expect((await comoSuporte.apagar(`/v1/recebimentos/${id}`)).statusCode).toBe(400)
    expect((await comoSuporte.apagar(`/v1/recebimentos/${id}`, { motivo: 'curto' })).statusCode).toBe(400)
    const r = await comoSuporte.apagar(`/v1/recebimentos/${id}`, { motivo: MOTIVO })
    expect(r.statusCode, JSON.stringify(r.body)).toBe(204)
    expect((await motivosDaTrilha('recebimentos', id)).at(-1)).toEqual({
      ator_tipo: 'operador',
      motivo: MOTIVO,
    })
  })

  it('estorno pela pessoa da clínica segue sem motivo', async () => {
    const id = await umPagamentoAvulso()
    const r = await request(c.app.getHttpServer())
      .delete(`/v1/recebimentos/${id}`)
      .set('Cookie', c.cookies['beatriz']!)
    expect(r.statusCode, JSON.stringify(r.body)).toBe(204)
    expect((await motivosDaTrilha('recebimentos', id)).at(-1)).toEqual({ ator_tipo: 'pessoa', motivo: null })
  })

  it('desativar e reativar paciente pelo suporte exigem motivo e o gravam', async () => {
    const p = c.pacientes['ana']!
    expect((await comoSuporte.apagar(`/v1/pacientes/${p}`, { razao: 'duplicado' })).statusCode).toBe(400)
    expect((await comoSuporte.postar(`/v1/pacientes/${p}/reativar`, {})).statusCode).toBe(400)
    const d = await comoSuporte.apagar(`/v1/pacientes/${p}`, { razao: 'duplicado', motivo: MOTIVO })
    expect(d.statusCode, JSON.stringify(d.body)).toBe(200)
    expect((await motivosDaTrilha('pacientes', p)).at(-1)).toEqual({ ator_tipo: 'operador', motivo: MOTIVO })
    // reativar sem motivo: recusado, e o paciente continua desativado
    expect((await comoSuporte.postar(`/v1/pacientes/${p}/reativar`, {})).statusCode).toBe(400)
    const motivo2 = 'Chamado 4822: reativar a pedido da gestora'
    const r = await comoSuporte.postar(`/v1/pacientes/${p}/reativar`, { motivo: motivo2 })
    expect(r.statusCode, JSON.stringify(r.body)).toBe(201)
    expect((await motivosDaTrilha('pacientes', p)).at(-1)).toEqual({ ator_tipo: 'operador', motivo: motivo2 })
  })
})

describe("I2' — a exclusão trava o programa de origem", () => {
  it('cobrança do programa em voo (INSERT não confirmado) espera a exclusão e a BLOQUEIA com 409', async () => {
    const { id, programa } = await fechadaComPrograma()
    const outra = new pg.Client({ connectionString: URL_MIG })
    await outra.connect()
    try {
      await declararAtorSistema(outra)
      await outra.query('BEGIN')
      // a cobrança nasce, ainda sem COMMIT: toma FOR KEY SHARE no programa (FK)
      await outra.query(
        `INSERT INTO recebimentos (clinica_id, paciente_id, tipo, valor, forma, recebido_em, registrado_por, programa_id)
         VALUES ($1,$2,'Pagamento de saldo em aberto',70000,'Pix', now(), $3, $4)`,
        [c.clinica, c.pacientes['ana'], c.pessoas['beatriz'], programa],
      )
      const exclusao = request(c.app.getHttpServer())
        .delete(`/v1/tarefas/${id}`)
        .set('Cookie', c.cookies['beatriz']!)
        .then((r) => r)
      // a exclusão tem de estar ESPERANDO o lock, não ter decidido sem ver a cobrança
      await new Promise((ok) => setTimeout(ok, 600))
      await outra.query('COMMIT')
      const r = await exclusao
      expect(r.statusCode, JSON.stringify(r.body)).toBe(409)
      expect((await tarefaCrua(c, id))!['excluida_em']).toBeNull()
      const prog = await c.migrate.query<{ situacao: string }>('SELECT situacao FROM programas WHERE id = $1', [programa])
      expect(prog.rows[0]!.situacao).toBe('ativo')
    } finally {
      await outra.query('ROLLBACK').catch(() => undefined)
      await outra.end()
    }
  })

  it('duas exclusões simultâneas: uma passa, a outra é 404, e o dinheiro é estornado UMA vez', async () => {
    const { id } = await fechadaComPrograma()
    const pedir = () =>
      request(c.app.getHttpServer()).delete(`/v1/tarefas/${id}`).set('Cookie', c.cookies['beatriz']!).then((r) => r)
    const [a, b] = await Promise.all([pedir(), pedir()])
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 404])
    const vivos = await c.migrate.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM recebimentos WHERE clinica_id = $1 AND estornado_em IS NULL`,
      [c.clinica],
    )
    expect(vivos.rows[0]!.n).toBe('0')
  })
})

describe('I6 — a mensagem do 409 aponta o caminho que funciona', () => {
  it('pagamento AVULSO do programa: manda estornar em Financeiro › Recebimentos', async () => {
    const { id, programa } = await fechadaComPrograma()
    await c.migrate.query(
      `INSERT INTO recebimentos (clinica_id, paciente_id, tipo, valor, forma, recebido_em, registrado_por, programa_id)
       VALUES ($1,$2,'Pagamento de saldo em aberto',70000,'Pix', now(), $3, $4)`,
      [c.clinica, c.pacientes['ana'], c.pessoas['beatriz'], programa],
    )
    const r = await request(c.app.getHttpServer()).delete(`/v1/tarefas/${id}`).set('Cookie', c.cookies['beatriz']!)
    expect(r.statusCode).toBe(409)
    expect(r.body.message).toContain('Financeiro › Recebimentos')
  })

  it('pagamento EMBUTIDO em atendimento do programa: manda reabrir o atendimento, não ir a Recebimentos', async () => {
    const { id, programa } = await fechadaComPrograma()
    const sessao = (
      await c.migrate.query<{ id: string }>(
        `SELECT id FROM tarefas WHERE programa_id = $1 AND clinica_id = $2 AND sessao_indice IS NOT NULL ORDER BY sessao_indice LIMIT 1`,
        [programa, c.clinica],
      )
    ).rows[0]!.id
    await c.migrate.query(
      `INSERT INTO recebimentos (clinica_id, paciente_id, tarefa_id, tipo, valor, forma, recebido_em, registrado_por, programa_id)
       VALUES ($1,$2,$3,'Consulta realizada',70000,'Pix', now(), $4, $5)`,
      [c.clinica, c.pacientes['ana'], sessao, c.pessoas['beatriz'], programa],
    )
    const r = await request(c.app.getHttpServer()).delete(`/v1/tarefas/${id}`).set('Cookie', c.cookies['beatriz']!)
    expect(r.statusCode, JSON.stringify(r.body)).toBe(409)
    expect(r.body.message).toContain('reabra')
    expect(r.body.message).not.toContain('Estorne-os')
  })
})
