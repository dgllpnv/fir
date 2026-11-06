import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify'
import { Test } from '@nestjs/testing'
import { randomBytes } from 'node:crypto'
import pg from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AppModule } from '../app.module'
import { hashDeSenha } from '../autenticacao/senha'
import {
  apagarClinicaDeTeste,
  apagarOperadorDeTeste,
  declararAtorSistema,
} from '../banco/limpeza-de-teste'
import { registrarCookie } from '../main'

/**
 * As escritas da carteira que SÓ o `Operador` faz — `/v1/superadmin/grupos`,
 * `/v1/superadmin/clientes-carteira`, `/v1/superadmin/usuarios-gestao`. ADR
 * 0011: nunca convite interno, nunca um `Usuário de Gestão` cria outro.
 */
const URL_MIG =
  process.env['DATABASE_URL_MIGRATE'] ?? 'postgresql://fir_migrate:fir_local_dev@127.0.0.1:4832/fir'

const SENHA_OP = 'quatro-pedras-no-caminho'
const PROVISORIA = /^[a-z]+(-[a-z]+){3}$/

let app: NestFastifyApplication
let migrate: pg.Client
let operador: string
let painel: string
let clinica: string

const sufixo = randomBytes(4).toString('hex')
const USUARIO_OP = `dono.${sufixo}`
const criadosGrupos: string[] = []
const criadosUsuarios: string[] = []

const cookies = (r: { headers: Record<string, string> }): string[] => {
  const v = r.headers['set-cookie'] as unknown
  return Array.isArray(v) ? (v as string[]) : typeof v === 'string' ? [v] : []
}
const paresDe = (lista: string[]): string => lista.map((c) => c.split(';')[0]!).join('; ')

const http = () => request(app.getHttpServer())

beforeAll(async () => {
  migrate = new pg.Client({ connectionString: URL_MIG })
  await migrate.connect()
  await declararAtorSistema(migrate)

  operador = (
    await migrate.query<{ id: string }>(
      `INSERT INTO operadores (usuario, nome, senha_hash)
       VALUES ($1, 'Dono', $2) RETURNING id`,
      [USUARIO_OP, await hashDeSenha(SENHA_OP)],
    )
  ).rows[0]!.id

  clinica = (
    await migrate.query<{ id: string }>(
      `INSERT INTO clinicas (codigo, nome) VALUES ($1, 'Clínica da Carteira E2E') RETURNING id`,
      [`painelcarteira-${sufixo}`],
    )
  ).rows[0]!.id

  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile()
  app = mod.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
  await registrarCookie(app)
  await app.init()
  await app.getHttpAdapter().getInstance().ready()

  painel = paresDe(
    cookies(
      await http()
        .post('/v1/superadmin/entrar')
        .send({ usuario: USUARIO_OP, senha: SENHA_OP })
        .expect(200),
    ),
  )
})

afterAll(async () => {
  await declararAtorSistema(migrate)
  if (criadosUsuarios.length > 0) {
    await migrate.query('DELETE FROM sessoes_de_carteira WHERE usuario_gestao_id = ANY($1)', [
      criadosUsuarios,
    ])
    await migrate.query('DELETE FROM usuarios_gestao WHERE id = ANY($1)', [criadosUsuarios])
  }
  await migrate.query('DELETE FROM clientes_carteira WHERE clinica_id = $1', [clinica])
  if (criadosGrupos.length > 0) {
    await migrate.query('DELETE FROM grupos WHERE id = ANY($1)', [criadosGrupos])
  }
  await apagarClinicaDeTeste(migrate, clinica)
  await migrate.query('DELETE FROM tentativas_de_operador WHERE identificador = $1', [USUARIO_OP])
  await apagarOperadorDeTeste(migrate, operador)
  await migrate.end()
  await app.close()
})

describe('POST /v1/superadmin/grupos', () => {
  it('cria o grupo, e ele aparece na listagem', async () => {
    const r = await http()
      .post('/v1/superadmin/grupos')
      .set('Cookie', painel)
      .send({ nome: `Grupo E2E ${sufixo}` })
      .expect(201)
    criadosGrupos.push(r.body.grupo.id)
    expect(r.body.grupo.ativo).toBe(true)

    const l = await http().get('/v1/superadmin/grupos').set('Cookie', painel).expect(200)
    expect(l.body.grupos.map((g: { id: string }) => g.id)).toContain(r.body.grupo.id)
  })

  it('a criação do grupo fica registrada em auditoria_do_painel', async () => {
    const r = await http()
      .post('/v1/superadmin/grupos')
      .set('Cookie', painel)
      .send({ nome: `Grupo Trilha ${sufixo}` })
      .expect(201)
    criadosGrupos.push(r.body.grupo.id)

    const t = await migrate.query(
      `SELECT acao FROM auditoria_do_painel WHERE entidade = 'grupos' AND entidade_id = $1`,
      [r.body.grupo.id],
    )
    expect(t.rows[0]).toMatchObject({ acao: 'criou' })
  })

  it('nome vazio é 400, e nada é criado', async () => {
    await http().post('/v1/superadmin/grupos').set('Cookie', painel).send({ nome: '' }).expect(400)
  })

  it('sem sessão de painel, 404', async () => {
    await http()
      .post('/v1/superadmin/grupos')
      .send({ nome: `Grupo Sem Sessao ${sufixo}` })
      .expect(404)
  })
})

