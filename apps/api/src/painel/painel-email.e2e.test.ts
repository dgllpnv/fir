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
  await pessoa(clinicaA, 'rosa', { email: 'rosa@sol.com' })
  await pessoa(clinicaA, 'bia', { email: 'bia@sol.com' })

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

describe('PATCH /v1/superadmin/clinicas/:id/pessoas/:id { email }', () => {
  it('quem não é operador não alcança a rota: sem sessão e com a sessão da administradora, 404 (o guard do painel não confirma que a rota existe)', async () => {
    await editar(clinicaA, ids['juliana']!, { email: 'x@sol.com' }, '').expect(404)
    const daClinica = pares(cookies(await entrar('helena').expect(200)))
    await editar(clinicaA, ids['juliana']!, { email: 'x@sol.com' }, daClinica).expect(404)
    expect(await linhaDe(ids['juliana']!)).toEqual({ email: null, email_pendente: null })
    expect(para('x@sol.com')).toEqual([])
  })

  it('e-mail inválido é 400, inclusive o de caractere de lista (0103), e nada muda nem sai', async () => {
    for (const email of ['sem-arroba', 'a<x@mal.example>', 'juliana.sol.com<x@mal.example>', 'a"b@evil.com', '']) {
      await editar(clinicaA, ids['juliana']!, { email }).expect(400)
    }
    expect(await linhaDe(ids['juliana']!)).toEqual({ email: null, email_pendente: null })
    expect(correio.mensagens.filter((m) => /mal\.example|evil\.com/.test(m.para))).toEqual([])
  })

  it('cadastrar: entra PENDENTE, não autentica nem recebe redefinição até o link; confirmado, entra', async () => {
    const r = await editar(clinicaA, ids['juliana']!, { email: 'Juliana@Sol.com' }).expect(200)
    expect(r.body).toMatchObject({
      id: ids['juliana'],
      email: null,
      emailPendente: 'juliana@sol.com',
      envioDeEmail: 'enviado',
    })

    await entrar('juliana@sol.com').expect(401)
    await srv().post('/v1/esqueci-senha').send({ clinica: codigoA, email: 'juliana@sol.com' }).expect(202)
    await assentar()
    // Uma mensagem só, a de confirmação: o esqueci-senha do pendente não manda nada.
    expect(para('juliana@sol.com').map((m) => m.tipo)).toEqual(['confirmacao_de_email'])

    await srv().post('/v1/link-de-acesso/usar').send({ token: ultimoToken('juliana@sol.com') }).expect(204)
    expect(await linhaDe(ids['juliana']!)).toEqual({ email: 'juliana@sol.com', email_pendente: null })
    await entrar('juliana@sol.com').expect(200)

    // Evento de acesso e trilha: o cadastro e a confirmação; a escrita do
    // painel assina como OPERADOR, pela trigger.
    const ev = await migrate.query<{ evento: string; por_pessoa_id: string | null }>(
      'SELECT evento, por_pessoa_id FROM eventos_de_acesso WHERE pessoa_id = $1 ORDER BY em',
      [ids['juliana']],
    )
    expect(ev.rows.map((e) => e.evento)).toEqual(['email_cadastrado', 'email_confirmado'])
    expect(ev.rows[0]!.por_pessoa_id).toBeNull()
    const trilha = await migrate.query<{ ator_tipo: string; ator_id: string }>(
      `SELECT ator_tipo, ator_id FROM auditoria
        WHERE clinica_id = $1 AND entidade = 'pessoas' AND entidade_id = $2 AND acao = 'alterou'
          AND para ? 'email_pendente' ORDER BY id LIMIT 1`,
      [clinicaA, ids['juliana']],
    )
    expect(trilha.rows[0]).toEqual({ ator_tipo: 'operador', ator_id: operador })
  })

  it('trocar o da ADMINISTRADORA: o confirmado antigo vale até a confirmação; o link antigo morre', async () => {
    // Um link de redefinição vivo, para o endereço antigo.
    await srv().post('/v1/esqueci-senha').send({ clinica: codigoA, email: 'helena@sol.com' }).expect(202)
    await assentar()
    const antigo = ultimoToken('helena@sol.com')

    const r = await editar(clinicaA, ids['helena']!, { email: 'helena@novo.com' }).expect(200)
    expect(r.body).toMatchObject({ email: 'helena@sol.com', emailPendente: 'helena@novo.com', admin: true })
    // M2: o endereço antigo ouve o PEDIDO na hora, antes de o novo valer.
    await assentar()
    expect(para('helena@sol.com').at(-1)!.tipo).toBe('troca_de_email_pedida')

    await entrar('helena@sol.com').expect(200)
    await entrar('helena@novo.com').expect(401)
    await srv().post('/v1/link-de-acesso/usar').send({ token: antigo, senha: 'uma frase nova e comprida' }).expect(410)

    await srv().post('/v1/link-de-acesso/usar').send({ token: ultimoToken('helena@novo.com') }).expect(204)
    await entrar('helena@novo.com').expect(200)
    await entrar('helena@sol.com').expect(401)
    await assentar()
    // L11: o endereço antigo é avisado da troca.
    expect(para('helena@sol.com').at(-1)!.tipo).toBe('email_trocado')
  })

  it('retirar (null) apaga confirmado e pendente e invalida os links', async () => {
    const r = await editar(clinicaA, ids['paula']!, { email: null }).expect(200)
    expect(r.body).toMatchObject({ email: null, emailPendente: null, envioDeEmail: null })
    await entrar('paula@sol.com').expect(401)
    await entrar('paula').expect(200)
  })

  it('a ficha e a lista do painel mostram o e-mail e o pendente', async () => {
    const f = await srv()
      .get(`/v1/superadmin/clinicas/${clinicaA}/pessoas/${ids['helena']}`)
      .set('Cookie', painel)
      .expect(200)
    expect(f.body).toMatchObject({ email: 'helena@novo.com', emailPendente: null })
  })

  it('isolamento: a pessoa da outra clínica pela rota desta é 404, e ela não muda', async () => {
    await editar(clinicaA, ids['lua']!, { email: 'tomada@mal.com' }).expect(404)
    expect(await linhaDe(ids['lua']!)).toEqual({ email: 'lua@lua.com', email_pendente: null })
    expect(para('tomada@mal.com')).toEqual([])
    const links = await migrate.query('SELECT 1 FROM links_de_acesso WHERE pessoa_id = $1', [ids['lua']])
    expect(links.rowCount).toBe(0)
  })
})

