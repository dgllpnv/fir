import { RelogioFixo } from '@fir/domain'
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify'
import { APP_GUARD } from '@nestjs/core'
import { Test } from '@nestjs/testing'
import { randomBytes } from 'node:crypto'
import pg from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { BancoModule } from '../../banco/banco.module'
import { declararAtorSistema } from '../../banco/limpeza-de-teste'
import { hashDeSenha } from '../../autenticacao/senha'
import { novoToken } from '../../autenticacao/sessao'
import { RELOGIO } from '../../comum/relogio'
import { registrarCookie } from '../../main'
import { CarteiraGuard, NOME_DO_COOKIE_CARTEIRA } from '../carteira.guard'
import { CarteiraModule } from '../carteira.module'
import { ProspeccaoCarteiraModule } from './prospeccao-carteira.module'
import { RotinaInternaService } from './rotina-interna.service'

/**
 * G8 2A — a rotina completa contra Postgres real: geração idempotente ×3 em
 * cada frequência, vencimento e reunião gerando, N-ésimo dia útil, lista com
 * subitens, recorrência que não dobra, redistribuir só no escopo geral,
 * isolamento por grupo e aniversário sem idade.
 *
 * O relógio é FIXO: 2026-11-11 15:00 UTC = quarta, 12:00 no fuso da carteira.
 * Toda rotina daqui é de GRUPO (A ou B): uma rotina da Firmare (grupo NULL)
 * alcançaria os clientes de todos os grupos do banco — inclusive os de outros
 * arquivos de teste rodando em paralelo.
 */
const URL_MIG =
  process.env['DATABASE_URL_MIGRATE'] ?? 'postgresql://fir_migrate:fir_local_dev@127.0.0.1:4832/fir'
const AGORA = new Date('2026-11-11T15:00:00Z')

let app: NestFastifyApplication
let migrate: pg.Client
let grupoA: string
let grupoB: string
let gestoraA: string
let gestoraA2: string
let gestoraB: string
let geral: string
let cliente1: string
let cliente2: string
let clienteB: string
const cookie: Record<'A' | 'A2' | 'B' | 'geral', string> = { A: '', A2: '', B: '', geral: '' }

const sufixo = randomBytes(4).toString('hex')
const SENHA = 'quatro-pedras-no-caminho'
const http = () => request(app.getHttpServer())

const cookiesDe = (r: { headers: Record<string, string> }): string => {
  const v = r.headers['set-cookie'] as unknown
  const lista = Array.isArray(v) ? (v as string[]) : typeof v === 'string' ? [v] : []
  return lista.map((c) => c.split(';')[0]!).join('; ')
}

