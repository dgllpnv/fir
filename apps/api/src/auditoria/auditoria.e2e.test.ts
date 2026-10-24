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
let outraClinica: string
let juliana: string
let helena: string
let idsDaOutraClinica: string[] = []
const codigo = `aud-${Date.now()}`

/**
 * O registro sintético que prova a redação dentro de `de`/`para`.
 *
 * Nenhuma tabela tem coluna de dinheiro hoje — `salario` chega no épico 7 e
 * `valor_aberto` no 4. Escrever este teste só quando elas existirem seria
 * escrever um teste para passar: a rota que as entrega existe AGORA, e o
 * primeiro `ALTER TABLE pessoas ADD COLUMN salario` não deve ser a primeira
 * vez que alguém descobre se a trilha redige.
 */
const SINTETICO = 'registro-sintetico-de-rh'

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

  await migrate.query(
    `INSERT INTO auditoria (clinica_id, ator_tipo, ator_id, acao, entidade, entidade_id, de, para)
     VALUES ($1, 'sistema', NULL, 'alterou', 'pessoas', $2, $3, $4)`,
    [
      clinica,
      SINTETICO,
      JSON.stringify({ salario: 350_000 }),
      JSON.stringify({ salario: 450_000, valor_aberto: '900', nome: 'Juliana' }),
    ],
  )

  // A SEGUNDA CLÍNICA, com trilha própria e ids conhecidos. Sem ela, "o
  // admin lê só a própria clínica" passaria num banco onde não existe outra
  // clínica para vazar — isto é, provaria nada.
  outraClinica = (
    await migrate.query<{ id: string }>(
      `INSERT INTO clinicas (codigo, nome) VALUES ($1, 'Clínica Vizinha') RETURNING id`,
      [`${codigo}-vizinha`],
    )
  ).rows[0]!.id
  await migrate.query(
    `INSERT INTO perfis (clinica_id, chave, nome, perms)
     VALUES ($1, 'pf_rec', 'Recepção', ARRAY['jornada'])`,
    [outraClinica],
  )
  idsDaOutraClinica = (
    await migrate.query<{ id: string }>(
      'SELECT id::text FROM auditoria WHERE clinica_id = $1',
      [outraClinica],
    )
  ).rows.map((x) => x.id)
  expect(idsDaOutraClinica.length).toBeGreaterThan(0)

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
  await apagarClinicaDeTeste(migrate, outraClinica)
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

/**
 * A ROTA MAIS PERIGOSA DO SISTEMA.
 *
 * A trilha guarda `de`/`para` de toda escrita: hoje nome e e-mail em claro;
 * no épico 7, salário; no 6, dose e lote por paciente. Um `GET` sem controle
 * entrega, de uma vez, tudo o que as regras 17 e 18 protegem em todas as
 * outras rotas — e entrega com a aparência inofensiva de "log".
 */
describe('GET /v1/auditoria', () => {
  const trilha = (cookie: string[], query = '') =>
    request(app.getHttpServer()).get(`/v1/auditoria${query}`).set('Cookie', cookie)

  it('quem não tem "config" não lê a trilha', async () => {
    const cookie = await cookieDe('juliana@aud.local')
    await trilha(cookie).expect(403)
  })

  it('o admin lê, e só a própria clínica', async () => {
    const cookie = await cookieDe('helena@aud.local')
    const r = await trilha(cookie, '?limite=200').expect(200)

    expect(r.body.itens.length).toBeGreaterThan(0)
    expect(r.body.itens.every((i: { clinicaId: string }) => i.clinicaId === clinica)).toBe(true)
    // E a prova NEGATIVA, que é a que importa: existe trilha de OUTRA clínica
    // no mesmo banco, com id conhecido, e nenhuma linha dela atravessou.
    const ids = new Set(r.body.itens.map((i: { id: string }) => i.id))
    for (const id of idsDaOutraClinica) expect(ids.has(id)).toBe(false)
  })

  it('sem "pessoas.gerir", de/para não entregam salário — e nem valor_aberto', async () => {
    const semRh = await cookieDe('sandra@aud.local')
    const r = await trilha(semRh, `?entidade=pessoas&entidadeId=${SINTETICO}`).expect(200)

    expect(r.body.itens).toHaveLength(1)
    const item = r.body.itens[0]
    // A chave fica, o valor some: a forma da resposta não muda com a
    // permissão. Mesma regra do `RedacaoInterceptor`.
    expect(item.para.salario).toBe(null)
    expect(item.de.salario).toBe(null)
    // `de`/`para` carregam NOME DE COLUNA do Postgres — `valor_aberto`, não
    // `valorAberto`. É a única saída da API onde isso acontece, e é onde a
    // redação por nome de campo erraria em silêncio.
    expect(item.para.valor_aberto).toBe(null)
    // O que não é dinheiro continua inteiro: a trilha é dado, e o admin da
    // clínica tem direito de ler o que aconteceu.
    expect(item.para.nome).toBe('Juliana')
  })

  it('com "pessoas.gerir", o mesmo registro entrega o salário', async () => {
    const cookie = await cookieDe('helena@aud.local')
    const r = await trilha(cookie, `?entidade=pessoas&entidadeId=${SINTETICO}`).expect(200)
    expect(r.body.itens).toHaveLength(1)
    expect(r.body.itens[0].para.salario).toBe(450_000)
    expect(r.body.itens[0].para.valor_aberto).toBe('900')
  })

  it('a paginação é por (em, id): linha nova não empurra nem repete item', async () => {
    const cookie = await cookieDe('helena@aud.local')

    const p1 = await trilha(cookie, '?limite=3').expect(200)
    expect(p1.body.itens).toHaveLength(3)
    expect(p1.body.proxima).toBeTypeOf('string')

    // A diferença entre cursor e OFFSET, tornada visível: entre uma página e
    // a seguinte nasce uma linha MAIS NOVA que a primeira página. Com
    // `OFFSET 3`, a janela inteira desliza e o terceiro item da página 1
    // reaparece na página 2. Com `(em, id) < cursor`, a página 2 continua de
    // onde a 1 parou, aconteça o que acontecer acima dela.
    await trilha(cookie, '?limite=1').expect(200)

    const p2 = await trilha(cookie, `?limite=3&antesDe=${encodeURIComponent(p1.body.proxima)}`)
      .expect(200)

    const ids1 = p1.body.itens.map((i: { id: string }) => i.id)
    const ids2 = p2.body.itens.map((i: { id: string }) => i.id)
    expect(ids2.some((id: string) => ids1.includes(id))).toBe(false)
    // E a ordem é a que o índice promete: do mais recente para trás.
    const todos = [...ids1, ...ids2].map(BigInt)
    for (let i = 1; i < todos.length; i++) expect(todos[i]! < todos[i - 1]!).toBe(true)
  })

  it('ler a trilha fica NA trilha — quem lê o prontuário de todo mundo também é alguém', async () => {
    const cookie = await cookieDe('helena@aud.local')
    const desde = await ultimoIdDaTrilha()

    await trilha(cookie, '?limite=1').expect(200)

    const acessos = (await trilhaDepoisDe(desde)).filter((l) => l.acao === 'acessou')
    expect(acessos).toHaveLength(1)
    expect(acessos[0]!.entidade).toBe('auditoria')
    expect(acessos[0]!.entidade_id).toBe('(lista)')
    expect(acessos[0]!.ator_id).toBe(helena)
  })
})