describe('revisão appsec M2: todo caminho que troca o e-mail avisa o antigo no PEDIDO', () => {
  it('o PATCH da clínica (pela administradora) e o /v1/eu/email (pela própria)', async () => {
    const admin = pares(cookies(await entrar('helena@novo.com').expect(200)))
    await srv().patch(`/v1/pessoas/${ids['rosa']}`).set('Cookie', admin).send({ email: 'rosa@novo.com' }).expect(200)
    await assentar()
    expect(para('rosa@sol.com').map((m) => m.tipo)).toEqual(['troca_de_email_pedida'])
    // O antigo continua valendo até a confirmação.
    await entrar('rosa@sol.com').expect(200)

    const bia = pares(cookies(await entrar('bia').expect(200)))
    await srv().post('/v1/eu/email').set('Cookie', bia).send({ email: 'bia@novo.com', senha: SENHA }).expect(202)
    await assentar()
    expect(para('bia@sol.com').map((m) => m.tipo)).toEqual(['troca_de_email_pedida'])
    // Reenviar o MESMO pendente não repete o aviso.
    await srv().post('/v1/eu/email').set('Cookie', bia).send({ email: 'bia@novo.com', senha: SENHA }).expect(202)
    await assentar()
    expect(para('bia@sol.com')).toHaveLength(1)
    // Confirmado, o antigo ouve a troca feita.
    await srv().post('/v1/link-de-acesso/usar').send({ token: ultimoToken('bia@novo.com') }).expect(204)
    await assentar()
    expect(para('bia@sol.com').map((m) => m.tipo)).toEqual(['troca_de_email_pedida', 'email_trocado'])
  })
})
