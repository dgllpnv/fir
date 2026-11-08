import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify'
import { APP_GUARD } from '@nestjs/core'
import { Test } from '@nestjs/testing'
import { randomBytes } from 'node:crypto'
import pg from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { BancoModule } from '../../banco/banco.module'
import { hashDeSenha } from '../../autenticacao/senha'
import { declararAtorSistema } from '../../banco/limpeza-de-teste'
import { registrarCookie } from '../../main'
import { CarteiraGuard } from '../carteira.guard'
import { CarteiraModule } from '../carteira.module'
import { ProspeccaoCarteiraModule } from './prospeccao-carteira.module'

/**
 * Conversão de lead em `Cliente Firmare` — ticket 0.2 do G8 (F-3, A-11).
 *
 * O defeito em produção: um `Usuário de Gestão` de escopo `geral` cria um lead
 * sem grupo (a maioria dos leads não tem) e o converte. `clientes_carteira.
 * grupo_id` é NOT NULL, e o INSERT caía com 500. A correção (A-11): grupo
 * próprio do cliente, criado na MESMA transação por
 * `criar_grupo_de_conversao(lead_id)`, derivado do lead no banco — nunca do
 * corpo. E a conversão trava a linha do lead (`FOR UPDATE`) e tem `UNIQUE` em
 * `clientes_carteira.lead_origem_id`: duplo clique nunca cria dois pares
 * cliente+grupo.
 */
const URL_MIG =
  process.env['DATABASE_URL_MIGRATE'] ?? 'postgresql://fir_migrate:fir_local_dev@127.0.0.1:4832/fir'
const URL_CARTEIRA =
  process.env['DATABASE_URL_CARTEIRA'] ?? 'postgresql://fir_carteira:fir_local_dev@127.0.0.1:4832/fir'

let app: NestFastifyApplication
let migrate: pg.Client
let grupoA: string
let usuarioGeralId: string
let usuarioGrupoId: string
let cookieGeral: string
let cookieGrupo: string

const sufixo = randomBytes(4).toString('hex')
const SENHA = 'quatro-pedras-no-caminho'

const cookies = (r: { headers: Record<string, string> }): string[] => {
  const v = r.headers['set-cookie'] as unknown
  return Array.isArray(v) ? (v as string[]) : typeof v === 'string' ? [v] : []
}
const paresDe = (lista: string[]): string => lista.map((c) => c.split(';')[0]!).join('; ')
const http = () => request(app.getHttpServer())

async function criarLead(cookie: string, nome: string): Promise<{ id: string; grupoId: string | null }> {
  const r = await http()
    .post('/v1/carteira/leads')
    .set('Cookie', cookie)
    .send({ nome, origem: 'indicação', temperatura: 'quente' })
    .expect(201)
  return r.body.lead as { id: string; grupoId: string | null }
}

const ganhar = (cookie: string, leadId: string) =>
  http().post(`/v1/carteira/leads/${leadId}/etapa`).set('Cookie', cookie).send({ etapa: 'ganho' })

