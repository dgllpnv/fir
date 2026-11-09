import type { Relogio } from '@fir/domain'
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify'
import { Test } from '@nestjs/testing'
import pg from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { AppModule } from '../app.module'
import { hashDeSenha } from '../autenticacao/senha'
import { apagarClinicaDeTeste, declararAtorSistema } from '../banco/limpeza-de-teste'
import { RELOGIO } from '../comum/relogio'
import { registrarCookie } from '../main'

/**
 * **"Chegou por uma campanha?"** no cadastro da paciente (correções da PO, A3
 * no cadastro; construído pela frente B2B3 sobre a regra de A3).
 *
 * Fixa: só campanha em andamento HOJE, no fuso da clínica (AB-A3-4, N-7); o
 * mesmo 400 para outra clínica, excluída e inventada (S-11); três estados na
 * edição, com a campanha atual aceita mesmo encerrada (N-4); a troca entra na
 * trilha com ids (L-A3-7).
 */
const URL_MIG =
  process.env['DATABASE_URL_MIGRATE'] ?? 'postgresql://fir_migrate:fir_local_dev@127.0.0.1:4832/fir'

const SENHA = 'senha-de-teste-campanha-paciente'
const codigo = `cpc-${Date.now()}`
const FUSO = 'America/Sao_Paulo'

/** 20/11/2026 23:30 em São Paulo — já 21/11 em UTC. */
const AGORA = new Date('2026-11-21T02:30:00Z')
let agora = new Date(AGORA)
const relogio: Relogio = { agora: () => agora }

let app: NestFastifyApplication
let migrate: pg.Client
let clinica: string
let vizinha: string
let helena: string
let juliana: string[]
const campanha: Record<string, string> = {}

const umId = async (sql: string, params: unknown[]): Promise<string> =>
  (await migrate.query<{ id: string }>(sql, params)).rows[0]!.id
const srv = () => request(app.getHttpServer())
const criar = (corpo: Record<string, unknown>) =>
  srv().post('/v1/pacientes').set('Cookie', juliana).send(corpo)
const editar = (id: string, corpo: Record<string, unknown>) =>
  srv().patch(`/v1/pacientes/${id}`).set('Cookie', juliana).send(corpo)
const campanhaDe = async (id: string): Promise<string | null> =>
  (
    await migrate.query<{ c: string | null }>(
      'SELECT campanha_id::text AS c FROM pacientes WHERE id = $1',
      [id],
    )
  ).rows[0]!.c

let seq = 0
const nome = () => `Paciente ${codigo} ${++seq}`

beforeAll(async () => {
  migrate = new pg.Client({ connectionString: URL_MIG })
  migrate.on('error', (e) => console.error('[campanha-no-cadastro] migrate:', e.message))
  await migrate.connect()
  await declararAtorSistema(migrate)

  clinica = await umId(
    `INSERT INTO clinicas (codigo, nome, fuso) VALUES ($1, 'Clínica Campanha', $2) RETURNING id`,
    [codigo, FUSO],
  )
  vizinha = await umId(
    `INSERT INTO clinicas (codigo, nome, fuso) VALUES ($1, 'Vizinha', $2) RETURNING id`,
    [`${codigo}-v`, FUSO],
  )
  const perfil = await umId(
    `INSERT INTO perfis (clinica_id, chave, nome, perms)
     VALUES ($1, 'pf_rec', 'Recepção', ARRAY['pacientes']) RETURNING id`,
    [clinica],
  )
  helena = await umId(
    `INSERT INTO pessoas (clinica_id, nome, usuario, funcao, senha_hash, admin, perfil_id)
     VALUES ($1, 'Juliana', 'juliana', 'Recepcionista', $2, false, $3) RETURNING id`,
    [clinica, await hashDeSenha(SENHA), perfil],
  )
  const outraPessoa = await umId(
    `INSERT INTO pessoas (clinica_id, nome, usuario, funcao, senha_hash, admin)
     VALUES ($1, 'Outra', 'outra', 'x', 'x', true) RETURNING id`,
    [vizinha],
  )
  const camp = async (cl: string, por: string, n: string, inicio: string, fim: string, excluida = false) =>
    umId(
      `INSERT INTO campanhas (clinica_id, nome, inicio, fim, criada_por, excluida_em, metrica, meta)
       VALUES ($1, $2, $3, $4, $5, $6, 'convertidos', 10) RETURNING id`,
      [cl, n, inicio, fim, por, excluida ? new Date() : null],
    )
  // "Hoje" na clínica é 20/11.
  campanha['ativa'] = await camp(clinica, helena, 'Novembro', '2026-11-01', '2026-11-30')
  campanha['terminaHoje'] = await camp(clinica, helena, 'Até hoje', '2026-11-10', '2026-11-20')
  campanha['encerradaOntem'] = await camp(clinica, helena, 'Até ontem', '2026-11-01', '2026-11-19')
  campanha['futura'] = await camp(clinica, helena, 'Dezembro', '2026-12-01', '2026-12-31')
  campanha['excluida'] = await camp(clinica, helena, 'Excluída', '2026-11-01', '2026-11-30', true)
  campanha['daVizinha'] = await camp(vizinha, outraPessoa, 'Vizinha', '2026-11-01', '2026-11-30')

  const mod = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(RELOGIO)
    .useValue(relogio)
    .compile()
  app = mod.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
  await registrarCookie(app)
  await app.init()
  await app.getHttpAdapter().getInstance().ready()

  const r = await srv()
    .post('/v1/entrar')
    .send({ clinica: codigo, usuario: 'juliana', senha: SENHA })
    .expect(200)
  const v = r.headers['set-cookie'] as unknown
  juliana = Array.isArray(v) ? (v as string[]) : typeof v === 'string' ? [v] : []
})

