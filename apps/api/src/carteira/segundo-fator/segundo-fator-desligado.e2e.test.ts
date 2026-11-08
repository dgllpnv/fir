import { decodificarBase32, passoDoInstante } from '@fir/domain'
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify'
import { Test } from '@nestjs/testing'
import { randomBytes } from 'node:crypto'
import pg from 'pg'
import request from 'supertest'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { AppModule } from '../../app.module'
import { LimitePorOrigem } from '../../autenticacao/limite-por-origem'
import { hashDeSenha } from '../../autenticacao/senha'
import { declararAtorSistema } from '../../banco/limpeza-de-teste'
import { registrarCookie } from '../../main'
import { LIMITE_DA_CARTEIRA } from '../limite-da-carteira'
import { CHAVE_SEGUNDO_FATOR_LIGADO } from './ligado'
import { CODIGO_SEGUNDO_FATOR_DA_CARTEIRA } from './segundo-fator.guard'
import { hotp } from './totp'

/**
 * O SEGUNDO FATOR DESLIGADO (D-23 item 3, ADR 0023), ponta a ponta contra o
 * Postgres real: com `SEGUNDO_FATOR_CARTEIRA_LIGADO` desligada — o padrão —
 * a senha sozinha abre a sessão inteira, INCLUSIVE para a conta que já tem
 * TOTP ativo (as contas de teste de produção), e as rotas de cadastro não
 * existem.
 *
 * A conta "com TOTP" é cadastrada pelo caminho de verdade, com a chave
 * ligada só durante o cadastro: o servidor lê a chave a cada requisição.
 */
const URL_MIG =
  process.env['DATABASE_URL_MIGRATE'] ?? 'postgresql://fir_migrate:fir_local_dev@127.0.0.1:4832/fir'

const SENHA = 'lampada-azul-na-varanda'
const sufixo = randomBytes(4).toString('hex')
const SESSAO = '__Host-fir-carteira'
const DESAFIO = '__Host-fir-carteira-desafio'

let app: NestFastifyApplication
let migrate: pg.Client
const criados: string[] = []

const ligar = () => {
  process.env[CHAVE_SEGUNDO_FATOR_LIGADO] = 'true'
}
const desligar = () => {
  process.env[CHAVE_SEGUNDO_FATOR_LIGADO] = 'false'
}

const http = () => request(app.getHttpServer())
const cookieChamado = (r: { headers: Record<string, string> }, nome: string): string | null => {
  const v = r.headers['set-cookie'] as unknown
  const lista = Array.isArray(v) ? (v as string[]) : typeof v === 'string' ? [v] : []
  return (
    lista.map((c) => c.split(';')[0]!).find((c) => c.startsWith(`${nome}=`) && c.length > nome.length + 1) ?? null
  )
}

const criarUsuario = async (usuario: string): Promise<string> => {
  const r = await migrate.query<{ id: string }>(
    `INSERT INTO usuarios_gestao (usuario, nome, senha_hash, escopo, grupo_id)
     VALUES ($1, 'Gestora Sem Segundo Fator', $2, 'geral', NULL) RETURNING id`,
    [usuario, await hashDeSenha(SENHA)],
  )
  criados.push(r.rows[0]!.id)
  return r.rows[0]!.id
}

const entrar = (usuario: string) => http().post('/v1/carteira/entrar').send({ usuario, senha: SENHA })

/** Cadastra o TOTP pelo caminho real, com a chave ligada só aqui dentro. */
const cadastrarTotp = async (usuario: string): Promise<string> => {
  ligar()
  try {
    const sessao = cookieChamado(await entrar(usuario).expect(200), SESSAO)!
    const c = await http().post('/v1/carteira/eu/segundo-fator/cadastro').set('Cookie', sessao).send({ senha: SENHA }).expect(200)
    const segredo = c.body.segredo as string
    const codigo = hotp(Buffer.from(decodificarBase32(segredo)!), passoDoInstante(new Date()))
    await http().post('/v1/carteira/eu/segundo-fator/confirmar').set('Cookie', sessao).send({ codigo }).expect(200)
    return segredo
  } finally {
    desligar()
  }
}

beforeAll(async () => {
  desligar()
  migrate = new pg.Client({ connectionString: URL_MIG })
  await migrate.connect()
  await declararAtorSistema(migrate)

  const mod = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(LIMITE_DA_CARTEIRA)
    .useValue(new LimitePorOrigem(5000, 15 * 60 * 1000))
    .compile()
  app = mod.createNestApplication<NestFastifyApplication>(new FastifyAdapter(), { logger: false })
  await registrarCookie(app)
  await app.init()
  await app.getHttpAdapter().getInstance().ready()
})

afterEach(() => desligar())

