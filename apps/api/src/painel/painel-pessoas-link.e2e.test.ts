import { mascararEmail } from '@fir/domain'
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
 * O LINK PELO PAINEL (spec acesso-por-email, fluxo 7): com o envio ligado, o
 * operador manda à pessoa o link de redefinição — ou reenvia o convite — e
 * **nunca vê a senha**. A provisória (`/senha`) continua como saída para quem
 * não tem e-mail; ela não é testada aqui, e não muda.
 *
 * As regras são as MESMAS da rota da administradora (`enviarPelaAdmin`): só o
 * e-mail CONFIRMADO recebe redefinição (appsec 4), o convite só para quem não
 * criou a senha, o anterior morre, 5 envios por hora por pessoa-alvo (appsec
 * 12) — um orçamento só, somando a administradora e o operador —, e 503 com o
 * envio desligado. O que muda é o pool e o ator: o operador age sobre qualquer
 * pessoa, inclusive a administradora (D-10), e a trilha assina como operador.
 */

const URL_MIG =
  process.env['DATABASE_URL_MIGRATE'] ?? 'postgresql://fir_migrate:fir_local_dev@127.0.0.1:4832/fir'
const URL_PUBLICA = 'https://fir.teste'
const SENHA = 'senha-de-teste-longa'
const SENHA_NOVA = 'uma frase nova e bem comprida'
const SENHA_OP = 'quatro-pedras-no-caminho'
const sufixo = randomBytes(4).toString('hex')
const USUARIO_OP = `link.${sufixo}`
const codigoA = `ppl-a-${sufixo}`
const codigoB = `ppl-b-${sufixo}`

const correio = new CorreioCapturador()
/** Mutável de propósito: o serviço lê `envioLigado` a cada chamada, e o teste do 503 o desliga. */
const envio: { urlPublica: string | null; correio: CorreioCapturador | null } = {
  urlPublica: URL_PUBLICA,
  correio,
}
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
const enviar = (finalidade: 'convite' | 'redefinicao', pessoa: string, cookie = painel, clinica = clinicaA) =>
  srv().post(`/v1/superadmin/clinicas/${clinica}/pessoas/${pessoa}/${finalidade}`).set('Cookie', cookie)
const para = (email: string) => correio.mensagens.filter((m) => m.para === email)
const ultimoToken = (email: string): string => {
  const m = para(email).at(-1)
  const t = m === undefined ? null : /#t=([A-Za-z0-9_-]{43})/.exec(m.texto)
  if (t === null || t === undefined) throw new Error(`nenhum link para ${email}`)
  return t[1]!
}
const assentar = () => app.get(AcessoPorEmailService).ocioso()