async function usuario(login: string, escopo: 'geral' | 'grupo', grupo: string | null): Promise<string> {
  const hash = await hashDeSenha(SENHA)
  return (
    await migrate.query<{ id: string }>(
      `INSERT INTO usuarios_gestao (usuario, nome, senha_hash, escopo, grupo_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [`${login}.${sufixo}`, `Pessoa ${login}`, hash, escopo, grupo],
    )
  ).rows[0]!.id
}

const contarDaRotina = async (rotinaId: string): Promise<number> =>
  (
    await migrate.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM tarefas_internas WHERE rotina_interna_id = $1 AND status <> 'cancelada'`,
      [rotinaId],
    )
  ).rows[0]!.n

const prazosDaRotina = async (rotinaId: string): Promise<string[][]> =>
  (
    await migrate.query<{ prazo: string; cliente: string | null }>(
      `SELECT prazo::text, cliente_carteira_id AS cliente FROM tarefas_internas
        WHERE rotina_interna_id = $1 AND status <> 'cancelada' ORDER BY prazo, cliente_carteira_id`,
      [rotinaId],
    )
  ).rows.map((r) => [r.prazo, r.cliente ?? '-'])

function criarRotina(corpo: Record<string, unknown>, quem: keyof typeof cookie = 'A') {
  return http()
    .post('/v1/carteira/rotinas-internas')
    .set('Cookie', cookie[quem])
    .send({ titulo: `Rotina ${sufixo}`, ...corpo })
}

/** Cria, roda o job três vezes, e confere que nada mudou depois de salvar (A-20, regra 26). */
async function idempotenteTresVezes(corpo: Record<string, unknown>): Promise<{ id: string; prazos: string[][] }> {
  const r = await criarRotina(corpo).expect(201)
  const id = r.body.rotina.id as string
  const depoisDeSalvar = await prazosDaRotina(id)
  expect(depoisDeSalvar.length).toBe(r.body.geradas)
  const servico = app.get(RotinaInternaService)
  for (let i = 0; i < 3; i++) await servico.gerarTarefasDeRotinasInternas([grupoA, grupoB])
  expect(await prazosDaRotina(id)).toEqual(depoisDeSalvar)
  return { id, prazos: depoisDeSalvar }
}

beforeAll(async () => {
  migrate = new pg.Client({ connectionString: URL_MIG })
  await migrate.connect()
  await declararAtorSistema(migrate)

  grupoA = (await migrate.query<{ id: string }>(`INSERT INTO grupos (nome) VALUES ($1) RETURNING id`, [`Rotina A ${sufixo}`])).rows[0]!.id
  grupoB = (await migrate.query<{ id: string }>(`INSERT INTO grupos (nome) VALUES ($1) RETURNING id`, [`Rotina B ${sufixo}`])).rows[0]!.id
  gestoraA = await usuario('rot.a', 'grupo', grupoA)
  gestoraA2 = await usuario('rot.a2', 'grupo', grupoA)
  gestoraB = await usuario('rot.b', 'grupo', grupoB)
  geral = await usuario('rot.geral', 'geral', null)

  cliente1 = (
    await migrate.query<{ id: string }>(
      `INSERT INTO clientes_carteira
         (grupo_id, nome, produto, status, servicos, dia_vencimento, mensalidade_centavos, reuniao_dia_semana,
          data_inicio, responsavel_usuario_gestao_id, decisor, aniversario_decisor_dia, aniversario_decisor_mes, telefone)
       VALUES ($1, $2, 'Gestão', 'ativo', ARRAY['semanal','fluxo'], 10, 50000, 4, '2026-01-01', $3,
               'Dra. Ana Souza', 12, 11, '71999998888')
       RETURNING id`,
      [grupoA, `Clínica Um ${sufixo}`, gestoraA2],
    )
  ).rows[0]!.id
  cliente2 = (
    await migrate.query<{ id: string }>(
      `INSERT INTO clientes_carteira (grupo_id, nome, produto, status, data_inicio)
       VALUES ($1, $2, 'Gestão', 'ativo', '2026-01-01') RETURNING id`,
      [grupoA, `Clínica Dois ${sufixo}`],
    )
  ).rows[0]!.id
  clienteB = (
    await migrate.query<{ id: string }>(
      `INSERT INTO clientes_carteira (grupo_id, nome, produto, status, servicos, data_inicio, aniversario_decisor_dia, aniversario_decisor_mes)
       VALUES ($1, $2, 'Gestão', 'ativo', ARRAY['semanal'], '2026-01-01', 12, 11) RETURNING id`,
      [grupoB, `Clínica B ${sufixo}`],
    )
  ).rows[0]!.id

  const mod = await Test.createTestingModule({
    imports: [BancoModule, CarteiraModule, ProspeccaoCarteiraModule],
    providers: [{ provide: APP_GUARD, useClass: CarteiraGuard }],
  })
    .overrideProvider(RELOGIO)
    .useValue(new RelogioFixo(AGORA))
    .compile()
  app = mod.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
  await registrarCookie(app)
  await app.init()
  await app.getHttpAdapter().getInstance().ready()

  for (const [chave, login] of [['A', 'rot.a'], ['A2', 'rot.a2'], ['B', 'rot.b'], ['geral', 'rot.geral']] as const) {
    cookie[chave] = cookiesDe(
      await http().post('/v1/carteira/entrar').send({ usuario: `${login}.${sufixo}`, senha: SENHA }).expect(200),
    )
  }
})

afterAll(async () => {
  await declararAtorSistema(migrate)
  const usuarios = [gestoraA, gestoraA2, gestoraB, geral]
  const doTeste = `SELECT id FROM tarefas_internas
                    WHERE grupo_id = ANY($1) OR responsavel_usuario_gestao_id = ANY($2)
                       OR solicitante_usuario_gestao_id = ANY($2)`
  await migrate.query(`DELETE FROM itens_de_tarefa_interna WHERE tarefa_interna_id IN (${doTeste})`, [[grupoA, grupoB], usuarios])
  await migrate.query(`UPDATE tarefas_internas SET tarefa_origem_id = NULL WHERE id IN (${doTeste})`, [[grupoA, grupoB], usuarios])
  await migrate.query(`DELETE FROM tarefas_internas WHERE id IN (${doTeste})`, [[grupoA, grupoB], usuarios])
  await migrate.query(`DELETE FROM rotinas_internas WHERE grupo_id = ANY($1)`, [[grupoA, grupoB]])
  await migrate.query(`DELETE FROM cobrancas_do_cliente_firmare WHERE grupo_id = ANY($1)`, [[grupoA, grupoB]])
  await migrate.query(`DELETE FROM clientes_carteira WHERE grupo_id = ANY($1)`, [[grupoA, grupoB]])
  await migrate.query(`DELETE FROM sessoes_de_carteira WHERE usuario_gestao_id = ANY($1)`, [usuarios])
  await migrate.query(`DELETE FROM usuarios_gestao WHERE id = ANY($1)`, [usuarios])
  await migrate.query(`DELETE FROM grupos WHERE id = ANY($1)`, [[grupoA, grupoB]])
  await migrate.end()
  await app.close()
})

describe('geração idempotente ×3, em cada frequência (R11, A-20)', () => {
  it('diária: só dias úteis, 7 dias à frente, a partir de hoje', async () => {
    const { prazos } = await idempotenteTresVezes({ frequencia: 'diaria', escopoAplicacao: 'global' })
    expect(prazos.map((p) => p[0])).toEqual(['2026-11-11', '2026-11-12', '2026-11-13', '2026-11-16', '2026-11-17', '2026-11-18'])
  })

  it('semanal: no dia escolhido (sexta)', async () => {
    const { prazos } = await idempotenteTresVezes({ frequencia: 'semanal', diaSemana: 5, escopoAplicacao: 'global' })
    expect(prazos).toEqual([['2026-11-13', '-']])
  })

  it('mensal: no N-ésimo dia útil — 11/11/2026 é o 8º, 12/11 o 9º', async () => {
    const { prazos } = await idempotenteTresVezes({ frequencia: 'mensal', diaUtil: 9, escopoAplicacao: 'global' })
    expect(prazos).toEqual([['2026-11-12', '-']])
  })

  it('vencimento GERA: 3 dias antes do vencimento (10/12, quinta) = 07/12, só para quem tem mensalidade e vencimento', async () => {
    const { id, prazos } = await idempotenteTresVezes({
      frequencia: 'vencimento',
      antecedencia: 3,
      escopoAplicacao: 'por_cliente',
      servico: 'pagamento',
      mensagem: 'pagamento',
      prioridade: 'alta',
    })
    expect(prazos).toEqual([['2026-12-07', cliente1]])
    const t = await migrate.query(
      'SELECT vencimento::text, competencia::text, mensagem, prioridade FROM tarefas_internas WHERE rotina_interna_id = $1',
      [id],
    )
    expect(t.rows[0]).toEqual({ vencimento: '2026-12-10', competencia: '2026-12-01', mensagem: 'pagamento', prioridade: 'alta' })

    // Ajuste 38: mudar o dia do vencimento (12/12 é sábado → lembrete 09/12) NÃO cria um
    // segundo lembrete na mesma competência.
    await migrate.query('UPDATE clientes_carteira SET dia_vencimento = 12 WHERE id = $1', [cliente1])
    await app.get(RotinaInternaService).gerarTarefasDeRotinasInternas([grupoA, grupoB])
    expect(await contarDaRotina(id)).toBe(1)
    await migrate.query('UPDATE clientes_carteira SET dia_vencimento = 10 WHERE id = $1', [cliente1])

    // R14: com a cobrança de dezembro paga, o lembrete se conclui sozinho, "pago antes do lembrete".
    await migrate.query(
      `INSERT INTO cobrancas_do_cliente_firmare
         (cliente_carteira_id, grupo_id, competencia, mensalidade_centavos, valor_centavos, vencimento, status, pago_em, pago_por)
       VALUES ($1, $2, '2026-12-01', 50000, 50000, '2026-12-10', 'pago', now(), 'teste')`,
      [cliente1, grupoA],
    )
    await app.get(RotinaInternaService).gerarTarefasDeRotinasInternas([grupoA, grupoB])
    const pago = await migrate.query('SELECT status, pago_antes FROM tarefas_internas WHERE rotina_interna_id = $1', [id])
    expect(pago.rows[0]).toEqual({ status: 'concluida', pago_antes: true })
  })

  it('reunião GERA: no dia da reunião fixa (quinta, 12/11); cliente sem reunião nem meta fica de fora', async () => {
    const { prazos } = await idempotenteTresVezes({ frequencia: 'reuniao', escopoAplicacao: 'por_cliente', servico: 'metas' })
    expect(prazos).toEqual([['2026-11-12', cliente1]])
  })

  it('uma por cliente, filtrada pelo serviço, com quem executa = responsável do cliente', async () => {
    const { id, prazos } = await idempotenteTresVezes({
      frequencia: 'semanal',
      diaSemana: 5,
      escopoAplicacao: 'por_cliente',
      servico: 'fluxo',
      quemExecuta: 'responsavel_do_cliente',
    })
    expect(prazos).toEqual([['2026-11-13', cliente1]])
    const t = await migrate.query('SELECT responsavel_usuario_gestao_id AS r FROM tarefas_internas WHERE rotina_interna_id = $1', [id])
    expect(t.rows[0]!.r).toBe(gestoraA2)
  })

  it('com a lista de clientes: UMA tarefa com um item por cliente; marcar o último conclui no servidor', async () => {
    const { id } = await idempotenteTresVezes({ frequencia: 'semanal', diaSemana: 5, escopoAplicacao: 'lista' })
    const lista = await http().get('/v1/carteira/tarefas-internas?responsavel=todas').set('Cookie', cookie.A).expect(200)
    const tarefa = lista.body.tarefas.find((t: { rotinaInternaId: string }) => t.rotinaInternaId === id)
    expect(tarefa.itens.map((i: { clienteCarteiraId: string }) => i.clienteCarteiraId).sort()).toEqual([cliente1, cliente2].sort())
    let ultima: { status: string } = tarefa
    for (const item of tarefa.itens) {
      ultima = (
        await http()
          .post(`/v1/carteira/tarefas-internas/${tarefa.id}/itens/${item.id}`)
          .set('Cookie', cookie.A)
          .send({ feito: true })
          .expect(200)
      ).body.tarefa
    }
    expect(ultima.status).toBe('concluida')
  })

  it('editar a rotina cancela as futuras abertas (nunca DELETE) e a geração refaz', async () => {
    const r = await criarRotina({ frequencia: 'semanal', diaSemana: 5, escopoAplicacao: 'global' }).expect(201)
    const id = r.body.rotina.id as string
    await http()
      .put(`/v1/carteira/rotinas-internas/${id}`)
      .set('Cookie', cookie.A)
      .send({ titulo: `Rotina ${sufixo}`, frequencia: 'semanal', diaSemana: 2, escopoAplicacao: 'global' })
      .expect(200)
    const linhas = await migrate.query<{ prazo: string; status: string; cancelada_por: string | null }>(
      'SELECT prazo::text, status, cancelada_por FROM tarefas_internas WHERE rotina_interna_id = $1 ORDER BY prazo',
      [id],
    )
    expect(linhas.rows).toEqual([
      { prazo: '2026-11-13', status: 'cancelada', cancelada_por: 'edicao_da_rotina' },
      { prazo: '2026-11-17', status: 'pendente', cancelada_por: null },
    ])
  })

  it('a tarefa que a equipe cancelou não renasce (regra 27)', async () => {
    const r = await criarRotina({ frequencia: 'semanal', diaSemana: 3, escopoAplicacao: 'global' }).expect(201)
    const id = r.body.rotina.id as string
    // Quarta: hoje (11/11) e 18/11 estão na janela de 7 dias. A equipe cancela a de hoje.
    expect(await prazosDaRotina(id)).toEqual([['2026-11-11', '-'], ['2026-11-18', '-']])
    const t = await migrate.query<{ id: string }>(`SELECT id FROM tarefas_internas WHERE rotina_interna_id = $1 AND prazo = '2026-11-11'`, [id])
    await http().post(`/v1/carteira/tarefas-internas/${t.rows[0]!.id}/status`).set('Cookie', cookie.A).send({ status: 'cancelada' }).expect(200)
    for (let i = 0; i < 3; i++) await app.get(RotinaInternaService).gerarTarefasDeRotinasInternas([grupoA, grupoB])
    expect(await prazosDaRotina(id)).toEqual([['2026-11-18', '-']])
  })

  it('combinação que não gera nada é recusada: vencimento sem ser por cliente', async () => {
    const r = await criarRotina({ frequencia: 'vencimento', antecedencia: 3, escopoAplicacao: 'global' }).expect(400)
    expect(r.body.message).toContain('cada cliente')
  })

  it('a lista de rotinas traz o texto da frequência e a próxima data', async () => {
    const r = await http().get('/v1/carteira/rotinas-internas').set('Cookie', cookie.A).expect(200)
    const venc = r.body.rotinas.find((x: { frequencia: string }) => x.frequencia === 'vencimento')
    expect(venc.textoFrequencia).toBe('3 dias antes do vencimento de cada cliente')
    expect(venc.proxima).toBe('2026-12-07')
  })
})

describe('tarefa: recorrência que não dobra, transferir, seções (R1–R4)', () => {
  it('concluir uma recorrente cria a próxima UMA vez, mesmo concluindo, reabrindo e concluindo de novo', async () => {
    const criada = await http()
      .post('/v1/carteira/tarefas-internas')
      .set('Cookie', cookie.A)
      .send({ titulo: `Recorrente ${sufixo}`, prazo: '2026-11-11', recorrencia: 'semanal' })
      .expect(201)
    const id = criada.body.tarefa.id as string
    expect(criada.body.tarefa.secao).toBe('hoje')
    expect(criada.body.tarefa.solicitanteUsuarioGestaoId).toBe(gestoraA)
    const primeira = await http().post(`/v1/carteira/tarefas-internas/${id}/status`).set('Cookie', cookie.A).send({ status: 'concluida' }).expect(200)
    expect(primeira.body.proxima.prazo).toBe('2026-11-18')
    await http().post(`/v1/carteira/tarefas-internas/${id}/status`).set('Cookie', cookie.A).send({ status: 'concluida' }).expect(200)
    await http().post(`/v1/carteira/tarefas-internas/${id}/status`).set('Cookie', cookie.A).send({ status: 'pendente' }).expect(200)
    const terceira = await http().post(`/v1/carteira/tarefas-internas/${id}/status`).set('Cookie', cookie.A).send({ status: 'concluida' }).expect(200)
    expect(terceira.body.proxima).toBeNull()
    const proximas = await migrate.query('SELECT prazo::text FROM tarefas_internas WHERE tarefa_origem_id = $1', [id])
    expect(proximas.rows).toEqual([{ prazo: '2026-11-18' }])
  })

  it('transferir para a colega do grupo funciona; para alguém de outro grupo, 403 e nada muda', async () => {
    const t = await http()
      .post('/v1/carteira/tarefas-internas')
      .set('Cookie', cookie.A)
      .send({ titulo: `Transferir ${sufixo}`, prazo: '2026-11-20', clienteCarteiraId: cliente2 })
      .expect(201)
    const id = t.body.tarefa.id as string
    await http().post(`/v1/carteira/tarefas-internas/${id}/responsavel`).set('Cookie', cookie.A).send({ responsavelUsuarioGestaoId: gestoraB }).expect(403)
    const ok = await http().post(`/v1/carteira/tarefas-internas/${id}/responsavel`).set('Cookie', cookie.A).send({ responsavelUsuarioGestaoId: gestoraA2 }).expect(200)
    expect(ok.body.tarefa.responsavelUsuarioGestaoId).toBe(gestoraA2)
    expect(ok.body.tarefa.transferidaDeUsuarioGestaoId).toBe(gestoraA)
  })

  it('"Minhas" filtra pela pessoa da sessão; a seção vem do servidor', async () => {
    const minhas = await http().get('/v1/carteira/tarefas-internas').set('Cookie', cookie.A2).expect(200)
    expect(minhas.body.hoje).toBe('2026-11-11')
    for (const t of minhas.body.tarefas) expect(t.responsavelUsuarioGestaoId).toBe(gestoraA2)
    expect(minhas.body.tarefas.length).toBeGreaterThan(0)
  })
})

describe('isolamento por grupo', () => {
  it('o grupo B não vê rotinas nem tarefas do A, e não mexe nelas (404 idêntico a "não existe")', async () => {
    const rotinas = await http().get('/v1/carteira/rotinas-internas').set('Cookie', cookie.B).expect(200)
    expect(rotinas.body.rotinas).toEqual([])
    const tarefas = await http().get('/v1/carteira/tarefas-internas?responsavel=todas').set('Cookie', cookie.B).expect(200)
    expect(JSON.stringify(tarefas.body)).not.toContain(cliente1)
    expect(JSON.stringify(tarefas.body)).not.toContain(`Clínica Um ${sufixo}`)

    const deA = await migrate.query<{ id: string }>(`SELECT id FROM tarefas_internas WHERE grupo_id = $1 AND status = 'pendente' LIMIT 1`, [grupoA])
    const alheia = deA.rows[0]!.id
    await http().post(`/v1/carteira/tarefas-internas/${alheia}/status`).set('Cookie', cookie.B).send({ status: 'concluida' }).expect(404)
    await http().post(`/v1/carteira/tarefas-internas/${alheia}/responsavel`).set('Cookie', cookie.B).send({ responsavelUsuarioGestaoId: gestoraB }).expect(404)
    const rotinaA = await migrate.query<{ id: string }>('SELECT id FROM rotinas_internas WHERE grupo_id = $1 LIMIT 1', [grupoA])
    await http()
      .put(`/v1/carteira/rotinas-internas/${rotinaA.rows[0]!.id}`)
      .set('Cookie', cookie.B)
      .send({ titulo: 'x', frequencia: 'diaria', escopoAplicacao: 'global' })
      .expect(404)
    const status = await migrate.query('SELECT status FROM tarefas_internas WHERE id = $1', [alheia])
    expect(status.rows[0]!.status).toBe('pendente')
  })

  it('o grupo B não marca item de tarefa do A', async () => {
    const item = await migrate.query<{ id: string; tarefa_interna_id: string }>(
      'SELECT id, tarefa_interna_id FROM itens_de_tarefa_interna WHERE grupo_id = $1 LIMIT 1',
      [grupoA],
    )
    const i = item.rows[0]!
    await http().post(`/v1/carteira/tarefas-internas/${i.tarefa_interna_id}/itens/${i.id}`).set('Cookie', cookie.B).send({ feito: false }).expect(404)
  })
})

describe('carga e redistribuir — só escopo geral (A-5, A-9: carteira.administrar ainda não existe)', () => {
  it('Usuário de Gestão de grupo: carga e redistribuir respondem 403', async () => {
    await http().get('/v1/carteira/carga').set('Cookie', cookie.A).expect(403)
    await http()
      .post('/v1/carteira/tarefas-internas/redistribuir')
      .set('Cookie', cookie.A)
      .send({ deUsuarioGestaoId: gestoraA, paraUsuarioGestaoId: gestoraA2, tipo: 'todas' })
      .expect(403)
    const equipe = await http().get('/v1/carteira/equipe-da-rotina').set('Cookie', cookie.A).expect(200)
    expect(equipe.body.podeVerCarga).toBe(false)
    expect(equipe.body.pessoas.map((p: { id: string }) => p.id).sort()).toEqual([gestoraA, gestoraA2].sort())
  })

  it('a conta de gestão de um superadmin não aparece como colega: só para o próprio dono', async () => {
    const hash = await hashDeSenha(SENHA)
    const op = (
      await migrate.query<{ id: string }>(
        `INSERT INTO operadores (usuario, nome, senha_hash) VALUES ($1, 'Suporte', $2) RETURNING id`,
        [`op.${sufixo}`, hash],
      )
    ).rows[0]!.id
    // Criar o operador já cria a conta de gestão dele (função da 0061): só a lemos.
    const contaDoOperador = (
      await migrate.query<{ usuario_gestao_id: string }>(
        'SELECT usuario_gestao_id FROM contas_de_gestao_do_operador WHERE operador_id = $1',
        [op],
      )
    ).rows[0]!.usuario_gestao_id
    try {
      const ids = (r: { body: { pessoas: { id: string }[] } }): string[] => r.body.pessoas.map((p) => p.id)
      const vista = await http().get('/v1/carteira/equipe-da-rotina').set('Cookie', cookie.geral).expect(200)
      expect(ids(vista)).not.toContain(contaDoOperador)
      expect(ids(vista)).toContain(vista.body.eu)
    } finally {
      await migrate.query('DELETE FROM operadores WHERE id = $1', [op])
      await migrate.query('DELETE FROM usuarios_gestao WHERE id = $1', [contaDoOperador])
    }
  })

  it('o operador logado na carteira VÊ a própria conta na equipe (a exceção u.id = sessão)', async () => {
    const op = (
      await migrate.query<{ id: string }>(
        `INSERT INTO operadores (usuario, nome, senha_hash) VALUES ($1, 'Dono Logado', $2) RETURNING id`,
        [`opv.${sufixo}`, await hashDeSenha(SENHA)],
      )
    ).rows[0]!.id
    const conta = (
      await migrate.query<{ usuario_gestao_id: string }>(
        'SELECT usuario_gestao_id FROM contas_de_gestao_do_operador WHERE operador_id = $1',
        [op],
      )
    ).rows[0]!.usuario_gestao_id
    try {
      // A conta do operador não tem senha: a sessão nasce como o painel a abre (token + hash).
      const { token, hash } = novoToken()
      await migrate.query(
        `INSERT INTO sessoes_de_carteira (usuario_gestao_id, token_hash, expira_em)
         VALUES ($1, $2, now() + interval '1 hour')`,
        [conta, hash],
      )
      const dele = `${NOME_DO_COOKIE_CARTEIRA}=${token}`
      const vista = await http().get('/v1/carteira/equipe-da-rotina').set('Cookie', dele).expect(200)
      expect(vista.body.eu).toBe(conta)
      expect(vista.body.pessoas.map((p: { id: string }) => p.id)).toContain(conta)
      // E a colega comum, que não é conta de operador, continua à vista dele.
      expect(vista.body.pessoas.map((p: { id: string }) => p.id)).toContain(geral)
    } finally {
      await migrate.query('DELETE FROM sessoes_de_carteira WHERE usuario_gestao_id = $1', [conta])
      await migrate.query('DELETE FROM operadores WHERE id = $1', [op])
      await migrate.query('DELETE FROM usuarios_gestao WHERE id = $1', [conta])
    }
  })

  it('geral: a carga conta por semana de segunda a domingo; redistribuir ×3 move uma vez, nunca rotina', async () => {
    const carga = await http().get(`/v1/carteira/carga?pessoa=${gestoraA}`).set('Cookie', cookie.geral).expect(200)
    expect(carga.body.semanas.map((s: { inicio: string }) => s.inicio)).toEqual(['2026-11-09', '2026-11-16', '2026-11-23', '2026-11-30'])
    expect(carga.body.semanas[0].ultimoDia).toBe('2026-11-15')
    const linha = carga.body.pessoas.find((p: { usuarioGestaoId: string }) => p.usuarioGestaoId === gestoraA)
    expect(linha.semanas[0].porTipo.rotina).toBeGreaterThan(0)
    expect(carga.body.detalhe.usuarioGestaoId).toBe(gestoraA)

    const avulsa = await http()
      .post('/v1/carteira/tarefas-internas')
      .set('Cookie', cookie.A)
      .send({ titulo: `Avulsa ${sufixo}`, prazo: '2026-11-19' })
      .expect(201)

    const corpo = { deUsuarioGestaoId: gestoraA, paraUsuarioGestaoId: gestoraA2, tipo: 'todas' }
    const vezes: number[] = []
    for (let i = 0; i < 3; i++) {
      vezes.push((await http().post('/v1/carteira/tarefas-internas/redistribuir').set('Cookie', cookie.geral).send(corpo).expect(200)).body.movidas)
    }
    expect(vezes[0]).toBeGreaterThanOrEqual(1)
    expect(vezes.slice(1)).toEqual([0, 0])
    const movida = await migrate.query('SELECT responsavel_usuario_gestao_id AS r, transferida_de_usuario_gestao_id AS de FROM tarefas_internas WHERE id = $1', [avulsa.body.tarefa.id])
    expect(movida.rows[0]).toEqual({ r: gestoraA2, de: gestoraA })
    const rotinasDeA = await migrate.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM tarefas_internas
        WHERE rotina_interna_id IS NOT NULL AND status = 'pendente' AND transferida_de_usuario_gestao_id IS NOT NULL AND grupo_id = $1`,
      [grupoA],
    )
    expect(rotinasDeA.rows[0]!.n).toBe(0)

    // Destino de outro grupo não recebe tarefa do grupo A.
    const paraB = await http()
      .post('/v1/carteira/tarefas-internas/redistribuir')
      .set('Cookie', cookie.geral)
      .send({ deUsuarioGestaoId: gestoraA2, paraUsuarioGestaoId: gestoraB, tipo: 'todas' })
      .expect(200)
    expect(paraB.body.movidas).toBe(0)
  })
})

describe('aniversários (P6, LGPD A45–A48)', () => {
  it('lista hoje e os próximos 7 dias, sem idade e sem telefone; cada grupo vê só o seu', async () => {
    await http().put('/v1/carteira/eu/aniversario').set('Cookie', cookie.A2).send({ dia: 13, mes: 11, mostrar: true }).expect(200)
    const a = await http().get('/v1/carteira/aniversarios').set('Cookie', cookie.A).expect(200)
    const nomes = a.body.aniversarios.map((x: { nome: string }) => x.nome)
    expect(nomes).toContain('Dra. Ana Souza')
    expect(nomes).toContain('Pessoa rot.a2')
    const ana = a.body.aniversarios.find((x: { nome: string }) => x.nome === 'Dra. Ana Souza')
    expect(ana).toMatchObject({ tipo: 'cliente', dia: 12, mes: 11, data: '2026-11-12', emDias: 1, podeParabenizar: true })
    const corpo = JSON.stringify(a.body)
    expect(corpo).not.toContain('idade')
    expect(corpo).not.toContain('99998888')

    const b = await http().get('/v1/carteira/aniversarios').set('Cookie', cookie.B).expect(200)
    const corpoB = JSON.stringify(b.body)
    expect(corpoB).not.toContain('Dra. Ana Souza')
    expect(corpoB).not.toContain('Pessoa rot.a2')
    expect(corpoB).toContain(`Clínica B ${sufixo}`)
  })

  it('oposição: mostrar = false tira da lista da equipe', async () => {
    await http().put('/v1/carteira/eu/aniversario').set('Cookie', cookie.A2).send({ dia: 13, mes: 11, mostrar: false }).expect(200)
    const a = await http().get('/v1/carteira/aniversarios').set('Cookie', cookie.A).expect(200)
    expect(a.body.aniversarios.map((x: { nome: string }) => x.nome)).not.toContain('Pessoa rot.a2')
  })

  it('o "Parabenizar" monta o link só no clique, com mensagem sem idade; o grupo B não alcança o cliente do A', async () => {
    const r = await http().post('/v1/carteira/aniversarios/parabenizar').set('Cookie', cookie.A).send({ tipo: 'cliente', id: cliente1 }).expect(200)
    expect(r.body.url).toMatch(/^https:\/\/wa\.me\/5571999998888\?text=/)
    const texto = decodeURIComponent(r.body.url.split('?text=')[1])
    expect(texto).toContain('Dra. Ana')
    expect(texto).not.toMatch(/\d/)
    await http().post('/v1/carteira/aniversarios/parabenizar').set('Cookie', cookie.B).send({ tipo: 'cliente', id: cliente1 }).expect(400)
  })

  it('dia que não existe no mês é recusado', async () => {
    await http().put('/v1/carteira/eu/aniversario').set('Cookie', cookie.A).send({ dia: 31, mes: 4, mostrar: true }).expect(400)
  })
})