describe('POST /v1/superadmin/clientes-carteira', () => {
  it('vincula a clínica ao grupo, criando o Cliente Firmare', async () => {
    const g = await http()
      .post('/v1/superadmin/grupos')
      .set('Cookie', painel)
      .send({ nome: `Grupo Vinculo ${sufixo}` })
      .expect(201)
    criadosGrupos.push(g.body.grupo.id)

    const r = await http()
      .post('/v1/superadmin/clientes-carteira')
      .set('Cookie', painel)
      .send({ grupoId: g.body.grupo.id, clinicaId: clinica, nome: 'Clínica E2E', produto: 'Gestão' })
      .expect(201)
    expect(r.body.cliente).toMatchObject({
      grupoId: g.body.grupo.id,
      clinicaId: clinica,
      status: 'onboarding',
    })

    // A clínica vinculada VÊ, em sua própria trilha, que foi registrada.
    const t = await migrate.query(
      `SELECT ator_tipo FROM auditoria WHERE clinica_id = $1 AND entidade = 'clientes_carteira'`,
      [clinica],
    )
    expect(t.rows.length).toBeGreaterThan(0)
    expect(t.rows[0]!.ator_tipo).toBe('operador')
  })

  it('clínica que já tem Cliente Firmare é 409', async () => {
    const g = await http()
      .post('/v1/superadmin/grupos')
      .set('Cookie', painel)
      .send({ nome: `Grupo Duplicado ${sufixo}` })
      .expect(201)
    criadosGrupos.push(g.body.grupo.id)

    // A clínica principal deste arquivo já foi vinculada no teste anterior.
    await http()
      .post('/v1/superadmin/clientes-carteira')
      .set('Cookie', painel)
      .send({ grupoId: g.body.grupo.id, clinicaId: clinica, nome: 'Outra Vez', produto: 'Gestão' })
      .expect(409)
  })

  it('grupo ou clínica inexistente é 404', async () => {
    const g = await http()
      .post('/v1/superadmin/grupos')
      .set('Cookie', painel)
      .send({ nome: `Grupo Fantasma ${sufixo}` })
      .expect(201)
    criadosGrupos.push(g.body.grupo.id)

    await http()
      .post('/v1/superadmin/clientes-carteira')
      .set('Cookie', painel)
      .send({
        grupoId: g.body.grupo.id,
        clinicaId: '00000000-0000-0000-0000-000000000000',
        nome: 'Fantasma',
        produto: 'Gestão',
      })
      .expect(404)
  })
})

describe('POST /v1/superadmin/usuarios-gestao', () => {
  it('cria usuário de escopo geral, com provisória, e ela autentica na carteira', async () => {
    const usuario = `gestora.geral.${sufixo}`
    const r = await http()
      .post('/v1/superadmin/usuarios-gestao')
      .set('Cookie', painel)
      .send({ usuario, nome: 'Gestora Geral', escopo: 'geral', grupoId: null })
      .expect(201)
    criadosUsuarios.push(r.body.usuarioDeGestao.id)

    expect(r.body.usuarioDeGestao.escopo).toBe('geral')
    expect(r.body.usuarioDeGestao.grupoId).toBeNull()
    expect(r.body.senhaProvisoria).toMatch(PROVISORIA)

    const entrada = await http()
      .post('/v1/carteira/entrar')
      .send({ usuario, senha: r.body.senhaProvisoria })
      .expect(200)
    expect(entrada.body.usuarioDeGestao.id).toBe(r.body.usuarioDeGestao.id)
  })

  it('escopo "grupo" sem grupoId é 400 — invariante de cadastro', async () => {
    await http()
      .post('/v1/superadmin/usuarios-gestao')
      .set('Cookie', painel)
      .send({ usuario: `gestora.sem.grupo.${sufixo}`, nome: 'X', escopo: 'grupo', grupoId: null })
      .expect(400)
  })

  it('usuário repetido é 409', async () => {
    const usuario = `gestora.dup.${sufixo}`
    const r1 = await http()
      .post('/v1/superadmin/usuarios-gestao')
      .set('Cookie', painel)
      .send({ usuario, nome: 'Primeira', escopo: 'geral', grupoId: null })
      .expect(201)
    criadosUsuarios.push(r1.body.usuarioDeGestao.id)

    await http()
      .post('/v1/superadmin/usuarios-gestao')
      .set('Cookie', painel)
      .send({ usuario, nome: 'Segunda', escopo: 'geral', grupoId: null })
      .expect(409)
  })

  it('a provisória não aparece em trilha nenhuma', async () => {
    const r = await http()
      .post('/v1/superadmin/usuarios-gestao')
      .set('Cookie', painel)
      .send({ usuario: `gestora.trilha.${sufixo}`, nome: 'Trilha', escopo: 'geral', grupoId: null })
      .expect(201)
    criadosUsuarios.push(r.body.usuarioDeGestao.id)
    const prov = r.body.senhaProvisoria as string

    const doPainel = await migrate.query('SELECT de, para FROM auditoria_do_painel')
    expect(JSON.stringify(doPainel.rows)).not.toContain(prov)
  })
})

