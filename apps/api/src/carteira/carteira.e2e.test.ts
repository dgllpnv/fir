import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify'
import { Test } from '@nestjs/testing'
import { randomBytes } from 'node:crypto'
import pg from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AppModule } from '../app.module'
import { PISO_DE_RESPOSTA_MS } from '../autenticacao/autenticacao.service'
import { hashDeSenha } from '../autenticacao/senha'
import { apagarClinicaDeTeste, declararAtorSistema } from '../banco/limpeza-de-teste'
import { registrarCookie } from '../main'
import { DURACAO_SESSAO_CARTEIRA_MS } from './carteira.guard'

const URL_MIG =
  process.env['DATABASE_URL_MIGRATE'] ?? 'postgresql://fir_migrate:fir_local_dev@127.0.0.1:4832/fir'

const SENHA = 'quatro-pedras-no-caminho'

let app: NestFastifyApplication
let migrate: pg.Client
let grupo: string
let usuarioDeGestao: string
let usuarioInativo: string

/** Sufixo aleatório — `usuarios_gestao.usuario` é único GLOBALMENTE, mesma razão de `operadores`. */
const sufixo = randomBytes(4).toString('hex')
const USUARIO = `teste.${sufixo}`
const USUARIO_INATIVO = `inativo.${sufixo}`
const NAO_EXISTE = `ninguem.${sufixo}`

const cookies = (r: { headers: Record<string, string> }): string[] => {
  const v = r.headers['set-cookie'] as unknown
  return Array.isArray(v) ? (v as string[]) : typeof v === 'string' ? [v] : []
}
const paresDe = (lista: string[]): string => lista.map((c) => c.split(';')[0]!).join('; ')

const criarUsuarioDeGestao = async (usuario: string, ativo = true): Promise<string> => {
  const r = await migrate.query<{ id: string }>(
    `INSERT INTO usuarios_gestao (usuario, nome, senha_hash, escopo, grupo_id, ativo)
     VALUES ($1, 'Teste Comercial', $2, 'grupo', $3, $4) RETURNING id`,
    [usuario, await hashDeSenha(SENHA), grupo, ativo],
  )
  return r.rows[0]!.id
}

beforeAll(async () => {
  migrate = new pg.Client({ connectionString: URL_MIG })
  await migrate.connect()
  await declararAtorSistema(migrate)

  grupo = (
    await migrate.query<{ id: string }>(
      `INSERT INTO grupos (nome) VALUES ('Grupo de teste e2e') RETURNING id`,
    )
  ).rows[0]!.id
  usuarioDeGestao = await criarUsuarioDeGestao(USUARIO)
  usuarioInativo = await criarUsuarioDeGestao(USUARIO_INATIVO, false)

  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile()
  app = mod.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
  await registrarCookie(app)
  await app.init()
  await app.getHttpAdapter().getInstance().ready()
})

afterAll(async () => {
  await declararAtorSistema(migrate)
  await migrate.query('DELETE FROM tentativas_de_carteira WHERE identificador = ANY($1)', [
    [USUARIO, USUARIO_INATIVO, NAO_EXISTE],
  ])
  await migrate.query('DELETE FROM sessoes_de_carteira WHERE usuario_gestao_id = ANY($1)', [
    [usuarioDeGestao, usuarioInativo],
  ])
  await migrate.query('DELETE FROM usuarios_gestao WHERE id = ANY($1)', [
    [usuarioDeGestao, usuarioInativo],
  ])
  await migrate.query('DELETE FROM grupos WHERE id = $1', [grupo])
  await migrate.end()
  await app.close()
})

const http = () => request(app.getHttpServer())

const entrar = (usuario = USUARIO, senha = SENHA) =>
  http().post('/v1/carteira/entrar').send({ usuario, senha })