afterAll(async () => {
  await apagarClinicaDeTeste(migrate, clinica)
  await apagarClinicaDeTeste(migrate, vizinha)
  await migrate.end()
  await app.close()
})

beforeEach(() => {
  agora = new Date(AGORA)
})

describe('cadastrar com campanha', () => {
  it('grava a campanha em andamento hoje, inclusive a que termina hoje às 23:30 da clínica', async () => {
    for (const k of ['ativa', 'terminaHoje']) {
      const r = await criar({ nome: nome(), campanhaId: campanha[k] }).expect(201)
      expect(await campanhaDe(r.body.id as string)).toBe(campanha[k])
    }
  })

  it('recusa a encerrada ontem e a que ainda não começou (AB-A3-4)', async () => {
    for (const k of ['encerradaOntem', 'futura']) {
      const n = nome()
      const r = await criar({ nome: n, campanhaId: campanha[k] }).expect(400)
      expect(r.body.message).toBe('Esta campanha não está em andamento hoje. Escolha uma da lista.')
      const achou = await migrate.query('SELECT 1 FROM pacientes WHERE clinica_id = $1 AND nome = $2', [
        clinica,
        n,
      ])
      expect(achou.rowCount).toBe(0)
    }
  })

  it('outra clínica, excluída e inventada: o MESMO 400 (S-11)', async () => {
    const corpos = new Set<string>()
    for (const id of [
      campanha['daVizinha'],
      campanha['excluida'],
      '0b6b6f43-8c7e-4c55-9a38-2a2f6a2f9e01',
    ]) {
      const r = await criar({ nome: nome(), campanhaId: id }).expect(400)
      corpos.add(JSON.stringify(r.body))
    }
    expect(corpos.size).toBe(1)
  })
})

describe('editar a campanha — três estados (N-4)', () => {
  it('ausente mantém, a atual passa mesmo encerrada, `null` remove; e a troca entra na trilha', async () => {
    const r = await criar({ nome: nome(), campanhaId: campanha['ativa'] }).expect(201)
    const id = r.body.id as string

    // Um mês depois a campanha de novembro acabou.
    agora = new Date('2026-12-20T15:00:00Z')
    await editar(id, { telefone: '71 98888-0000' }).expect(200)
    expect(await campanhaDe(id)).toBe(campanha['ativa'])

    // Reenviar a atual (o formulário com o select intocado) não solta a campanha.
    await editar(id, { campanhaId: campanha['ativa'] }).expect(200)
    expect(await campanhaDe(id)).toBe(campanha['ativa'])

    // Trocar para uma fora da janela de hoje: recusado.
    await editar(id, { campanhaId: campanha['terminaHoje'] }).expect(400)

    await editar(id, { campanhaId: null }).expect(200)
    expect(await campanhaDe(id)).toBeNull()

    const t = await migrate.query<{ de: Record<string, unknown>; para: Record<string, unknown> }>(
      `SELECT de, para FROM auditoria
        WHERE clinica_id = $1 AND entidade = 'pacientes' AND entidade_id = $2 AND acao = 'alterou'
        ORDER BY em DESC, id DESC LIMIT 1`,
      [clinica, id],
    )
    expect(t.rows[0]!.de['campanha_id']).toBe(campanha['ativa'])
    expect(t.rows[0]!.para['campanha_id']).toBeNull()
  })

  it('a ficha devolve o id da campanha do cadastro', async () => {
    const r = await criar({ nome: nome(), campanhaId: campanha['ativa'] }).expect(201)
    const f = await srv().get(`/v1/pacientes/${r.body.id as string}`).set('Cookie', juliana).expect(200)
    expect(f.body.campanhaId).toBe(campanha['ativa'])
  })
})
