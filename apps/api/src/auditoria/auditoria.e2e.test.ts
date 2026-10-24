import { Controller, Get, NotFoundException, Param } from '@nestjs/common'
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify'
import { Test } from '@nestjs/testing'
import pg from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AppModule } from '../app.module'
import { hashDeSenha } from '../autenticacao/senha'
import { apagarClinicaDeTeste, declararAtorSistema } from '../banco/limpeza-de-teste'
import { registrarCookie } from '../main'
import { DadoSensivel } from './acesso.decorator'
import { AuditoriaService } from './auditoria.service'

/**
 * A trilha pelo caminho HTTP de verdade: o REGISTRO DE ACESSO (regra 18) e a
 * rota que lê a trilha.
 *
 * Um arquivo para os dois porque a fixture é a mesma e caríssima — uma
 * clínica, dois perfis, três pessoas e um login por persona. Duplicá-la é
 * como a ordem dos `DELETE` de `apagarClinicaDeTeste` fica errada no segundo
 * arquivo.
 */
const URL_MIG =
  process.env['DATABASE_URL_MIGRATE'] ?? 'postgresql://fir_migrate:fir_local_dev@127.0.0.1:4832/fir'

const SENHA = 'senha-de-teste-auditoria'
const INEXISTENTE = '00000000-0000-0000-0000-000000000000'

/**
 * O controlador que só existe aqui.
 *
 * Nenhuma rota de produção entrega dado sensível POR REGISTRO hoje — o épico
 * 2 traz `/v1/pacientes/:id` e o 6 traz dose e lote. Escrever este teste
 * depois dessas rotas existirem seria escrever um teste para passar: o
 * mecanismo precisa estar provado ANTES de a primeira rota depender dele.
 *
 * Fica fora do `AppModule`, então as varreduras transversais (rotas
 * protegidas, acesso marcado) não o enxergam — e não devem.
 */
@Controller('teste-sensivel')
class ControladorSensivel {
  @Get('pessoa/:id')
  @DadoSensivel('pessoas')
  pessoa(@Param('id') id: string): { id: string; nome: string } {
    if (id === INEXISTENTE) throw new NotFoundException('Não encontrei essa pessoa.')
    return { id, nome: 'Juliana' }
  }

  @Get('sem-marca/:id')
  semMarca(@Param('id') id: string): { id: string } {
    return { id }
  }
}

let app: NestFastifyApplication
let migrate: pg.Client
let clinica: string
let juliana: string
let helena: string
const codigo = `aud-${Date.now()}`

type LinhaDeTrilha = {
  id: string
  acao: string
  entidade: string
  entidade_id: string
  ator_tipo: string
  ator_id: string | null
}

const trilhaDepoisDe = async (desde: string): Promise<LinhaDeTrilha[]> => {
  const r = await migrate.query<LinhaDeTrilha>(
    `SELECT id::text, acao, entidade, entidade_id, ator_tipo, ator_id
       FROM auditoria WHERE clinica_id = $1 AND id > $2 ORDER BY id`,
    [clinica, desde],
  )
  return r.rows
}

const ultimoIdDaTrilha = async (): Promise<string> =>
  (
    await migrate.query<{ ultimo: string }>(
      'SELECT coalesce(max(id), 0)::text AS ultimo FROM auditoria WHERE clinica_id = $1',
      [clinica],
    )
  ).rows[0]!.ultimo

const cookieDe = async (email: string): Promise<string[]> => {
  const r = await request(app.getHttpServer())
    .post('/v1/entrar')
    .send({ clinica: codigo, email, senha: SENHA })
    .expect(200)
  const v = r.headers['set-cookie'] as unknown
  return Array.isArray(v) ? (v as string[]) : typeof v === 'string' ? [v] : []
}

