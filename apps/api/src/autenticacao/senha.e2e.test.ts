import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify'
import { Test } from '@nestjs/testing'
import pg from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { AppModule } from '../app.module'
import { apagarClinicaDeTeste, declararAtorSistema } from '../banco/limpeza-de-teste'
import { registrarCookie } from '../main'
import { hashDeSenha } from './senha'

/**
 * A troca da própria senha, e a trava do primeiro acesso.
 *
 * A senha provisória foi digitada por OUTRA pessoa, ditada no balcão e
 * anotada num papel. Ela é uma credencial compartilhada por construção, e a
 * única coisa que ela pode fazer é deixar de ser.
 */
const URL_MIG =
  process.env['DATABASE_URL_MIGRATE'] ?? 'postgresql://fir_migrate:fir_local_dev@127.0.0.1:4832/fir'

const PROVISORIA = 'pinheiro-balde-sete-azul'
const NOVA = 'quatro-pedras-no-caminho'
const SENHA_DA_FIRME = 'montanha-de-vidro-aberta'

let app: NestFastifyApplication
let migrate: pg.Client
let clinica: string
let perfil: string
let idProvisoria: string
const codigo = `senha-${Date.now()}`

const entrar = (usuario: string, senha: string) =>
  request(app.getHttpServer()).post('/v1/entrar').send({ clinica: codigo, usuario, senha })

const cookieDe = (r: { headers: Record<string, string> }): string[] => {
  const v = r.headers['set-cookie'] as unknown
  return Array.isArray(v) ? (v as string[]) : typeof v === 'string' ? [v] : []
}

const sessaoProvisoria = async (): Promise<string[]> =>
  cookieDe(await entrar('ana.nova', PROVISORIA).expect(200))

beforeAll(async () => {
  migrate = new pg.Client({ connectionString: URL_MIG })
  await migrate.connect()
  await declararAtorSistema(migrate)

  clinica = (
    await migrate.query<{ id: string }>(
      `INSERT INTO clinicas (codigo, nome) VALUES ($1, 'Clínica da Senha') RETURNING id`,
      [codigo],
    )
  ).rows[0]!.id
  perfil = (
    await migrate.query<{ id: string }>(
      `INSERT INTO perfis (clinica_id, chave, nome, perms)
       VALUES ($1, 'pf_rec', 'Recepção', ARRAY['jornada','receber']) RETURNING id`,
      [clinica],
    )
  ).rows[0]!.id

  // A pessoa com senha FIRME — o caminho da troca voluntária.
  await migrate.query(
    `INSERT INTO pessoas (clinica_id, nome, usuario, senha_hash, perfil_id)
     VALUES ($1, 'Helena Prado', 'helena', $2, $3)`,
    [clinica, await hashDeSenha(SENHA_DA_FIRME), perfil],
  )

  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile()
  app = mod.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
  await registrarCookie(app)
  await app.init()
  await app.getHttpAdapter().getInstance().ready()
})

afterAll(async () => {
  await apagarClinicaDeTeste(migrate, clinica)
  await migrate.end()
  await app.close()
})

/**
 * A pessoa de provisória nasce de novo a cada teste: quase todo teste daqui
 * a consome (trocar a senha é, por construção, irreversível para ela), e um
 * teste que dependesse do estado deixado pelo anterior passaria a depender da
 * ordem de execução.
 */
beforeEach(async () => {
  await migrate.query('DELETE FROM sessoes WHERE clinica_id = $1', [clinica])
  await migrate.query(
    `DELETE FROM pessoas WHERE clinica_id = $1 AND usuario = 'ana.nova'`,
    [clinica],
  )
  idProvisoria = (
    await migrate.query<{ id: string }>(
      `INSERT INTO pessoas (clinica_id, nome, usuario, senha_hash, perfil_id,
                            senha_provisoria, senha_provisoria_expira_em)
       VALUES ($1, 'Ana Silva', 'ana.nova', $2, $3, true, now() + interval '72 hours')
       RETURNING id`,
      [clinica, await hashDeSenha(PROVISORIA), perfil],
    )
  ).rows[0]!.id
})

describe('a trava da senha provisória', () => {
  it('com senha provisória, toda rota de negócio responde 409 SENHA_PROVISORIA', async () => {
    const s = await sessaoProvisoria()
    for (const rota of ['/v1/hoje', '/v1/tarefas', '/v1/pacientes', '/v1/auditoria']) {
      const r = await request(app.getHttpServer()).get(rota).set('Cookie', s)
      expect(r.status, rota).toBe(409)
      expect(r.body.codigo, rota).toBe('SENHA_PROVISORIA')
    }
  })

  it('as TRÊS rotas de saída continuam abertas — senão a pessoa fica presa', async () => {
    const s = await sessaoProvisoria()
    await request(app.getHttpServer()).get('/v1/eu').set('Cookie', s).expect(200)
    await request(app.getHttpServer())
      .post('/v1/eu/senha')
      .set('Cookie', s)
      .send({ atual: PROVISORIA, nova: NOVA })
      .expect(204)
    // `sair` por último: ele revoga a sessão que as outras duas usam.
    const s2 = cookieDe(await entrar('ana.nova', NOVA).expect(200))
    await request(app.getHttpServer()).post('/v1/sair').set('Cookie', s2).expect(204)
  })

  it('`GET /v1/eu` diz à tela que a senha é provisória', async () => {
    // É por aqui que a tela sabe para onde mandar a pessoa. O SERVIDOR impõe
    // por guard; este booleano é conveniência, e nunca a trava.
    const s = await sessaoProvisoria()
    const eu = await request(app.getHttpServer()).get('/v1/eu').set('Cookie', s).expect(200)
    expect(eu.body.usuario.senhaProvisoria).toBe(true)
  })

  it('quem NÃO tem provisória atravessa as rotas de negócio normalmente', async () => {
    // A outra metade da trava: ela não pode prender quem já trocou.
    const s = cookieDe(await entrar('helena', SENHA_DA_FIRME).expect(200))
    await request(app.getHttpServer()).get('/v1/hoje').set('Cookie', s).expect(200)
  })
})

