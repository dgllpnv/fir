import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify'
import { Test } from '@nestjs/testing'
import { randomBytes } from 'node:crypto'
import pg from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AcessoPorEmailService } from '../acesso/acesso-por-email.service'
import { CorreioCapturador, ENVIO } from '../acesso/correio'
import { AppModule } from '../app.module'
import { LimitePorOrigem } from '../autenticacao/limite-por-origem'
import { hashDeSenha } from '../autenticacao/senha'
import { apagarClinicaDeTeste, apagarOperadorDeTeste, declararAtorSistema } from '../banco/limpeza-de-teste'
import { registrarCookie } from '../main'

/**
 * O E-MAIL PELO PAINEL (Entrega 3, ticket da revisão `acesso-por-email-revisao.md`):
 * o operador cadastra ou troca o e-mail de uma pessoa — inclusive da
 * administradora — e o endereço novo entra PENDENTE, como no PATCH da
 * clínica: só autentica e só recebe redefinição depois de confirmado pelo
 * link (appsec 2, 4). Sobre o Postgres real, pelo HTTP.
 */

const URL_MIG =
  process.env['DATABASE_URL_MIGRATE'] ?? 'postgresql://fir_migrate:fir_local_dev@127.0.0.1:4832/fir'
const URL_PUBLICA = 'https://fir.teste'
const SENHA = 'senha-de-teste-longa'
const SENHA_OP = 'quatro-pedras-no-caminho'
const sufixo = randomBytes(4).toString('hex')
const USUARIO_OP = `email.${sufixo}`
const codigoA = `pem-a-${sufixo}`
const codigoB = `pem-b-${sufixo}`

const correio = new CorreioCapturador()
let app: NestFastifyApplication
let migrate: pg.Client
let operador: string
let painel: string
let clinicaA: string
let clinicaB: string
const ids: Record<string, string> = {}

const srv = () => request(app.getHttpServer())
const cookies = (r: { headers: Record<string, string> }): string[] => {
  const v = r.headers['set-cookie'] as unknown
  return Array.isArray(v) ? (v as string[]) : typeof v === 'string' ? [v] : []
}
const pares = (lista: string[]) => lista.map((c) => c.split(';')[0]!).join('; ')
const entrar = (usuario: string, senha = SENHA, clinica = codigoA) =>
  srv().post('/v1/entrar').send({ clinica, usuario, senha })
const editar = (clinica: string, pessoa: string, corpo: unknown, cookie = painel) =>
  srv().patch(`/v1/superadmin/clinicas/${clinica}/pessoas/${pessoa}`).set('Cookie', cookie).send(corpo as object)
const para = (email: string) => correio.mensagens.filter((m) => m.para === email)
const ultimoToken = (email: string): string => {
  const m = para(email).at(-1)
  const t = m === undefined ? null : /#t=([A-Za-z0-9_-]{43})/.exec(m.texto)
  if (t === null || t === undefined) throw new Error(`nenhum link para ${email}`)
  return t[1]!
}
const assentar = () => app.get(AcessoPorEmailService).ocioso()
const linhaDe = async (id: string) =>
  (
    await migrate.query<{ email: string | null; email_pendente: string | null }>(
      'SELECT email, email_pendente FROM pessoas WHERE id = $1',
      [id],
    )
  ).rows[0]!

async function pessoa(clinica: string, usuario: string, o: { admin?: boolean; email?: string } = {}) {
  const perfil =
    o.admin === true
      ? null
      : (
          await migrate.query<{ id: string }>(
            `INSERT INTO perfis (clinica_id, chave, nome, perms)
             VALUES ($1, $2, $3, ARRAY['jornada']) RETURNING id`,
            [clinica, `pf_${usuario}`, `Recepção ${usuario}`],
          )
        ).rows[0]!.id
  const r = await migrate.query<{ id: string }>(
    `INSERT INTO pessoas (clinica_id, nome, usuario, senha_hash, admin, perfil_id, email, email_confirmado_em)
     VALUES ($1, $2, $3, $4, $5, $6, $7, CASE WHEN $7::text IS NULL THEN NULL ELSE now() END)
     RETURNING id`,
    [clinica, `${usuario[0]!.toUpperCase()}${usuario.slice(1)} Souza`, usuario, await hashDeSenha(SENHA), o.admin === true, perfil, o.email ?? null],
  )
  ids[usuario] = r.rows[0]!.id
}

beforeAll(async () => {
  migrate = new pg.Client({ connectionString: URL_MIG })
  await migrate.connect()
  await declararAtorSistema(migrate)
  for (const codigo of [codigoA, codigoB]) {
    const c = (
      await migrate.query<{ id: string }>('INSERT INTO clinicas (codigo, nome) VALUES ($1, $2) RETURNING id', [
        codigo,
        codigo === codigoA ? 'Clínica Sol' : 'Clínica Lua',
      ])
    ).rows[0]!.id
    if (codigo === codigoA) clinicaA = c
    else clinicaB = c
  }
  await pessoa(clinicaA, 'helena', { admin: true, email: 'helena@sol.com' })
  await pessoa(clinicaA, 'juliana')
  await pessoa(clinicaA, 'paula', { email: 'paula@sol.com' })
  await pessoa(clinicaB, 'lua', { admin: true, email: 'lua@lua.com' })

  operador = (
    await migrate.query<{ id: string }>(
      `INSERT INTO operadores (usuario, nome, senha_hash) VALUES ($1, 'Dono', $2) RETURNING id`,
      [USUARIO_OP, await hashDeSenha(SENHA_OP)],
    )
  ).rows[0]!.id

  const mod = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(ENVIO)
    .useValue({ urlPublica: URL_PUBLICA, correio })
    .overrideProvider(LimitePorOrigem)
    .useValue(new LimitePorOrigem(10_000, 3_600_000))
    .compile()
  app = mod.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
  await registrarCookie(app)
  await app.init()
  await app.getHttpAdapter().getInstance().ready()

  painel = pares(
    cookies(await srv().post('/v1/superadmin/entrar').send({ usuario: USUARIO_OP, senha: SENHA_OP }).expect(200)),
  )
})