beforeAll(async () => {
  migrate = new pg.Client({ connectionString: URL_MIG })
  migrate.on('error', (e) => console.error('[auditoria.e2e] migrate:', e.message))
  await migrate.connect()
  await declararAtorSistema(migrate)

  clinica = (
    await migrate.query<{ id: string }>(
      `INSERT INTO clinicas (codigo, nome) VALUES ($1, 'Clínica Auditoria') RETURNING id`,
      [codigo],
    )
  ).rows[0]!.id

  // `pf_rec` NÃO tem `config`: é a persona que a rota da trilha precisa
  // recusar. `pf_cfg` tem `config` e NÃO tem `valores` nem `pessoas.gerir` —
  // é a combinação que prova que a redação atravessa `de`/`para`.
  const rec = (
    await migrate.query<{ id: string }>(
      `INSERT INTO perfis (clinica_id, chave, nome, perms)
       VALUES ($1, 'pf_rec', 'Recepção', ARRAY['jornada','receber']) RETURNING id`,
      [clinica],
    )
  ).rows[0]!.id
  const cfg = (
    await migrate.query<{ id: string }>(
      `INSERT INTO perfis (clinica_id, chave, nome, perms)
       VALUES ($1, 'pf_cfg', 'Configuração', ARRAY['config']) RETURNING id`,
      [clinica],
    )
  ).rows[0]!.id

  const hash = await hashDeSenha(SENHA)
  juliana = (
    await migrate.query<{ id: string }>(
      `INSERT INTO pessoas (clinica_id, nome, email, senha_hash, perfil_id)
       VALUES ($1, 'Juliana', 'juliana@aud.local', $2, $3) RETURNING id`,
      [clinica, hash, rec],
    )
  ).rows[0]!.id
  helena = (
    await migrate.query<{ id: string }>(
      `INSERT INTO pessoas (clinica_id, nome, email, senha_hash, admin)
       VALUES ($1, 'Helena', 'helena@aud.local', $2, true) RETURNING id`,
      [clinica, hash],
    )
  ).rows[0]!.id
  await migrate.query(
    `INSERT INTO pessoas (clinica_id, nome, email, senha_hash, perfil_id)
     VALUES ($1, 'Sandra', 'sandra@aud.local', $2, $3)`,
    [clinica, hash, cfg],
  )

  const mod = await Test.createTestingModule({
    imports: [AppModule],
    controllers: [ControladorSensivel],
  }).compile()
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

describe('registro de acesso a dado sensível (regra 18)', () => {
  it('abrir a ficha marcada grava "acessou" na trilha, em nome de quem abriu', async () => {
    const cookie = await cookieDe('juliana@aud.local')
    const desde = await ultimoIdDaTrilha()

    await request(app.getHttpServer())
      .get(`/teste-sensivel/pessoa/${juliana}`)
      .set('Cookie', cookie)
      .expect(200)

    const acessos = (await trilhaDepoisDe(desde)).filter((l) => l.acao === 'acessou')
    expect(acessos).toHaveLength(1)
    expect(acessos[0]!.entidade).toBe('pessoas')
    expect(acessos[0]!.entidade_id).toBe(juliana)
    expect(acessos[0]!.ator_tipo).toBe('pessoa')
    // Não `'sistema'`: a pergunta da LGPD é "QUEM olhou", e `sistema` não
    // responde nada.
    expect(acessos[0]!.ator_id).toBe(juliana)
  })

  it('resposta de erro NÃO grava acesso — ninguém viu nada', async () => {
    const cookie = await cookieDe('juliana@aud.local')
    const desde = await ultimoIdDaTrilha()

    await request(app.getHttpServer())
      .get(`/teste-sensivel/pessoa/${INEXISTENTE}`)
      .set('Cookie', cookie)
      .expect(404)

    expect((await trilhaDepoisDe(desde)).filter((l) => l.acao === 'acessou')).toEqual([])
  })

  it('rota NÃO marcada não grava acesso — senão a trilha vira ruído', async () => {
    const cookie = await cookieDe('juliana@aud.local')
    const desde = await ultimoIdDaTrilha()

    await request(app.getHttpServer())
      .get(`/teste-sensivel/sem-marca/${juliana}`)
      .set('Cookie', cookie)
      .expect(200)
    await request(app.getHttpServer()).get('/v1/eu').set('Cookie', cookie).expect(200)

    expect((await trilhaDepoisDe(desde)).filter((l) => l.acao === 'acessou')).toEqual([])
  })

  it('duas aberturas deixam duas linhas: a trilha conta acessos, não registros distintos', async () => {
    const cookie = await cookieDe('helena@aud.local')
    const desde = await ultimoIdDaTrilha()

    await request(app.getHttpServer())
      .get(`/teste-sensivel/pessoa/${juliana}`)
      .set('Cookie', cookie)
      .expect(200)
    await request(app.getHttpServer())
      .get(`/teste-sensivel/pessoa/${juliana}`)
      .set('Cookie', cookie)
      .expect(200)

    const acessos = (await trilhaDepoisDe(desde)).filter((l) => l.acao === 'acessou')
    expect(acessos).toHaveLength(2)
    for (const a of acessos) expect(a.ator_id).toBe(helena)
  })
})

/**
 * FALHA FECHADO, com a trilha quebrada de propósito.
 *
 * É a asserção que distingue "registra" de "tenta registrar". Sem ela, trocar
 * o `concatMap` do interceptor por um `tap` com promessa solta deixaria a
 * suíte inteira verde: as linhas continuariam aparecendo no caminho felizo
 * e, no dia em que o banco recusasse a inserção, o dado sensível sairia com
 * 200 e um `unhandledRejection` no log que ninguém lê.
 */
describe('acesso que não pôde ser registrado não é acesso entregue', () => {
  let appQuebrado: NestFastifyApplication

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [ControladorSensivel],
    })
      .overrideProvider(AuditoriaService)
      .useValue({
        registrarAcesso: () => Promise.reject(new Error('trilha indisponível')),
      })
      .compile()
    appQuebrado = mod.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
    await registrarCookie(appQuebrado)
    await appQuebrado.init()
    await appQuebrado.getHttpAdapter().getInstance().ready()
  })

  afterAll(async () => {
    await appQuebrado.close()
  })

  it('a resposta falha em vez de entregar a ficha sem deixar rastro', async () => {
    const r = await request(appQuebrado.getHttpServer())
      .post('/v1/entrar')
      .send({ clinica: codigo, email: 'juliana@aud.local', senha: SENHA })
      .expect(200)
    const v = r.headers['set-cookie'] as unknown
    const cookie = Array.isArray(v) ? (v as string[]) : [v as string]

    const ficha = await request(appQuebrado.getHttpServer())
      .get(`/teste-sensivel/pessoa/${juliana}`)
      .set('Cookie', cookie)
    expect(ficha.status).toBe(500)
    // E o corpo do erro não leva o dado que a rota ia entregar.
    expect(JSON.stringify(ficha.body)).not.toMatch(/Juliana/)
  })
})