describe('GET /v1/superadmin/usuarios-gestao', () => {
  it('lista os usuários de gestão, sem o hash de senha', async () => {
    const usuario = `gestora.lista.${sufixo}`
    const criado = await http()
      .post('/v1/superadmin/usuarios-gestao')
      .set('Cookie', painel)
      .send({ usuario, nome: 'Gestora da Lista', escopo: 'geral', grupoId: null })
      .expect(201)
    criadosUsuarios.push(criado.body.usuarioDeGestao.id)

    const r = await http().get('/v1/superadmin/usuarios-gestao').set('Cookie', painel).expect(200)
    expect(JSON.stringify(r.body)).not.toMatch(/\$argon2/)

    const linha = r.body.usuariosDeGestao.find(
      (u: { id: string }) => u.id === criado.body.usuarioDeGestao.id,
    )
    expect(linha).toMatchObject({
      usuario,
      nome: 'Gestora da Lista',
      escopo: 'geral',
      grupoId: null,
      ativo: true,
      aguardandoPrimeiroAcesso: true,
    })
  })

  /**
   * **O TESTE DO MÍNIMO**, mesma forma de `painel-clinicas.e2e.test.ts` — esta
   * lista administra CONTAS, não mede atividade da carteira. Nenhuma contagem
   * de `Cliente Firmare`, de login nem de ação entra aqui.
   */
  it('devolve o MÍNIMO: nenhuma chave além das seis, nenhum sinal de atividade', async () => {
    const r = await http().get('/v1/superadmin/usuarios-gestao').set('Cookie', painel).expect(200)
    const itens = r.body.usuariosDeGestao as Record<string, unknown>[]
    expect(itens.length, 'lista vazia — o teste não verificou nada').toBeGreaterThan(0)

    const CHAVES_PERMITIDAS = [
      'id',
      'usuario',
      'nome',
      'escopo',
      'grupoId',
      'ativo',
      'aguardandoPrimeiroAcesso',
    ]
    const aMais = [...new Set(itens.flatMap((u) => Object.keys(u)))].filter(
      (k) => !CHAVES_PERMITIDAS.includes(k),
    )
    expect(aMais, `chave(s) a mais na lista de usuários de gestão: ${aMais.join(', ')}`).toEqual([])

    const SINAIS_DE_ATIVIDADE = /clientes|clinicas|logins?|ultimo|acesso.?em|criad[oa]/i
    expect(JSON.stringify(itens)).not.toMatch(SINAIS_DE_ATIVIDADE)
  })

  it('sem sessão de painel, 404', async () => {
    await http().get('/v1/superadmin/usuarios-gestao').expect(404)
  })
})