afterAll(async () => {
  if (app !== undefined) await assentar()
  await declararAtorSistema(migrate)
  for (const id of [clinicaA, clinicaB]) if (id !== undefined) await apagarClinicaDeTeste(migrate, id)
  await migrate.query('DELETE FROM tentativas_de_operador WHERE identificador = $1', [USUARIO_OP])
  if (operador !== undefined) await apagarOperadorDeTeste(migrate, operador)
  await migrate.end()
  if (app !== undefined) await app.close()
})


describe('appsec 0111: abuso do e-mail pelo painel', () => {
  it('CRLF, Unicode, homoglifo, lista e tamanho são 400, e nada sai', async () => {
    const ruins = [
      'a@b.com\r\nBcc: x@mal.example',
      'a@b.com\nx@mal.example',
      'jülia@sol.com',
      'hеlena@sol.com', // e cirílico
      'helena@sоl.com', // o cirílico
      'a@b.com,x@mal.example',
      'a@b.com;x@mal.example',
      `${'a'.repeat(250)}@sol.com`,
      ' @sol.com',
    ]
    for (const email of ruins) await editar(clinicaA, ids['juliana']!, { email }).expect(400)
    expect(await linhaDe(ids['juliana']!)).toEqual({ email: null, email_pendente: null })
    expect(correio.mensagens.filter((m) => /mal\.example|ü|е|о/.test(m.para))).toEqual([])
  })

  it('id em MAIÚSCULAS chega à mesma pessoa e a regra é a mesma (pendente, link para o novo, sem token na resposta)', async () => {
    const r = await editar(clinicaA, ids['paula']!.toUpperCase(), { email: 'paula.nova@sol.com' }).expect(200)
    expect(r.body).toMatchObject({ id: ids['paula'], email: 'paula@sol.com', emailPendente: 'paula.nova@sol.com' })
    const token = ultimoToken('paula.nova@sol.com')
    const corpo = JSON.stringify(r.body)
    expect(corpo).not.toContain(token)
    expect(corpo).not.toMatch(/[0-9a-f]{64}/)
    expect(Object.keys(r.body).sort()).toEqual(
      ['admin', 'ativo', 'email', 'emailPendente', 'envioDeEmail', 'funcao', 'id', 'nome', 'perfilId', 'precisaTrocarSenha', 'situacaoDoAcesso', 'usuario'].sort(),
    )
    await entrar('paula.nova@sol.com').expect(401)
    await srv().post('/v1/esqueci-senha').send({ clinica: codigoA, email: 'paula.nova@sol.com' }).expect(202)
    await assentar()
    expect(para('paula.nova@sol.com').map((m) => m.tipo)).toEqual(['confirmacao_de_email'])
  })

  it('o pendente não pode ser o confirmado de OUTRA pessoa da clínica: o link dá email-em-uso e nada muda', async () => {
    await editar(clinicaA, ids['juliana']!, { email: 'helena@sol.com' }).expect(200)
    const t = ultimoToken('helena@sol.com')
    const u = await srv().post('/v1/link-de-acesso/usar').send({ token: t })
    expect(u.status).not.toBe(204)
    expect((await linhaDe(ids['helena']!)).email).toBe('helena@sol.com')
    expect((await linhaDe(ids['juliana']!)).email).toBeNull()
  })

  it('pessoa inativa: pendente gravado, NENHUM link emitido', async () => {
    await migrate.query('UPDATE pessoas SET ativo = false, desativada_em = now() WHERE id = $1', [ids['juliana']])
    const antes = correio.mensagens.length
    await editar(clinicaA, ids['juliana']!, { email: 'juliana.inativa@sol.com' }).expect(200)
    expect(correio.mensagens.length).toBe(antes)
    const vivos = await migrate.query(
      'SELECT 1 FROM links_de_acesso WHERE pessoa_id = $1 AND usado_em IS NULL AND invalidado_em IS NULL',
      [ids['juliana']],
    )
    expect(vivos.rowCount).toBe(0)
    await migrate.query('UPDATE pessoas SET ativo = true, desativada_em = NULL WHERE id = $1', [ids['juliana']])
  })

  it('pessoa EXCLUÍDA: 404, nada muda', async () => {
    await migrate.query("UPDATE pessoas SET excluida_em = now(), ativo = false, desativada_em = now() WHERE id = $1", [ids['juliana']])
    await editar(clinicaA, ids['juliana']!, { email: 'juliana.excluida@sol.com' }).expect(404)
    expect(para('juliana.excluida@sol.com')).toEqual([])
  })

  it('M2 (corrigido): a troca pelo operador avisa o endereço antigo NO PEDIDO, e o aviso não leva link', async () => {
    const antes = para('lua@lua.com').length
    await editar(clinicaB, ids['lua']!, { email: 'lua.nova@lua.com' }).expect(200)
    await assentar()
    const novas = para('lua@lua.com').slice(antes)
    expect(novas.map((m) => m.tipo)).toEqual(['troca_de_email_pedida'])
    expect(novas[0]!.texto).not.toMatch(/#t=/)
  })
})
