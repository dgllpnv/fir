import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify'
import { Test } from '@nestjs/testing'
import pg from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AppModule } from '../app.module'
import { hashDeSenha } from '../autenticacao/senha'
import { apagarClinicaDeTeste, apagarOperadorDeTeste, declararAtorSistema } from '../banco/limpeza-de-teste'
import { registrarCookie } from '../main'

/**
 * `GET /v1/clinica/grupos` — a clínica vê quem a recebe (transparência).
 * Postgres real: a função SECURITY DEFINER e a RLS são o que se mede.
 */
const URL_MIG =
  process.env['DATABASE_URL_MIGRATE'] ?? 'postgresql://fir_migrate:fir_local_dev@127.0.0.1:4832/fir'
const URL_CARTEIRA =
  process.env['DATABASE_URL_CARTEIRA'] ?? 'postgresql://fir_carteira:fir_local_dev@127.0.0.1:4832/fir'
const SENHA = 'montanha-de-vidro-aberta'

let app: NestFastifyApplication
let migrate: pg.Client
let operador: string
let clinicaA: string
let clinicaB: string
let grupoX: string
let grupoY: string
let admin: string[]
let recepcao: string[]
const codigo = `gg-${Date.now()}`

const cookieDe = (r: { headers: Record<string, string> }): string[] => {
  const v = r.headers['set-cookie'] as unknown
  return Array.isArray(v) ? (v as string[]) : typeof v === 'string' ? [v] : []
}
const entrar = (cod: string, usuario: string) =>
  request(app.getHttpServer()).post('/v1/entrar').send({ clinica: cod, usuario, senha: SENHA })
const pegar = (sessao?: string[]) => {
  const r = request(app.getHttpServer()).get('/v1/clinica/grupos')
  return sessao === undefined ? r : r.set('Cookie', sessao)
}

async function designar(clinica: string, grupo: string, motivo: string) {
  const c = new pg.Client({ connectionString: URL_CARTEIRA })
  await c.connect()
  try {
    await c.query(`SELECT set_config('app.pessoa_id', $1, false), set_config('app.escopo', 'geral', false)`, [
      `operador:${operador}`,
    ])
    await c.query('SELECT adicionar_clinica_ao_grupo($1, $2, $3)', [clinica, grupo, motivo])
  } finally {
    await c.end()
  }
}

beforeAll(async () => {
  migrate = new pg.Client({ connectionString: URL_MIG })
  await migrate.connect()
  await declararAtorSistema(migrate)
  const nova = async (cod: string) =>
    (await migrate.query<{ id: string }>(`INSERT INTO clinicas (codigo, nome) VALUES ($1, 'Clínica GG') RETURNING id`, [cod])).rows[0]!.id
  clinicaA = await nova(codigo)
  clinicaB = await nova(`${codigo}-b`)
  operador = (
    await migrate.query<{ id: string }>(
      `INSERT INTO operadores (usuario, nome, senha_hash) VALUES ($1, 'Dono Teste', 'x') RETURNING id`,
      [`gg.op.${Date.now()}`],
    )
  ).rows[0]!.id
  grupoX = (await migrate.query<{ id: string }>(`INSERT INTO grupos (nome) VALUES ('Rede X GG') RETURNING id`)).rows[0]!.id
  grupoY = (await migrate.query<{ id: string }>(`INSERT INTO grupos (nome) VALUES ('Rede Y GG') RETURNING id`)).rows[0]!.id

  const perfil = (
    await migrate.query<{ id: string }>(
      `INSERT INTO perfis (clinica_id, chave, nome, perms) VALUES ($1, 'pf_rec', 'Recepção', ARRAY['jornada']) RETURNING id`,
      [clinicaA],
    )
  ).rows[0]!.id
  const hash = await hashDeSenha(SENHA)
  await migrate.query(
    `INSERT INTO pessoas (clinica_id, nome, usuario, senha_hash, admin) VALUES ($1, 'Helena', 'helena', $2, true)`,
    [clinicaA, hash],
  )
  await migrate.query(
    `INSERT INTO pessoas (clinica_id, nome, usuario, senha_hash, perfil_id) VALUES ($1, 'Juliana', 'juliana', $2, $3)`,
    [clinicaA, hash, perfil],
  )

  await designar(clinicaA, grupoX, 'rede parceira')
  await designar(clinicaB, grupoY, 'segredo da vizinha')

  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile()
  app = mod.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
  await registrarCookie(app)
  await app.init()
  await app.getHttpAdapter().getInstance().ready()
  admin = cookieDe(await entrar(codigo, 'helena').expect(200))
  recepcao = cookieDe(await entrar(codigo, 'juliana').expect(200))
})

afterAll(async () => {
  await app.close()
  await declararAtorSistema(migrate)
  await apagarClinicaDeTeste(migrate, clinicaA)
  await apagarClinicaDeTeste(migrate, clinicaB)
  await migrate.query('DELETE FROM grupos WHERE id = ANY($1)', [[grupoX, grupoY]])
  await apagarOperadorDeTeste(migrate, operador)
  await migrate.end()
})

describe('GET /v1/clinica/grupos', () => {
  it('lista o grupo, o desde e o motivo', async () => {
    const r = await pegar(admin).expect(200)
    expect(r.body.grupos).toHaveLength(1)
    expect(r.body.grupos[0]).toMatchObject({ grupo: 'Rede X GG', motivo: 'rede parceira' })
    expect(new Date(r.body.grupos[0].desde as string).toString()).not.toBe('Invalid Date')
  })

  it('não vaza o grupo nem o motivo da outra clínica', async () => {
    const r = await pegar(admin).expect(200)
    const texto = JSON.stringify(r.body)
    expect(texto).not.toContain('Rede Y GG')
    expect(texto).not.toContain('segredo da vizinha')
  })

  it('só traz grupo, desde e motivo: nenhum cliente, valor ou contato', async () => {
    const r = await pegar(admin).expect(200)
    expect(Object.keys(r.body as object)).toEqual(['grupos'])
    expect(Object.keys(r.body.grupos[0] as object).sort()).toEqual(['desde', 'grupo', 'motivo'])
  })

  it('grupo desativado sai da lista', async () => {
    await migrate.query('UPDATE grupos SET ativo = false WHERE id = $1', [grupoX])
    try {
      const r = await pegar(admin).expect(200)
      expect(r.body.grupos).toEqual([])
    } finally {
      await migrate.query('UPDATE grupos SET ativo = true WHERE id = $1', [grupoX])
    }
  })

  it('perfil sem `config` é 403', async () => {
    await pegar(recepcao).expect(403)
  })

  it('sem sessão é 401', async () => {
    await pegar().expect(401)
  })
})