beforeAll(async () => {
  migrate = new pg.Client({ connectionString: URL_MIG })
  await migrate.connect()
  await declararAtorSistema(migrate)

  grupoA = (
    await migrate.query<{ id: string }>(`INSERT INTO grupos (nome) VALUES ($1) RETURNING id`, [
      `Grupo Conversão ${sufixo}`,
    ])
  ).rows[0]!.id

  const hash = await hashDeSenha(SENHA)
  usuarioGeralId = (
    await migrate.query<{ id: string }>(
      `INSERT INTO usuarios_gestao (usuario, nome, senha_hash, escopo, grupo_id)
       VALUES ($1, 'Gestora Geral', $2, 'geral', NULL) RETURNING id`,
      [`conv.geral.${sufixo}`, hash],
    )
  ).rows[0]!.id
  usuarioGrupoId = (
    await migrate.query<{ id: string }>(
      `INSERT INTO usuarios_gestao (usuario, nome, senha_hash, escopo, grupo_id)
       VALUES ($1, 'Gestora Grupo', $2, 'grupo', $3) RETURNING id`,
      [`conv.grupo.${sufixo}`, hash, grupoA],
    )
  ).rows[0]!.id

  const mod = await Test.createTestingModule({
    imports: [BancoModule, CarteiraModule, ProspeccaoCarteiraModule],
    providers: [{ provide: APP_GUARD, useClass: CarteiraGuard }],
  }).compile()
  app = mod.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
  await registrarCookie(app)
  await app.init()
  await app.getHttpAdapter().getInstance().ready()

  cookieGeral = paresDe(
    cookies(await http().post('/v1/carteira/entrar').send({ usuario: `conv.geral.${sufixo}`, senha: SENHA }).expect(200)),
  )
  cookieGrupo = paresDe(
    cookies(await http().post('/v1/carteira/entrar').send({ usuario: `conv.grupo.${sufixo}`, senha: SENHA }).expect(200)),
  )
})

afterAll(async () => {
  await declararAtorSistema(migrate)
  const leads = (
    await migrate.query<{ id: string }>(`SELECT id FROM leads_comerciais WHERE nome LIKE $1`, [`%${sufixo}`])
  ).rows.map((r) => r.id)
  const clientes = (
    await migrate.query<{ id: string }>(
      `SELECT id FROM clientes_carteira WHERE lead_origem_id = ANY($1) OR grupo_id = $2`,
      [leads, grupoA],
    )
  ).rows.map((r) => r.id)
  const gruposDeConversao = (
    await migrate.query<{ id: string }>(`SELECT id FROM grupos WHERE lead_origem_id = ANY($1)`, [leads])
  ).rows.map((r) => r.id)
  // G8 1E: a conversão escreve "Contrato fechado" no histórico do lead.
  await migrate.query(`DELETE FROM interacoes_do_lead WHERE lead_comercial_id = ANY($1)`, [leads])
  await migrate.query(`DELETE FROM leads_comerciais WHERE id = ANY($1)`, [leads])
  await migrate.query(`DELETE FROM clientes_carteira WHERE id = ANY($1)`, [clientes])
  await migrate.query(`DELETE FROM grupos WHERE id = ANY($1)`, [gruposDeConversao])
  await migrate.query(`DELETE FROM sessoes_de_carteira WHERE usuario_gestao_id = ANY($1)`, [
    [usuarioGeralId, usuarioGrupoId],
  ])
  await migrate.query(`DELETE FROM usuarios_gestao WHERE id = ANY($1)`, [[usuarioGeralId, usuarioGrupoId]])
  await migrate.query(`DELETE FROM grupos WHERE id = $1`, [grupoA])
  await migrate.end()
  await app.close()
})

/**
 * Duplo clique determinístico, sem depender de sorte de agendamento.
 * `gruposEsperados`: quantos grupos de conversão o lead deve ter gerado.
 */