async function pessoa(
  clinica: string,
  usuario: string,
  o: { admin?: boolean; email?: string; pendente?: string; convidada?: boolean; ativo?: boolean } = {},
) {
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
    `INSERT INTO pessoas (clinica_id, nome, usuario, senha_hash, admin, perfil_id, email, email_confirmado_em,
                          email_pendente, aguardando_primeira_senha, ativo, desativada_em)
     VALUES ($1, $2, $3, $4, $5, $6, $7, CASE WHEN $7::text IS NULL THEN NULL ELSE now() END, $8, $9, $10,
             CASE WHEN $10 THEN NULL ELSE now() END)
     RETURNING id`,
    [
      clinica,
      `${usuario[0]!.toUpperCase()}${usuario.slice(1)} Souza`,
      usuario,
      await hashDeSenha(SENHA),
      o.admin === true,
      perfil,
      o.email ?? null,
      o.pendente ?? null,
      o.convidada === true,
      o.ativo ?? true,
    ],
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
  await pessoa(clinicaA, 'paula', { email: 'paula@sol.com' })
  await pessoa(clinicaA, 'juliana', { pendente: 'juliana@sol.com' })
  await pessoa(clinicaA, 'sem')
  await pessoa(clinicaA, 'nina', { pendente: 'nina@sol.com', convidada: true })
  await pessoa(clinicaA, 'dora', { email: 'dora@sol.com', ativo: false })
  await pessoa(clinicaA, 'teto', { email: 'teto@sol.com' })
  await pessoa(clinicaB, 'lua', { admin: true, email: 'lua@lua.com' })

  operador = (
    await migrate.query<{ id: string }>(
      `INSERT INTO operadores (usuario, nome, senha_hash) VALUES ($1, 'Dono', $2) RETURNING id`,
      [USUARIO_OP, await hashDeSenha(SENHA_OP)],
    )
  ).rows[0]!.id

  const mod = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(ENVIO)
    .useValue(envio)
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

describe('POST /v1/superadmin/clinicas/:id/pessoas/:id/redefinicao', () => {
  it('quem não é operador não alcança a rota: sem sessão e com a sessão da administradora, 404', async () => {
    await enviar('redefinicao', ids['paula']!, '').expect(404)
    const daClinica = pares(cookies(await entrar('helena').expect(200)))
    await enviar('redefinicao', ids['paula']!, daClinica).expect(404)
    await enviar('convite', ids['nina']!, daClinica).expect(404)
    expect(para('paula@sol.com')).toEqual([])
    expect(para('nina@sol.com')).toEqual([])
  })

  it('e-mail confirmado: 202 com o endereço MASCARADO, a senha nunca aparece, e o link troca a senha', async () => {
    const r = await enviar('redefinicao', ids['paula']!).expect(202)
    expect(r.body).toEqual({ enviadoPara: mascararEmail('paula@sol.com') })
    expect(JSON.stringify(r.body)).not.toMatch(/senha/i)
    expect(para('paula@sol.com').map((m) => m.tipo)).toEqual(['redefinicao'])

    // Até o link ser usado, a senha de antes continua valendo: o operador não
    // trocou nada, só mandou o link.
    await entrar('paula').expect(200)
    await srv()
      .post('/v1/link-de-acesso/usar')
      .send({ token: ultimoToken('paula@sol.com'), senha: SENHA_NOVA })
      .expect(204)
    await entrar('paula').expect(401)
    await entrar('paula', SENHA_NOVA).expect(200)

    // O evento é o da administradora, sem pessoa que assine (o operador não é
    // pessoa da clínica); a trilha do link assina como OPERADOR, pela trigger.
    const ev = await migrate.query<{ evento: string; por_pessoa_id: string | null }>(
      'SELECT evento, por_pessoa_id FROM eventos_de_acesso WHERE pessoa_id = $1 ORDER BY em',
      [ids['paula']],
    )
    expect(ev.rows.map((e) => e.evento)).toEqual(['redefinicao_enviada_pela_admin', 'senha_redefinida_pelo_link'])
    expect(ev.rows[0]!.por_pessoa_id).toBeNull()
    const trilha = await migrate.query<{ ator_tipo: string; ator_id: string }>(
      `SELECT ator_tipo, ator_id FROM auditoria
        WHERE clinica_id = $1 AND entidade = 'links_de_acesso' AND acao = 'criou'
          AND para->>'pessoa_id' = $2 ORDER BY id LIMIT 1`,
      [clinicaA, ids['paula']],
    )
    expect(trilha.rows[0]).toEqual({ ator_tipo: 'operador', ator_id: operador })
  })

  it('a ADMINISTRADORA também recebe pelo painel (o operador age sobre qualquer pessoa, D-10)', async () => {
    await enviar('redefinicao', ids['helena']!).expect(202)
    expect(para('helena@sol.com').map((m) => m.tipo)).toEqual(['redefinicao'])
  })

  it('mandar de novo invalida o link anterior', async () => {
    const antes = para('helena@sol.com').length
    await enviar('redefinicao', ids['helena']!).expect(202)
    expect(para('helena@sol.com')).toHaveLength(antes + 1)
    const antigo = para('helena@sol.com').at(-2)!
    const t = /#t=([A-Za-z0-9_-]{43})/.exec(antigo.texto)![1]!
    await srv().post('/v1/link-de-acesso/usar').send({ token: t, senha: SENHA_NOVA }).expect(410)
    await entrar('helena').expect(200)
  })

  it('só o e-mail CONFIRMADO recebe (appsec 4): pendente ou sem e-mail é 409, e nada sai', async () => {
    const r = await enviar('redefinicao', ids['juliana']!).expect(409)
    expect(r.body.message).toMatch(/senha provisória/)
    await enviar('redefinicao', ids['sem']!).expect(409)
    expect(para('juliana@sol.com')).toEqual([])
    const links = await migrate.query('SELECT 1 FROM links_de_acesso WHERE pessoa_id = ANY($1)', [
      [ids['juliana'], ids['sem']],
    ])
    expect(links.rowCount).toBe(0)
  })

  it('desativada: 409, e nada sai', async () => {
    await enviar('redefinicao', ids['dora']!).expect(409)
    expect(para('dora@sol.com')).toEqual([])
  })

  it('isolamento: a pessoa da outra clínica pela rota desta é 404, e nada sai', async () => {
    await enviar('redefinicao', ids['lua']!).expect(404)
    expect(para('lua@lua.com')).toEqual([])
    const links = await migrate.query('SELECT 1 FROM links_de_acesso WHERE pessoa_id = $1', [ids['lua']])
    expect(links.rowCount).toBe(0)
  })

  it('id malformado é 404', async () => {
    await enviar('redefinicao', 'nao-e-uuid').expect(404)
  })
})

describe('POST /v1/superadmin/clinicas/:id/pessoas/:id/convite', () => {
  it('convidada: 202, vai para o pendente, e o convite anterior morre', async () => {
    await enviar('convite', ids['nina']!).expect(202)
    const primeiro = ultimoToken('nina@sol.com')
    const r = await enviar('convite', ids['nina']!).expect(202)
    expect(r.body).toEqual({ enviadoPara: mascararEmail('nina@sol.com') })
    expect(para('nina@sol.com').map((m) => m.tipo)).toEqual(['convite', 'convite'])

    await srv().post('/v1/link-de-acesso/usar').send({ token: primeiro, senha: SENHA_NOVA }).expect(410)
    await srv()
      .post('/v1/link-de-acesso/usar')
      .send({ token: ultimoToken('nina@sol.com'), senha: SENHA_NOVA })
      .expect(204)
    await entrar('nina@sol.com', SENHA_NOVA).expect(200)
  })

  it('quem já criou a senha: 409 (o caminho é o link de redefinição)', async () => {
    const r = await enviar('convite', ids['paula']!).expect(409)
    expect(r.body.message).toMatch(/redefinir/)
  })
})

describe('a lista do painel diz o que o operador pode mandar', () => {
  it('situacaoDoAcesso: convidada com convite vivo é convite_pendente; quem tem senha é ativo', async () => {
    await migrate.query('UPDATE pessoas SET aguardando_primeira_senha = true WHERE id = $1', [ids['sem']])
    const r = await srv().get(`/v1/superadmin/clinicas/${clinicaA}/pessoas`).set('Cookie', painel).expect(200)
    const por = (id: string) => (r.body.itens as { id: string; situacaoDoAcesso: string }[]).find((p) => p.id === id)
    expect(por(ids['helena']!)?.situacaoDoAcesso).toBe('ativo')
    // Convidada sem convite vivo: vencido (é o selo da clínica, pela mesma função).
    expect(por(ids['sem']!)?.situacaoDoAcesso).toBe('convite_vencido')
    await migrate.query('UPDATE pessoas SET aguardando_primeira_senha = false WHERE id = $1', [ids['sem']])
  })
})

describe('o teto e o envio desligado', () => {
  it('5 envios por hora por pessoa-alvo, SOMANDO a administradora e o operador: o sexto é 429', async () => {
    const admin = pares(cookies(await entrar('helena').expect(200)))
    for (let i = 0; i < 3; i++) {
      await srv().post(`/v1/pessoas/${ids['teto']}/redefinicao`).set('Cookie', admin).expect(202)
    }
    await enviar('redefinicao', ids['teto']!).expect(202)
    await enviar('redefinicao', ids['teto']!).expect(202)
    await enviar('redefinicao', ids['teto']!).expect(429)
    expect(para('teto@sol.com')).toHaveLength(5)
  })

  it('desligado: 503, nunca um 202 que não mandou nada', async () => {
    envio.urlPublica = null
    try {
      const antes = correio.mensagens.length
      await enviar('redefinicao', ids['helena']!).expect(503)
      await enviar('convite', ids['nina']!).expect(503)
      expect(correio.mensagens).toHaveLength(antes)
    } finally {
      envio.urlPublica = URL_PUBLICA
    }
  })
})