describe('PATCH /v1/superadmin/grupos/:id', () => {
  it('edita nome e estado, e a trilha registra de → para', async () => {
    const criado = await http()
      .post('/v1/superadmin/grupos')
      .set('Cookie', painel)
      .send({ nome: `Grupo Antes ${sufixo}` })
      .expect(201)
    criadosGrupos.push(criado.body.grupo.id)

    const r = await http()
      .patch(`/v1/superadmin/grupos/${criado.body.grupo.id}`)
      .set('Cookie', painel)
      .send({ nome: `Grupo Depois ${sufixo}`, ativo: false })
      .expect(200)
    expect(r.body.grupo).toMatchObject({ nome: `Grupo Depois ${sufixo}`, ativo: false })

    const l = await http().get('/v1/superadmin/grupos').set('Cookie', painel).expect(200)
    const linha = l.body.grupos.find((g: { id: string }) => g.id === criado.body.grupo.id)
    expect(linha).toMatchObject({ nome: `Grupo Depois ${sufixo}`, ativo: false })

    const t = await migrate.query(
      `SELECT acao, de, para FROM auditoria_do_painel WHERE entidade = 'grupos' AND entidade_id = $1 ORDER BY id DESC LIMIT 1`,
      [criado.body.grupo.id],
    )
    expect(t.rows[0]).toMatchObject({ acao: 'alterou' })
    expect(t.rows[0].de).toMatchObject({ nome: `Grupo Antes ${sufixo}` })
    expect(t.rows[0].para).toMatchObject({ nome: `Grupo Depois ${sufixo}` })
  })

  it('grupo inexistente é 404, e campo a mais é 400', async () => {
    await http()
      .patch('/v1/superadmin/grupos/00000000-0000-4000-8000-000000000000')
      .set('Cookie', painel)
      .send({ nome: 'Não Existe', ativo: true })
      .expect(404)

    const criado = await http()
      .post('/v1/superadmin/grupos')
      .set('Cookie', painel)
      .send({ nome: `Grupo Strict ${sufixo}` })
      .expect(201)
    criadosGrupos.push(criado.body.grupo.id)
    await http()
      .patch(`/v1/superadmin/grupos/${criado.body.grupo.id}`)
      .set('Cookie', painel)
      .send({ nome: 'X', ativo: true, codigo: 'a-mais' })
      .expect(400)
  })

  it('sem sessão de painel, 404', async () => {
    await http()
      .patch('/v1/superadmin/grupos/00000000-0000-4000-8000-000000000000')
      .send({ nome: 'X', ativo: true })
      .expect(404)
  })
})

describe('PATCH /v1/superadmin/usuarios-gestao/:id', () => {
  it('edita nome, escopo, grupo e estado — sem tocar o usuário (login)', async () => {
    const g = await http()
      .post('/v1/superadmin/grupos')
      .set('Cookie', painel)
      .send({ nome: `Grupo Para Edição ${sufixo}` })
      .expect(201)
    criadosGrupos.push(g.body.grupo.id)

    const usuario = `gestora.edicao.${sufixo}`
    const criado = await http()
      .post('/v1/superadmin/usuarios-gestao')
      .set('Cookie', painel)
      .send({ usuario, nome: 'Antes Da Edição', escopo: 'geral', grupoId: null })
      .expect(201)
    criadosUsuarios.push(criado.body.usuarioDeGestao.id)

    const r = await http()
      .patch(`/v1/superadmin/usuarios-gestao/${criado.body.usuarioDeGestao.id}`)
      .set('Cookie', painel)
      .send({ nome: 'Depois Da Edição', escopo: 'grupo', grupoId: g.body.grupo.id, ativo: false })
      .expect(200)
    expect(r.body.usuarioDeGestao).toMatchObject({
      usuario,
      nome: 'Depois Da Edição',
      escopo: 'grupo',
      grupoId: g.body.grupo.id,
      ativo: false,
    })
  })

  it('escopo "grupo" sem grupoId é 400, igual à criação', async () => {
    const criado = await http()
      .post('/v1/superadmin/usuarios-gestao')
      .set('Cookie', painel)
      .send({ usuario: `gestora.invariante.${sufixo}`, nome: 'X', escopo: 'geral', grupoId: null })
      .expect(201)
    criadosUsuarios.push(criado.body.usuarioDeGestao.id)

    await http()
      .patch(`/v1/superadmin/usuarios-gestao/${criado.body.usuarioDeGestao.id}`)
      .set('Cookie', painel)
      .send({ nome: 'X', escopo: 'grupo', grupoId: null, ativo: true })
      .expect(400)
  })

  it('usuário de gestão inexistente é 404', async () => {
    await http()
      .patch('/v1/superadmin/usuarios-gestao/00000000-0000-4000-8000-000000000000')
      .set('Cookie', painel)
      .send({ nome: 'X', escopo: 'geral', grupoId: null, ativo: true })
      .expect(404)
  })

  it('`usuario` no corpo é 400 — o login não se edita por aqui', async () => {
    const criado = await http()
      .post('/v1/superadmin/usuarios-gestao')
      .set('Cookie', painel)
      .send({ usuario: `gestora.strict.${sufixo}`, nome: 'X', escopo: 'geral', grupoId: null })
      .expect(201)
    criadosUsuarios.push(criado.body.usuarioDeGestao.id)

    await http()
      .patch(`/v1/superadmin/usuarios-gestao/${criado.body.usuarioDeGestao.id}`)
      .set('Cookie', painel)
      .send({ usuario: 'tentando-mudar', nome: 'X', escopo: 'geral', grupoId: null, ativo: true })
      .expect(400)
  })
})