async function duploCliqueDeterministico(cookie: string, nome: string, gruposEsperados: number | null): Promise<void> {
  const lead = await criarLead(cookie, nome)

  // Uma transação externa segura a linha do lead. As duas requisições
  // chegam, ficam AMBAS esperando a trava (medido em pg_stat_activity, não
  // por sleep) e só então a trava é solta. Sem `FOR UPDATE` no serviço, as
  // duas leriam a etapa antiga sem esperar e tentariam converter.
  const trava = new pg.Client({ connectionString: URL_MIG })
  await trava.connect()
  await trava.query('BEGIN')
  await trava.query(`SELECT id FROM leads_comerciais WHERE id = $1 FOR UPDATE`, [lead.id])
  const pidDaTrava = (await trava.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid

  const pa = ganhar(cookie, lead.id).then((r) => r)
  const pb = ganhar(cookie, lead.id).then((r) => r)

  let esperando = 0
  for (let i = 0; i < 200 && esperando < 2; i++) {
    const r = await migrate.query<{ n: number }>(
      // Recursivo: o segundo a chegar espera a trava de tupla do primeiro, não
      // a transação externa diretamente — a cadeia inteira conta.
      `WITH RECURSIVE presos(pid) AS (
         SELECT a.pid FROM pg_stat_activity a WHERE $1 = ANY(pg_blocking_pids(a.pid))
         UNION
         SELECT a.pid FROM pg_stat_activity a, presos p WHERE p.pid = ANY(pg_blocking_pids(a.pid))
       )
       SELECT count(*)::int AS n FROM presos`,
      [pidDaTrava],
    )
    esperando = r.rows[0]!.n
    if (esperando < 2) await new Promise((ok) => setTimeout(ok, 25))
  }
  expect(esperando, 'as duas conversões deveriam estar presas na trava do lead').toBe(2)

  await trava.query('COMMIT')
  await trava.end()
  const [a, b] = await Promise.all([pa, pb])
  expect([a.status, b.status]).toEqual([201, 201])
  expect(a.body.lead.clienteCarteiraId).toBe(b.body.lead.clienteCarteiraId)
  const clientes = await migrate.query(`SELECT 1 FROM clientes_carteira WHERE nome = $1`, [nome])
  expect(clientes.rows.length).toBe(1)
  if (gruposEsperados !== null) {
    const grupos = await migrate.query(`SELECT 1 FROM grupos WHERE lead_origem_id = $1`, [lead.id])
    expect(grupos.rows.length).toBe(gruposEsperados)
  }
}

describe('escopo geral, lead sem grupo (o defeito em produção)', () => {
  it('converte: cria o cliente num grupo próprio, derivado do lead, auditado com o Usuário de Gestão real', async () => {
    const lead = await criarLead(cookieGeral, `Clínica Sem Grupo ${sufixo}`)
    expect(lead.grupoId).toBeNull()

    const r = await ganhar(cookieGeral, lead.id)
    expect(r.status, JSON.stringify(r.body)).toBe(201)
    const clienteId = r.body.lead.clienteCarteiraId as string

    const cliente = (
      await migrate.query<{ grupo_id: string; lead_origem_id: string; nome: string }>(
        `SELECT grupo_id, lead_origem_id, nome FROM clientes_carteira WHERE id = $1`,
        [clienteId],
      )
    ).rows[0]!
    expect(cliente.lead_origem_id).toBe(lead.id)

    const grupo = (
      await migrate.query<{ nome: string; origem: string; lead_origem_id: string }>(
        `SELECT nome, origem, lead_origem_id FROM grupos WHERE id = $1`,
        [cliente.grupo_id],
      )
    ).rows[0]!
    expect(grupo).toEqual({ nome: `Clínica Sem Grupo ${sufixo}`, origem: 'conversao_de_lead', lead_origem_id: lead.id })

    const trilha = await migrate.query<{ ator_tipo: string; ator_id: string; acao: string }>(
      `SELECT ator_tipo, ator_id, acao FROM auditoria_do_painel WHERE entidade = 'grupos' AND entidade_id = $1`,
      [cliente.grupo_id],
    )
    expect(trilha.rows).toEqual([{ ator_tipo: 'usuario_gestao', ator_id: usuarioGeralId, acao: 'criou' }])
  })

  it('duplo clique em paralelo (Promise.all): um cliente e um grupo, e as duas respostas apontam para o mesmo', async () => {
    const lead = await criarLead(cookieGeral, `Duplo Clique ${sufixo}`)
    const [a, b] = await Promise.all([ganhar(cookieGeral, lead.id), ganhar(cookieGeral, lead.id)])
    expect([a.status, b.status]).toEqual([201, 201])
    expect(a.body.lead.clienteCarteiraId).toBe(b.body.lead.clienteCarteiraId)

    const clientes = await migrate.query(`SELECT 1 FROM clientes_carteira WHERE lead_origem_id = $1`, [lead.id])
    expect(clientes.rows.length).toBe(1)
    const grupos = await migrate.query(`SELECT 1 FROM grupos WHERE lead_origem_id = $1`, [lead.id])
    expect(grupos.rows.length).toBe(1)
  })

  it('duplo clique determinístico: as duas requisições esperam na MESMA trava do lead, e só uma converte', async () => {
    await duploCliqueDeterministico(cookieGeral, `Trava Determinística ${sufixo}`, 1)
  })
})

describe('escopo grupo', () => {
  it('continua usando o grupo da sessão, e não cria grupo nenhum', async () => {
    const lead = await criarLead(cookieGrupo, `Lead Do Grupo ${sufixo}`)
    expect(lead.grupoId).toBe(grupoA)
    const r = await ganhar(cookieGrupo, lead.id).expect(201)
    const cliente = (
      await migrate.query<{ grupo_id: string; lead_origem_id: string }>(
        `SELECT grupo_id, lead_origem_id FROM clientes_carteira WHERE id = $1`,
        [r.body.lead.clienteCarteiraId],
      )
    ).rows[0]!
    expect(cliente).toEqual({ grupo_id: grupoA, lead_origem_id: lead.id })
    const grupos = await migrate.query(`SELECT 1 FROM grupos WHERE lead_origem_id = $1`, [lead.id])
    expect(grupos.rows.length).toBe(0)
  })

  it('duplo clique determinístico também no escopo grupo: um cliente só', async () => {
    await duploCliqueDeterministico(cookieGrupo, `Trava Grupo ${sufixo}`, null)
  })
})

describe('criar_grupo_de_conversao: a porta é estreita (A-11 item 2)', () => {
  async function comoCarteira<T>(
    escopo: 'geral' | 'grupo',
    grupoId: string | null,
    fn: (c: pg.Client) => Promise<T>,
  ): Promise<T> {
    const c = new pg.Client({ connectionString: URL_CARTEIRA })
    await c.connect()
    try {
      await c.query('BEGIN')
      await c.query(`SELECT set_config('app.pessoa_id', $1, true)`, [`usuario_gestao:${usuarioGeralId}`])
      await c.query(`SELECT set_config('app.escopo', $1, true)`, [escopo])
      await c.query(`SELECT set_config('app.grupo_id', $1, true)`, [grupoId ?? ''])
      return await fn(c)
    } finally {
      await c.query('ROLLBACK').catch(() => undefined)
      await c.end()
    }
  }

  it('recusa sessão de escopo grupo', async () => {
    const lead = await criarLead(cookieGeral, `Porta Escopo ${sufixo}`)
    await expect(
      comoCarteira('grupo', grupoA, (c) => c.query('SELECT criar_grupo_de_conversao($1)', [lead.id])),
    ).rejects.toThrow(/escopo/)
  })

  it('recusa lead que já tem grupo', async () => {
    const lead = await criarLead(cookieGrupo, `Porta Com Grupo ${sufixo}`)
    await expect(
      comoCarteira('geral', null, (c) => c.query('SELECT criar_grupo_de_conversao($1)', [lead.id])),
    ).rejects.toThrow(/já tem grupo/)
  })

  it('recusa lead inexistente', async () => {
    await expect(
      comoCarteira('geral', null, (c) =>
        c.query('SELECT criar_grupo_de_conversao($1)', ['00000000-0000-0000-0000-000000000000']),
      ),
    ).rejects.toThrow(/não encontrado/)
  })

  it('não recebe nome: a assinatura só aceita o id do lead', async () => {
    const r = await migrate.query<{ args: string }>(
      `SELECT pg_get_function_identity_arguments('criar_grupo_de_conversao'::regproc) AS args`,
    )
    expect(r.rows[0]!.args).toBe('p_lead_id uuid')
  })
})