describe('POST /v1/eu/senha', () => {
  it('trocar limpa a provisória, o prazo, e revoga as OUTRAS sessões', async () => {
    const antiga = await sessaoProvisoria()
    const atual = await sessaoProvisoria()
    await request(app.getHttpServer())
      .post('/v1/eu/senha')
      .set('Cookie', atual)
      .send({ atual: PROVISORIA, nova: NOVA })
      .expect(204)

    await request(app.getHttpServer()).get('/v1/eu').set('Cookie', antiga).expect(401)
    await request(app.getHttpServer()).get('/v1/eu').set('Cookie', atual).expect(200)

    const p = await migrate.query<{ senha_provisoria: boolean; senha_provisoria_expira_em: null }>(
      'SELECT senha_provisoria, senha_provisoria_expira_em FROM pessoas WHERE id = $1',
      [idProvisoria],
    )
    expect(p.rows[0]).toEqual({ senha_provisoria: false, senha_provisoria_expira_em: null })
  })

  it('a nova senha passa pela regra, com a mensagem que diz o que corrigir', async () => {
    const s = await sessaoProvisoria()
    const r = await request(app.getHttpServer())
      .post('/v1/eu/senha')
      .set('Cookie', s)
      .send({ atual: PROVISORIA, nova: 'anasilva-2026' })
    expect(r.status).toBe(422)
    expect(r.body.message).toMatch(/nome da clínica, o seu nome nem o seu usuário/)
  })

  it('a regra recusa ANTES de a senha virar hash — e recusa pelo contexto da clínica', async () => {
    const s = await sessaoProvisoria()
    for (const fraca of ['curta', 'clinica-da-senha-1', 'pedra1234lua']) {
      const r = await request(app.getHttpServer())
        .post('/v1/eu/senha')
        .set('Cookie', s)
        .send({ atual: PROVISORIA, nova: fraca })
      expect(r.status, fraca).toBe(422)
    }
  })

  it('o contexto da regra vem do SERVIDOR, não do corpo', async () => {
    // Um contexto vindo do cliente seria um contexto VAZIO escolhido pelo
    // cliente, e a regra de bloqueio por contexto deixaria de existir. O
    // contrato é `.strict()`: o campo não é ignorado em silêncio, é recusado.
    const s = await sessaoProvisoria()
    const r = await request(app.getHttpServer())
      .post('/v1/eu/senha')
      .set('Cookie', s)
      .send({ atual: PROVISORIA, nova: 'anasilva-2026', contexto: [] })
    expect(r.status).toBe(400)
    // E a senha continua sendo a provisória.
    await entrar('ana.nova', PROVISORIA).expect(200)
  })

  it('trocar exige a senha ATUAL, inclusive quando ela é a provisória', async () => {
    const s = await sessaoProvisoria()
    const r = await request(app.getHttpServer())
      .post('/v1/eu/senha')
      .set('Cookie', s)
      .send({ atual: 'chute-errado-aqui', nova: NOVA })
    expect(r.status).toBe(403)
    await entrar('ana.nova', PROVISORIA).expect(200)
  })

  it('a nova senha não aparece na trilha — só o FATO da troca', async () => {
    const s = await sessaoProvisoria()
    await request(app.getHttpServer())
      .post('/v1/eu/senha')
      .set('Cookie', s)
      .send({ atual: PROVISORIA, nova: NOVA })
      .expect(204)

    const t = await migrate.query<{ para: Record<string, unknown>; ator_id: string }>(
      `SELECT para, ator_id FROM auditoria
        WHERE clinica_id = $1 AND entidade = 'pessoas' AND acao = 'alterou'
        ORDER BY id DESC LIMIT 1`,
      [clinica],
    )
    expect(JSON.stringify(t.rows[0]!.para)).not.toContain(NOVA)
    // A CHAVE fica; o valor não. A trilha registra que o segredo mudou,
    // nunca qual era.
    expect(t.rows[0]!.para['senha_hash']).toBe('[oculto]')
    // E quem trocou foi a própria pessoa, não o sistema.
    expect(t.rows[0]!.ator_id).toBe(idProvisoria)
  })

  it('a senha nova e a atual não aparecem na resposta', async () => {
    const s = await sessaoProvisoria()
    const r = await request(app.getHttpServer())
      .post('/v1/eu/senha')
      .set('Cookie', s)
      .send({ atual: PROVISORIA, nova: NOVA })
    expect(JSON.stringify(r.body)).not.toContain(NOVA)
    expect(JSON.stringify(r.body)).not.toContain(PROVISORIA)
  })

  it('quem tem senha firme também pode trocar — a rota não é só do primeiro acesso', async () => {
    const s = cookieDe(await entrar('helena', SENHA_DA_FIRME).expect(200))
    const outra = 'janela-aberta-com-vento'
    await request(app.getHttpServer())
      .post('/v1/eu/senha')
      .set('Cookie', s)
      .send({ atual: SENHA_DA_FIRME, nova: outra })
      .expect(204)
    await entrar('helena', outra).expect(200)
    // E volta, para não deixar a fixture diferente de como a encontrou.
    const s2 = cookieDe(await entrar('helena', outra).expect(200))
    await request(app.getHttpServer())
      .post('/v1/eu/senha')
      .set('Cookie', s2)
      .send({ atual: outra, nova: SENHA_DA_FIRME })
      .expect(204)
  })
})