describe('POST /v1/carteira/entrar', () => {
  it('entra com usuário e senha do Usuário de Gestão', async () => {
    const r = await entrar().expect(200)
    expect(r.body.usuarioDeGestao).toMatchObject({
      usuario: USUARIO,
      escopo: 'grupo',
      grupoId: grupo,
    })
    expect(cookies(r).join()).toMatch(/__Host-fir-carteira=/)
  })

  it('nunca devolve hash nem prazo interno', async () => {
    const r = await entrar().expect(200)
    expect(JSON.stringify(r.body)).not.toMatch(/\$argon2|senha_hash|expira/i)
  })

  it('o cookie é HttpOnly, Secure, SameSite=Strict e Path=/', async () => {
    const bruto = cookies(await entrar().expect(200)).join(';')
    expect(bruto).toMatch(/HttpOnly/i)
    expect(bruto).toMatch(/Secure/i)
    expect(bruto).toMatch(/SameSite=Strict/i)
    expect(bruto).toMatch(/Path=\//i)
  })

  it('a sessão dura doze horas', async () => {
    const bruto = cookies(await entrar().expect(200)).join(';')
    const m = /Max-Age=(\d+)/i.exec(bruto)
    expect(m?.[1]).toBe(String(DURACAO_SESSAO_CARTEIRA_MS / 1000))
    expect(Number(m?.[1])).toBe(12 * 60 * 60)
  })

  it('senha errada e usuário inexistente dizem a MESMA frase', async () => {
    const a = await entrar(USUARIO, 'chute-errado-aqui').expect(401)
    const b = await entrar(NAO_EXISTE, 'chute-errado-aqui').expect(401)
    expect(a.body.message).toBe(b.body.message)
    expect(a.body.message).toBe('Usuário ou senha incorretos.')
  })

  it('usuário de gestão INATIVO não entra, com a frase de sempre', async () => {
    const r = await entrar(USUARIO_INATIVO, SENHA).expect(401)
    expect(r.body.message).toBe('Usuário ou senha incorretos.')
  })

  it('o piso de tempo vale aqui também', async () => {
    const medir = async (fn: () => Promise<unknown>) => {
      const inicio = performance.now()
      await fn()
      return performance.now() - inicio
    }
    const casos: [string, () => Promise<unknown>][] = [
      ['sucesso', () => entrar().expect(200)],
      ['senha errada', () => entrar(USUARIO, 'chute-errado-aqui').expect(401)],
      ['inexistente', () => entrar(NAO_EXISTE, 'chute-errado-aqui').expect(401)],
    ]
    for (const [nome, fn] of casos) {
      expect(await medir(fn), nome).toBeGreaterThanOrEqual(PISO_DE_RESPOSTA_MS - 5)
    }
  })
})

describe('GET /v1/carteira/eu', () => {
  it('devolve o próprio usuário de gestão com a sessão válida', async () => {
    const sessao = paresDe(cookies(await entrar().expect(200)))
    const r = await http().get('/v1/carteira/eu').set('Cookie', sessao).expect(200)
    expect(r.body.usuarioDeGestao.usuario).toBe(USUARIO)
  })

  it('sem cookie, responde 404 — não 401', async () => {
    await http().get('/v1/carteira/eu').expect(404)
  })
})

describe('P-12: revogação é checada a cada requisição', () => {
  it('desativar o Usuário de Gestão bloqueia a PRÓXIMA requisição — não espera a sessão expirar', async () => {
    const usuario = `revoga.${sufixo}`
    const id = await criarUsuarioDeGestao(usuario)
    try {
      const sessao = paresDe(cookies(await entrar(usuario).expect(200)))
      await http().get('/v1/carteira/eu').set('Cookie', sessao).expect(200)

      await migrate.query('UPDATE usuarios_gestao SET ativo = false WHERE id = $1', [id])

      await http().get('/v1/carteira/eu').set('Cookie', sessao).expect(404)
    } finally {
      await migrate.query('DELETE FROM sessoes_de_carteira WHERE usuario_gestao_id = $1', [id])
      await migrate.query('DELETE FROM usuarios_gestao WHERE id = $1', [id])
    }
  })

  it('POST /v1/carteira/sair revoga a sessão — ela não funciona mais depois', async () => {
    const sessao = paresDe(cookies(await entrar().expect(200)))
    await http().post('/v1/carteira/sair').set('Cookie', sessao).expect(204)
    await http().get('/v1/carteira/eu').set('Cookie', sessao).expect(404)
  })
})

describe('GET /v1/carteira/clientes — P-12, isolamento de DADO, não só identidade', () => {
  let grupoB: string
  let clinicaA: string
  let clinicaB: string
  let usuarioA: string
  let usuarioB: string

  beforeAll(async () => {
    grupoB = (
      await migrate.query<{ id: string }>(`INSERT INTO grupos (nome) VALUES ('Grupo B e2e') RETURNING id`)
    ).rows[0]!.id
    clinicaA = (
      await migrate.query<{ id: string }>(
        `INSERT INTO clinicas (codigo, nome) VALUES ($1, 'Clínica A e2e') RETURNING id`,
        [`cca-${sufixo}`],
      )
    ).rows[0]!.id
    clinicaB = (
      await migrate.query<{ id: string }>(
        `INSERT INTO clinicas (codigo, nome) VALUES ($1, 'Clínica B e2e') RETURNING id`,
        [`ccb-${sufixo}`],
      )
    ).rows[0]!.id
    await migrate.query(
      `INSERT INTO clientes_carteira (grupo_id, clinica_id, nome, produto) VALUES ($1, $2, 'Cliente A e2e', 'Acelerador FIR')`,
      [grupo, clinicaA],
    )
    await migrate.query(
      `INSERT INTO clientes_carteira (grupo_id, clinica_id, nome, produto) VALUES ($1, $2, 'Cliente B e2e', 'Consultoria')`,
      [grupoB, clinicaB],
    )
    usuarioA = await criarUsuarioDeGestao(`clia.${sufixo}`)
    usuarioB = (
      await migrate.query<{ id: string }>(
        `INSERT INTO usuarios_gestao (usuario, nome, senha_hash, escopo, grupo_id)
         VALUES ($1, 'Teste B', $2, 'grupo', $3) RETURNING id`,
        [`clib.${sufixo}`, await hashDeSenha(SENHA), grupoB],
      )
    ).rows[0]!.id
  })

  afterAll(async () => {
    await migrate.query('DELETE FROM clientes_carteira WHERE grupo_id = ANY($1)', [[grupo, grupoB]])
    await migrate.query('DELETE FROM sessoes_de_carteira WHERE usuario_gestao_id = ANY($1)', [
      [usuarioA, usuarioB],
    ])
    await migrate.query('DELETE FROM usuarios_gestao WHERE id = ANY($1)', [[usuarioA, usuarioB]])
    await apagarClinicaDeTeste(migrate, clinicaA)
    await apagarClinicaDeTeste(migrate, clinicaB)
    await migrate.query('DELETE FROM grupos WHERE id = $1', [grupoB])
  })

  it('um Usuário de Gestão do grupo A só vê o Cliente Firmare do grupo A', async () => {
    const sessao = paresDe(cookies(await entrar(`clia.${sufixo}`).expect(200)))
    const r = await http().get('/v1/carteira/clientes').set('Cookie', sessao).expect(200)
    expect(r.body.clientes.map((c: { nome: string }) => c.nome)).toEqual(['Cliente A e2e'])
  })

  it('o do grupo B só vê o do grupo B — não é coincidência de ordem', async () => {
    const sessao = paresDe(cookies(await entrar(`clib.${sufixo}`).expect(200)))
    const r = await http().get('/v1/carteira/clientes').set('Cookie', sessao).expect(200)
    expect(r.body.clientes.map((c: { nome: string }) => c.nome)).toEqual(['Cliente B e2e'])
  })

  it('escopo=geral vê os dois', async () => {
    const usuarioGeral = `geral.${sufixo}`
    await migrate.query(
      `INSERT INTO usuarios_gestao (usuario, nome, senha_hash, escopo, grupo_id)
       VALUES ($1, 'Teste Geral', $2, 'geral', NULL)`,
      [usuarioGeral, await hashDeSenha(SENHA)],
    )
    try {
      // escopo=geral enxerga a tabela INTEIRA, de propósito — inclusive
      // linhas de outros grupos de outro arquivo de teste rodando em
      // paralelo. A prova é que A e B (dois grupos DIFERENTES) aparecem
      // juntos, não que a resposta só contenha estes dois.
      const sessao = paresDe(cookies(await entrar(usuarioGeral).expect(200)))
      const r = await http().get('/v1/carteira/clientes').set('Cookie', sessao).expect(200)
      expect(r.body.clientes.map((c: { nome: string }) => c.nome)).toEqual(
        expect.arrayContaining(['Cliente A e2e', 'Cliente B e2e']),
      )
    } finally {
      await migrate.query(
        'DELETE FROM sessoes_de_carteira WHERE usuario_gestao_id = (SELECT id FROM usuarios_gestao WHERE usuario = $1)',
        [usuarioGeral],
      )
      await migrate.query('DELETE FROM usuarios_gestao WHERE usuario = $1', [usuarioGeral])
    }
  })
})

describe('os espaços de identidade são disjuntos', () => {
  it('a credencial da carteira NÃO entra pelo login do produto', async () => {
    await http().post('/v1/entrar').send({ clinica: 'demo', usuario: USUARIO, senha: SENHA }).expect(401)
  })

  it('o cookie da carteira não abre rota de superadmin', async () => {
    const sessao = paresDe(cookies(await entrar().expect(200)))
    await http().get('/v1/superadmin/eu').set('Cookie', sessao).expect(404)
  })
})