afterAll(async () => {
  await declararAtorSistema(migrate)
  const identificadores = criados.map((id) => `usuario_gestao:${id}`)
  await migrate.query(`DELETE FROM tentativas_de_carteira WHERE identificador LIKE $1 OR identificador = ANY($2)`, [
    `%.${sufixo}`,
    identificadores,
  ])
  await migrate.query('DELETE FROM codigos_de_recuperacao_da_carteira WHERE usuario_gestao_id = ANY($1)', [criados])
  await migrate.query('DELETE FROM desafios_de_carteira WHERE usuario_gestao_id = ANY($1)', [criados])
  await migrate.query('DELETE FROM sessoes_de_carteira WHERE usuario_gestao_id = ANY($1)', [criados])
  await migrate.query('DELETE FROM segundo_fator_da_carteira WHERE usuario_gestao_id = ANY($1)', [criados])
  await migrate.query('DELETE FROM usuarios_gestao WHERE id = ANY($1)', [criados])
  await migrate.end()
  await app.close()
})

describe('segundo fator DESLIGADO (o padrão, ADR 0023)', () => {
  it('conta sem TOTP: a senha abre a sessão inteira, e o `eu` não pede cadastro', async () => {
    const usuario = `semtotp.${sufixo}`
    await criarUsuario(usuario)

    const r = await entrar(usuario).expect(200)
    expect(r.body.segundoFatorExigido).toBeUndefined()
    expect(r.body.segundoFator).toEqual({ ativo: false, exigido: false })
    expect(cookieChamado(r, DESAFIO)).toBeNull()
    const sessao = cookieChamado(r, SESSAO)!
    expect(sessao).not.toBeNull()

    // Sem o 409 do segundo fator: a carteira e a troca voluntária de senha.
    await http().get('/v1/carteira/clientes').set('Cookie', sessao).expect(200)
    const eu = await http().get('/v1/carteira/eu').set('Cookie', sessao).expect(200)
    expect(eu.body.segundoFator).toEqual({ ativo: false, exigido: false })
  })

  it('conta COM TOTP ativo: a senha sozinha abre a sessão — nenhum desafio, nenhum código', async () => {
    const usuario = `comtotp.${sufixo}`
    const id = await criarUsuario(usuario)
    await cadastrarTotp(usuario)
    const ativo = await migrate.query<{ a: boolean }>(
      'SELECT ativado_em IS NOT NULL AS a FROM segundo_fator_da_carteira WHERE usuario_gestao_id = $1',
      [id],
    )
    expect(ativo.rows[0]?.a).toBe(true)

    const r = await entrar(usuario).expect(200)
    expect(r.body).not.toHaveProperty('segundoFatorExigido')
    expect(r.body.segundoFator).toEqual({ ativo: true, exigido: false })
    expect(cookieChamado(r, DESAFIO)).toBeNull()
    const sessao = cookieChamado(r, SESSAO)!
    await http().get('/v1/carteira/clientes').set('Cookie', sessao).expect(200)

    const eu = await http().get('/v1/carteira/eu').set('Cookie', sessao).expect(200)
    expect(eu.body.segundoFator).toEqual({ ativo: true, exigido: false })

    // Nenhum desafio nasceu no banco por este login.
    const desafios = await migrate.query<{ n: string }>(
      'SELECT count(*) AS n FROM desafios_de_carteira WHERE usuario_gestao_id = $1',
      [id],
    )
    expect(Number(desafios.rows[0]!.n)).toBe(0)
  })

  it('não há segunda etapa: o corpo do código é 400 e não abre sessão', async () => {
    const r = await http().post('/v1/carteira/entrar').send({ codigo: '123456' }).expect(400)
    expect(cookieChamado(r, SESSAO)).toBeNull()
  })

  it('as rotas de cadastro respondem 404, mesmo com sessão válida', async () => {
    const usuario = `cad404.${sufixo}`
    await criarUsuario(usuario)
    const sessao = cookieChamado(await entrar(usuario).expect(200), SESSAO)!

    await http().get('/v1/carteira/eu/segundo-fator').set('Cookie', sessao).expect(404)
    await http().post('/v1/carteira/eu/segundo-fator/cadastro').set('Cookie', sessao).send({ senha: SENHA }).expect(404)
    await http().post('/v1/carteira/eu/segundo-fator/confirmar').set('Cookie', sessao).send({ codigo: '123456' }).expect(404)
    await http()
      .post('/v1/carteira/eu/segundo-fator/codigos')
      .set('Cookie', sessao)
      .send({ senha: SENHA, codigo: '123456' })
      .expect(404)
  })

  it('religar devolve a ADR 0022: desafio no login, e a sessão aberta só com a senha fica presa', async () => {
    const usuario = `religa.${sufixo}`
    await criarUsuario(usuario)
    await cadastrarTotp(usuario)
    const soComSenha = cookieChamado(await entrar(usuario).expect(200), SESSAO)!

    ligar()
    const r = await entrar(usuario).expect(200)
    expect(r.body).toEqual({ segundoFatorExigido: true })
    expect(cookieChamado(r, SESSAO)).toBeNull()
    expect(cookieChamado(r, DESAFIO)).not.toBeNull()

    const presa = await http().get('/v1/carteira/clientes').set('Cookie', soComSenha).expect(409)
    expect(presa.body.codigo).toBe(CODIGO_SEGUNDO_FATOR_DA_CARTEIRA)
    await http().get('/v1/carteira/eu/segundo-fator').set('Cookie', soComSenha).expect(200)
  })
})
