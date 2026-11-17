import { FRASE_DO_ESQUECI_SENHA } from '@fir/contracts'
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify'
import { Test } from '@nestjs/testing'
import pg from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { AppModule } from '../app.module'
import { PISO_DE_RESPOSTA_MS } from '../autenticacao/autenticacao.service'
import { LimitePorOrigem } from '../autenticacao/limite-por-origem'
import { hashDeSenha } from '../autenticacao/senha'
import { operadorIdDeFonteConfiavel, pessoaIdDeFonteConfiavel } from '../banco/ator'
import { clinicaIdDeFonteConfiavel } from '../banco/clinica-id'
import { apagarClinicaDeTeste, declararAtorSistema } from '../banco/limpeza-de-teste'
import { RELOGIO } from '../comum/relogio'
import { registrarCookie } from '../main'
import { AcessoService } from '../pessoas/acesso.service'
import { CorreioCapturador, ENVIO } from './correio'
import { LIMITE_ESQUECI_POR_ORIGEM } from './limites'

/**
 * ACESSO POR E-MAIL, ponta a ponta, sobre o Postgres real (spec 8; gates
 * appsec 1–20 e LGPD L1–L11). O correio é o capturador: cada mensagem fica na
 * memória, e o token sai do link que ela leva — como sairia da caixa de entrada.
 *
 * Dois apps: um com o envio LIGADO (correio capturador, `URL_PUBLICA` de
 * teste, relógio que avança) e um com o envio DESLIGADO (o ambiente dos e2e).
 */

const URL_MIG =
  process.env['DATABASE_URL_MIGRATE'] ?? 'postgresql://fir_migrate:fir_local_dev@127.0.0.1:4832/fir'
const URL_APP = process.env['DATABASE_URL'] ?? 'postgresql://fir_app:fir_local_dev@127.0.0.1:4832/fir'
const URL_PUBLICA = 'https://fir.teste'
const HORA = 3_600_000

const correio = new CorreioCapturador()
const relogio = { deslocamentoMs: 0, agora: () => new Date(Date.now() + relogio.deslocamentoMs) }

let app: NestFastifyApplication
let appDesligado: NestFastifyApplication
let migrate: pg.Client
let clinicaA: string
let clinicaB: string
let perfilRec: string
let perfilCfg: string
const codigoA = `acesso-a-${Date.now()}`
const codigoB = `acesso-b-${Date.now()}`
const ids: Record<string, string> = {}

const SENHA = 'senha-de-teste-longa'

async function montar(
  ligado: boolean,
  limiteDoEsqueci = new LimitePorOrigem(10_000, HORA),
): Promise<NestFastifyApplication> {
  let b = Test.createTestingModule({ imports: [AppModule] })
  if (ligado) {
    b = b
      .overrideProvider(ENVIO)
      .useValue({ urlPublica: URL_PUBLICA, correio })
      .overrideProvider(RELOGIO)
      .useValue(relogio)
      .overrideProvider(LIMITE_ESQUECI_POR_ORIGEM)
      .useValue(limiteDoEsqueci)
      .overrideProvider(LimitePorOrigem)
      .useValue(new LimitePorOrigem(10_000, HORA))
  }
  const mod = await b.compile()
  const a = mod.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
  await registrarCookie(a)
  await a.init()
  await a.getHttpAdapter().getInstance().ready()
  return a
}

async function pessoa(
  clinica: string,
  usuario: string,
  o: { admin?: boolean; perfil?: string | null; email?: string; pendente?: string; nome?: string } = {},
): Promise<string> {
  const r = await migrate.query<{ id: string }>(
    `INSERT INTO pessoas (clinica_id, nome, usuario, senha_hash, admin, perfil_id, email,
                          email_confirmado_em, email_pendente)
     VALUES ($1, $2, $3, $4, $5, $6, $7, CASE WHEN $7::text IS NULL THEN NULL ELSE now() END, $8)
     RETURNING id`,
    [
      clinica,
      o.nome ?? `${usuario[0]!.toUpperCase()}${usuario.slice(1)} Souza`,
      usuario,
      await hashDeSenha(SENHA),
      o.admin === true,
      o.admin === true ? null : (o.perfil ?? perfilRec),
      o.email ?? null,
      o.pendente ?? null,
    ],
  )
  ids[usuario] = r.rows[0]!.id
  return r.rows[0]!.id
}

beforeAll(async () => {
  migrate = new pg.Client({ connectionString: URL_MIG })
  await migrate.connect()
  await declararAtorSistema(migrate)
  for (const [codigo, nome] of [
    [codigoA, 'Clínica Sol'],
    [codigoB, 'Clínica Lua'],
  ] as const) {
    const c = await migrate.query<{ id: string }>(
      'INSERT INTO clinicas (codigo, nome) VALUES ($1, $2) RETURNING id',
      [codigo, nome],
    )
    if (codigo === codigoA) clinicaA = c.rows[0]!.id
    else clinicaB = c.rows[0]!.id
  }
  perfilRec = (
    await migrate.query<{ id: string }>(
      `INSERT INTO perfis (clinica_id, chave, nome, perms)
       VALUES ($1, 'pf_rec', 'Recepção', ARRAY['jornada']) RETURNING id`,
      [clinicaA],
    )
  ).rows[0]!.id
  perfilCfg = (
    await migrate.query<{ id: string }>(
      `INSERT INTO perfis (clinica_id, chave, nome, perms)
       VALUES ($1, 'pf_cfg', 'Gerência', ARRAY['jornada','config']) RETURNING id`,
      [clinicaA],
    )
  ).rows[0]!.id

  await pessoa(clinicaA, 'helena', { admin: true, email: 'helena@sol.com' })
  await pessoa(clinicaA, 'gerente', { perfil: perfilCfg })
  await pessoa(clinicaA, 'juliana', { email: 'juliana@sol.com' })
  await pessoa(clinicaA, 'paula', { email: 'paula@sol.com' })
  await pessoa(clinicaA, 'pendente', { pendente: 'pendente@sol.com' })
  await pessoa(clinicaA, 'antiga')
  await pessoa(clinicaA, 'orcamento', { email: 'orcamento@sol.com' })
  await pessoa(clinicaA, 'dupla', { email: 'dupla@sol.com' })
  await pessoa(clinicaA, 'vencer', { email: 'vencer@sol.com' })
  await pessoa(clinicaA, 'troca', { email: 'troca@sol.com' })
  await pessoa(clinicaA, 'teto', { email: 'teto@sol.com' })
  await pessoa(clinicaA, 'desativar', { email: 'desativar@sol.com' })
  await pessoa(clinicaA, 'excluir', { email: 'excluir@sol.com' })
  await pessoa(clinicaB, 'helenab', { admin: true, email: 'helena@sol.com' })

  app = await montar(true)
  appDesligado = await montar(false)
})

afterAll(async () => {
  await apagarClinicaDeTeste(migrate, clinicaA)
  await apagarClinicaDeTeste(migrate, clinicaB)
  await migrate.end()
  await app.close()
  await appDesligado.close()
})

const srv = (a = app) => request(a.getHttpServer())
const cookies = (r: { headers: Record<string, string> }): string[] => {
  const v = r.headers['set-cookie'] as unknown
  return Array.isArray(v) ? (v as string[]) : typeof v === 'string' ? [v] : []
}
const entrar = (usuario: string, senha = SENHA, clinica = codigoA, a = app) =>
  srv(a).post('/v1/entrar').send({ clinica, usuario, senha })
const sessao = async (usuario: string, clinica = codigoA, a = app) =>
  cookies(await entrar(usuario, SENHA, clinica, a).expect(200))
const esqueci = (email: string, clinica = codigoA, a = app) =>
  srv(a).post('/v1/esqueci-senha').send({ clinica, email })
const consultar = (token: string) => srv().post('/v1/link-de-acesso/consultar').send({ token })
const usar = (token: string, senha?: string) =>
  srv()
    .post('/v1/link-de-acesso/usar')
    .send(senha === undefined ? { token } : { token, senha })
/** As mensagens entregues "depois da resposta" saem num `setImmediate`. */
const assentar = () => new Promise((r) => setTimeout(r, 30))
const para = (email: string) => correio.mensagens.filter((m) => m.para === email)
const ultimoToken = (email: string): string => {
  const m = para(email).at(-1)
  const t = m === undefined ? null : /#t=([A-Za-z0-9_-]{43})/.exec(m.texto)
  if (t === null || t === undefined) throw new Error(`nenhum link para ${email}`)
  return t[1]!
}
const eventos = async (pessoaId: string) =>
  (
    await migrate.query<{ evento: string }>(
      'SELECT evento FROM eventos_de_acesso WHERE pessoa_id = $1 ORDER BY em',
      [pessoaId],
    )
  ).rows.map((r) => r.evento)
const SENHA_NOVA = 'uma frase nova e comprida'

describe('GET /v1/acesso/config', () => {
  it('diz só se o envio está ligado', async () => {
    expect((await srv().get('/v1/acesso/config').expect(200)).body).toEqual({ envioDeEmail: true })
    expect((await srv(appDesligado).get('/v1/acesso/config').expect(200)).body).toEqual({
      envioDeEmail: false,
    })
  })
})

describe('POST /v1/esqueci-senha (appsec 4, 11; LGPD L7)', () => {
  it('conta, sem conta, pendente e clínica inexistente: o MESMO 202 e a MESMA frase', async () => {
    const antes = correio.mensagens.length
    const respostas = [
      await esqueci('juliana@sol.com'),
      await esqueci('ninguem@sol.com'),
      await esqueci('pendente@sol.com'),
      await esqueci('juliana@sol.com', 'clinica-que-nao-existe'),
    ]
    for (const r of respostas) {
      expect(r.status).toBe(202)
      expect(r.body).toEqual({ mensagem: FRASE_DO_ESQUECI_SENHA })
      expect(cookies(r)).toEqual([])
    }
    await assentar()
    // Só o e-mail CONFIRMADO recebe (appsec 4): o pendente, não.
    const novas = correio.mensagens.slice(antes)
    expect(novas.map((m) => m.para)).toEqual(['juliana@sol.com'])
    expect(novas[0]!.texto).toContain(`${URL_PUBLICA}/criar-senha#t=`)
  })

  it('o pedido sem conta vira evento SEM pessoa e sem o e-mail digitado', async () => {
    const r = await migrate.query(
      `SELECT to_jsonb(e) AS j FROM eventos_de_acesso e
        WHERE clinica_id = $1 AND evento = 'pedido_sem_conta'`,
      [clinicaA],
    )
    expect(r.rowCount).toBeGreaterThan(0)
    expect(JSON.stringify(r.rows)).not.toContain('ninguem')
    expect(JSON.stringify(r.rows)).not.toContain('@')
  })

  it('envio desligado: o mesmo 202, nada enviado, nada gravado', async () => {
    const antes = correio.mensagens.length
    const n0 = (await eventos(ids['paula']!)).length
    const r = await esqueci('paula@sol.com', codigoA, appDesligado).expect(202)
    expect(r.body).toEqual({ mensagem: FRASE_DO_ESQUECI_SENHA })
    await assentar()
    expect(correio.mensagens.length).toBe(antes)
    expect((await eventos(ids['paula']!)).length).toBe(n0)
  })

  it('o teto por e-mail: o sexto pedido na hora responde igual e não manda nada', async () => {
    for (let i = 0; i < 6; i++) await esqueci('teto@sol.com').expect(202)
    await assentar()
    expect(para('teto@sol.com').length).toBe(5)
  })
})

describe('o link: consultar não consome; usar consome uma vez (appsec 5, 8, 16)', () => {
  it('redefinição completa: consulta duas vezes, usa, sem Set-Cookie, derruba sessões, avisa', async () => {
    const antiga = await sessao('paula')
    await esqueci('paula@sol.com').expect(202)
    await assentar()
    const token = ultimoToken('paula@sol.com')

    for (let i = 0; i < 2; i++) {
      const c = await consultar(token).expect(200)
      expect(c.body).toEqual({
        finalidade: 'redefinicao',
        primeiroNome: 'Paula',
        clinicaNome: 'Clínica Sol',
        clinicaCodigo: codigoA,
        usuario: 'paula',
        email: 'paula@sol.com',
      })
    }

    const u = await usar(token, SENHA_NOVA).expect(204)
    expect(cookies(u)).toEqual([])
    await srv().get('/v1/eu').set('Cookie', antiga).expect(401)
    await entrar('paula').expect(401)
    await entrar('paula', SENHA_NOVA).expect(200)

    // Uso único: a segunda vez é 410, e consultar também.
    await usar(token, 'outra frase comprida aqui').expect(410)
    await consultar(token).expect(410)
    await assentar()
    expect(para('paula@sol.com').at(-1)!.tipo).toBe('senha_alterada')
    expect(await eventos(ids['paula']!)).toEqual(
      expect.arrayContaining(['pedido_de_redefinicao', 'senha_redefinida_pelo_link', 'link_ja_usado']),
    )
  })

  it('duas abas ao mesmo tempo: uma grava, a outra ouve 410', async () => {
    await esqueci('dupla@sol.com').expect(202)
    await assentar()
    const token = ultimoToken('dupla@sol.com')
    const [a, b] = await Promise.all([usar(token, SENHA_NOVA), usar(token, 'a outra frase comprida')])
    expect([a.status, b.status].sort()).toEqual([204, 410])
  })

  it('vence em 1 hora: com o relógio +61 min, consultar e usar são 410', async () => {
    await esqueci('vencer@sol.com').expect(202)
    await assentar()
    const token = ultimoToken('vencer@sol.com')
    relogio.deslocamentoMs = 61 * 60_000
    try {
      await consultar(token).expect(410)
      await usar(token, SENHA_NOVA).expect(410)
    } finally {
      relogio.deslocamentoMs = 0
    }
    expect(await eventos(ids['vencer']!)).toContain('link_vencido')
    await entrar('vencer').expect(200)
  })

  it('o link mais novo invalida o anterior', async () => {
    await esqueci('orcamento@sol.com').expect(202)
    await assentar()
    const primeiro = ultimoToken('orcamento@sol.com')
    await esqueci('orcamento@sol.com').expect(202)
    await assentar()
    const segundo = ultimoToken('orcamento@sol.com')
    expect(segundo).not.toBe(primeiro)
    await consultar(primeiro).expect(410)
    await consultar(segundo).expect(200)
  })

  it('token mal formado ou inexistente: 410, a mesma frase', async () => {
    const a = await consultar('x').expect(410)
    const b = await consultar('B'.repeat(43)).expect(410)
    expect(a.body.message).toBe(b.body.message)
  })

  it('senha fraca é 422 e o link continua valendo; sem senha, 422', async () => {
    await esqueci('juliana@sol.com').expect(202)
    await assentar()
    const token = ultimoToken('juliana@sol.com')
    await usar(token).expect(422)
    const fraca = await usar(token, 'juliana123').expect(422)
    expect(fraca.body.codigo).toBeTypeOf('string')
    await consultar(token).expect(200)
  })
})

describe('entrar por e-mail (appsec 9, 10; spec 3.10)', () => {
  it('o e-mail CONFIRMADO entra, em qualquer caixa', async () => {
    const r = await entrar('  Helena@SOL.com ').expect(200)
    expect(r.body.usuario).toMatchObject({
      usuario: 'helena',
      email: 'helena@sol.com',
      emailPendente: null,
      emailConfirmado: true,
    })
  })

  it('o e-mail PENDENTE não autentica', async () => {
    await entrar('pendente@sol.com').expect(401)
    await entrar('pendente').expect(200)
  })

  it('o mesmo e-mail em outra clínica é outra pessoa', async () => {
    const r = await entrar('helena@sol.com', SENHA, codigoB).expect(200)
    expect(r.body.usuario.usuario).toBe('helenab')
  })

  it('UM orçamento de falhas: 3 pelo usuário + 2 pelo e-mail = 429', async () => {
    await pessoa(clinicaA, 'orcamento2', { email: 'orcamento2@sol.com' })
    for (let i = 0; i < 3; i++) await entrar('orcamento2', 'errada errada').expect(401)
    for (let i = 0; i < 2; i++) await entrar('orcamento2@sol.com', 'errada errada').expect(401)
    await entrar('orcamento2').expect(429)
  })

  it('e-mail sem conta conta como e:<hmac>, nunca o endereço (LGPD L7)', async () => {
    await entrar('naoexiste@sol.com', 'qualquer coisa').expect(401)
    const r = await migrate.query<{ identificador: string }>(
      'SELECT identificador FROM tentativas_login WHERE clinica_id = $1',
      [clinicaA],
    )
    const todos = r.rows.map((x) => x.identificador)
    expect(todos.some((x) => x.includes('@'))).toBe(false)
    expect(todos.some((x) => /^e:[0-9a-f]{64}$/.test(x))).toBe(true)
  })
})

describe('POST /v1/eu/email — a pessoa antiga cadastra o próprio e-mail (appsec 1, 2)', () => {
  it('exige a senha atual: errada é 403', async () => {
    const s = await sessao('antiga')
    await srv()
      .post('/v1/eu/email')
      .set('Cookie', s)
      .send({ email: 'antiga@sol.com', senha: 'errada errada' })
      .expect(403)
  })

  it('cadastra pendente, confirma pelo link, e passa a entrar pelo e-mail', async () => {
    const s = await sessao('antiga')
    const r = await srv()
      .post('/v1/eu/email')
      .set('Cookie', s)
      .send({ email: 'Antiga@Sol.com', senha: SENHA })
      .expect(202)
    expect(r.body).toEqual({ enviadoPara: 'a***@s***.com' })

    const eu = await srv().get('/v1/eu').set('Cookie', s).expect(200)
    expect(eu.body.usuario).toMatchObject({
      email: null,
      emailPendente: 'a***@s***.com',
      emailConfirmado: false,
    })
    await entrar('antiga@sol.com').expect(401)

    const token = ultimoToken('antiga@sol.com')
    expect(para('antiga@sol.com').at(-1)!.texto).toContain(`${URL_PUBLICA}/confirmar-email#t=`)
    // Confirmação não leva senha.
    await usar(token, SENHA_NOVA).expect(400)
    const c = await consultar(token).expect(200)
    expect(c.body.finalidade).toBe('confirmacao_de_email')
    await usar(token).expect(204)

    const depois = await srv().get('/v1/eu').set('Cookie', s).expect(200)
    expect(depois.body.usuario).toMatchObject({
      email: 'antiga@sol.com',
      emailPendente: null,
      emailConfirmado: true,
    })
    await entrar('antiga@sol.com').expect(200)
  })

  it('e-mail que outra pessoa da clínica já confirmou: o pedido é 202, o uso do link é 409', async () => {
    const s = await sessao('pendente')
    await srv()
      .post('/v1/eu/email')
      .set('Cookie', s)
      .send({ email: 'helena@sol.com', senha: SENHA })
      .expect(202)
    await usar(ultimoToken('helena@sol.com')).expect(409)
  })

  it('retirar o e-mail: null apaga confirmado e pendente', async () => {
    const s = await sessao('antiga')
    await srv().post('/v1/eu/email').set('Cookie', s).send({ email: null, senha: SENHA }).expect(202)
    const r = await migrate.query(
      'SELECT email, email_pendente, email_confirmado_em FROM pessoas WHERE id = $1',
      [ids['antiga']],
    )
    expect(r.rows[0]).toEqual({ email: null, email_pendente: null, email_confirmado_em: null })
    await assentar()
    expect(para('antiga@sol.com').at(-1)!.tipo).toBe('email_trocado')
  })

  it('envio desligado: 503 para cadastrar', async () => {
    const s = await sessao('antiga', codigoA, appDesligado)
    await srv(appDesligado)
      .post('/v1/eu/email')
      .set('Cookie', s)
      .send({ email: 'antiga@sol.com', senha: SENHA })
      .expect(503)
  })
})

describe('Usuários e acessos: criar com convite, reenviar, redefinir (spec 2.7; appsec 20)', () => {
  it('ligado: nasce convidada, sem provisória; entra só depois do convite', async () => {
    const admin = await sessao('helena')
    const r = await srv()
      .post('/v1/pessoas')
      .set('Cookie', admin)
      .send({ nome: 'Clara Dias', usuario: 'clara', email: 'Clara@Sol.com', acesso: { admin: false, perfilId: perfilRec } })
      .expect(201)
    expect(r.body).toMatchObject({
      usuario: 'clara',
      emailPendente: 'clara@sol.com',
      convite: 'enviado',
      senhaProvisoria: null,
      senhaProvisoriaExpiraEm: null,
    })
    ids['clara'] = r.body.id as string
    const lista = await srv().get('/v1/pessoas').set('Cookie', admin).expect(200)
    expect(lista.body.pessoas.find((p: { id: string }) => p.id === ids['clara'])).toMatchObject({
      email: null,
      emailPendente: 'clara@sol.com',
      emailConfirmado: false,
      situacaoDoAcesso: 'convite_pendente',
    })

    const m = para('clara@sol.com').at(-1)!
    expect(m.tipo).toBe('convite')
    expect(m.texto).not.toContain('clara\n')
    expect(m.texto).not.toContain('Dias')

    const token = ultimoToken('clara@sol.com')
    expect((await consultar(token).expect(200)).body).toMatchObject({
      finalidade: 'convite',
      primeiroNome: 'Clara',
      usuario: 'clara',
    })
    await usar(token, SENHA_NOVA).expect(204)
    await entrar('clara@sol.com', SENHA_NOVA).expect(200)
    const depois = await srv().get('/v1/pessoas').set('Cookie', admin).expect(200)
    expect(depois.body.pessoas.find((p: { id: string }) => p.id === ids['clara'])).toMatchObject({
      email: 'clara@sol.com',
      situacaoDoAcesso: 'ativo',
    })
    // Já criou a senha: convite de novo é 409.
    await srv().post(`/v1/pessoas/${ids['clara']}/convite`).set('Cookie', admin).expect(409)
  })

  it('SMTP recusa na criação: a pessoa existe, convite "falhou", e o reenvio invalida o anterior', async () => {
    const admin = await sessao('helena')
    correio.falhar = true
    let r
    try {
      r = await srv()
        .post('/v1/pessoas')
        .set('Cookie', admin)
        .send({ nome: 'Dora', usuario: 'dora', email: 'dora@sol.com', acesso: { admin: false, perfilId: perfilRec } })
        .expect(201)
    } finally {
      correio.falhar = false
    }
    expect(r.body.convite).toBe('falhou')
    ids['dora'] = r.body.id as string
    const primeiro = (
      await migrate.query<{ id: string }>(
        "SELECT id FROM links_de_acesso WHERE pessoa_id = $1 AND usado_em IS NULL AND invalidado_em IS NULL",
        [ids['dora']],
      )
    ).rows
    expect(primeiro.length).toBe(1)

    const re = await srv().post(`/v1/pessoas/${ids['dora']}/convite`).set('Cookie', admin).expect(202)
    expect(re.body).toEqual({ enviadoPara: 'd***@s***.com' })
    const vivos = await migrate.query<{ id: string }>(
      'SELECT id FROM links_de_acesso WHERE pessoa_id = $1 AND usado_em IS NULL AND invalidado_em IS NULL',
      [ids['dora']],
    )
    expect(vivos.rows.length).toBe(1)
    expect(vivos.rows[0]!.id).not.toBe(primeiro[0]!.id)
    // Convidada não entra com senha nenhuma — nem com a que a fixture conheceria.
    await entrar('dora', SENHA).expect(401)
  })

  it('convite vencido: com o relógio +8 dias, o selo diz convite_vencido', async () => {
    relogio.deslocamentoMs = 8 * 24 * HORA
    try {
      // A sessão nasce no relógio adiantado, para valer nele.
      const admin = await sessao('helena')
      const lista = await srv().get('/v1/pessoas').set('Cookie', admin).expect(200)
      expect(lista.body.pessoas.find((p: { id: string }) => p.id === ids['dora'])).toMatchObject({
        situacaoDoAcesso: 'convite_vencido',
      })
      const token = ultimoToken('dora@sol.com')
      await consultar(token).expect(410)
    } finally {
      relogio.deslocamentoMs = 0
    }
  })

  it('redefinição pela admin: só para e-mail confirmado (409 sem ele)', async () => {
    const admin = await sessao('helena')
    const r = await srv().post(`/v1/pessoas/${ids['juliana']}/redefinicao`).set('Cookie', admin).expect(202)
    expect(r.body).toEqual({ enviadoPara: 'j***@s***.com' })
    expect(para('juliana@sol.com').at(-1)!.tipo).toBe('redefinicao')
    await srv().post(`/v1/pessoas/${ids['pendente']}/redefinicao`).set('Cookie', admin).expect(409)
    expect(await eventos(ids['juliana']!)).toContain('redefinicao_enviada_pela_admin')
  })

  it('quem tem config mas não é admin não age sobre admin (podeAgirSobre)', async () => {
    const gerente = await sessao('gerente')
    await srv().post(`/v1/pessoas/${ids['helena']}/redefinicao`).set('Cookie', gerente).expect(403)
  })

  it('a admin da outra clínica não alcança a pessoa daqui: 404', async () => {
    const outra = await sessao('helenab', codigoB)
    await srv().post(`/v1/pessoas/${ids['juliana']}/redefinicao`).set('Cookie', outra).expect(404)
  })

  it('o teto de envios por pessoa-alvo: o sexto na hora é 429', async () => {
    const admin = await sessao('helena')
    for (let i = 0; i < 5; i++) {
      await srv().post(`/v1/pessoas/${ids['teto']}/redefinicao`).set('Cookie', admin).expect(202)
    }
    await srv().post(`/v1/pessoas/${ids['teto']}/redefinicao`).set('Cookie', admin).expect(429)
  })

  it('desligado: criar devolve a provisória e guarda o e-mail PENDENTE; convite e redefinição são 503', async () => {
    const admin = await sessao('helena', codigoA, appDesligado)
    const r = await srv(appDesligado)
      .post('/v1/pessoas')
      .set('Cookie', admin)
      .send({ nome: 'Eva', usuario: 'eva', email: 'eva@sol.com', acesso: { admin: false, perfilId: perfilRec } })
      .expect(201)
    expect(r.body).toMatchObject({ convite: null, emailPendente: 'eva@sol.com' })
    expect(r.body.senhaProvisoria).toBeTypeOf('string')
    const linha = await migrate.query(
      'SELECT email, email_pendente, aguardando_primeira_senha, senha_provisoria FROM pessoas WHERE id = $1',
      [r.body.id],
    )
    expect(linha.rows[0]).toEqual({
      email: null,
      email_pendente: 'eva@sol.com',
      aguardando_primeira_senha: false,
      senha_provisoria: true,
    })
    await srv(appDesligado).post(`/v1/pessoas/${r.body.id}/convite`).set('Cookie', admin).expect(503)
    await srv(appDesligado).post(`/v1/pessoas/${ids['juliana']}/redefinicao`).set('Cookie', admin).expect(503)
  })
})

describe('o que invalida os links vivos (appsec 7) e a exclusão (LGPD L9)', () => {
  const vivos = async (pessoaId: string) =>
    (
      await migrate.query(
        'SELECT 1 FROM links_de_acesso WHERE pessoa_id = $1 AND usado_em IS NULL AND invalidado_em IS NULL',
        [pessoaId],
      )
    ).rowCount

  it('trocar o e-mail pelo PATCH invalida, e o novo entra pendente com confirmação', async () => {
    const admin = await sessao('helena')
    await esqueci('troca@sol.com').expect(202)
    await assentar()
    const antigo = ultimoToken('troca@sol.com')
    const r = await srv()
      .patch(`/v1/pessoas/${ids['troca']}`)
      .set('Cookie', admin)
      .send({ email: 'troca.nova@sol.com' })
      .expect(200)
    expect(r.body).toMatchObject({ email: 'troca@sol.com', emailPendente: 'troca.nova@sol.com' })
    await consultar(antigo).expect(410)
    // appsec 2: até confirmar, o CONFIRMADO antigo continua entrando, e o novo não.
    await entrar('troca@sol.com').expect(200)
    await entrar('troca.nova@sol.com').expect(401)
    const novo = ultimoToken('troca.nova@sol.com')
    await usar(novo).expect(204)
    await assentar()
    expect(para('troca@sol.com').at(-1)!.tipo).toBe('email_trocado')
    await entrar('troca.nova@sol.com').expect(200)
    await entrar('troca@sol.com').expect(401)
  })

  it('a provisória pela admin invalida', async () => {
    const admin = await sessao('helena')
    await esqueci('juliana@sol.com').expect(202)
    await assentar()
    expect(await vivos(ids['juliana']!)).toBe(1)
    await srv().post(`/v1/pessoas/${ids['juliana']}/senha`).set('Cookie', admin).send({}).expect(200)
    expect(await vivos(ids['juliana']!)).toBe(0)
  })

  it('trocar a própria senha invalida', async () => {
    await pessoa(clinicaA, 'propria', { email: 'propria@sol.com' })
    await esqueci('propria@sol.com').expect(202)
    await assentar()
    expect(await vivos(ids['propria']!)).toBe(1)
    const s = await sessao('propria')
    await srv()
      .post('/v1/eu/senha')
      .set('Cookie', s)
      .send({ atual: SENHA, nova: 'uma troca de senha bem longa' })
      .expect(204)
    expect(await vivos(ids['propria']!)).toBe(0)
  })

  it('desativar invalida', async () => {
    const admin = await sessao('helena', codigoA)
    await esqueci('desativar@sol.com').expect(202)
    await assentar()
    expect(await vivos(ids['desativar']!)).toBe(1)
    await srv().patch(`/v1/pessoas/${ids['desativar']}`).set('Cookie', admin).send({ ativo: false }).expect(200)
    expect(await vivos(ids['desativar']!)).toBe(0)
  })

  it('excluir apaga as colunas de e-mail e invalida', async () => {
    const admin = await sessao('helena')
    await esqueci('excluir@sol.com').expect(202)
    await assentar()
    await srv().delete(`/v1/pessoas/${ids['excluir']}`).set('Cookie', admin).expect((r) => {
      expect(r.status).toBeLessThan(300)
    })
    const r = await migrate.query(
      'SELECT email, email_pendente, email_confirmado_em FROM pessoas WHERE id = $1',
      [ids['excluir']],
    )
    expect(r.rows[0]).toEqual({ email: null, email_pendente: null, email_confirmado_em: null })
    expect(await vivos(ids['excluir']!)).toBe(0)
  })
})

describe('banco: RLS, privilégios e trilha (appsec 6, 13; LGPD L4, L6)', () => {
  it('fir_app de uma clínica não enxerga links nem eventos da outra', async () => {
    const c = new pg.Client({ connectionString: URL_APP })
    await c.connect()
    try {
      await c.query('BEGIN')
      await c.query("SELECT set_config('app.clinica_id', $1, true)", [clinicaB])
      for (const t of ['links_de_acesso', 'eventos_de_acesso']) {
        const r = await c.query(`SELECT count(*)::int AS n FROM ${t} WHERE clinica_id = $1`, [clinicaA])
        expect(r.rows[0].n, t).toBe(0)
      }
      await c.query('ROLLBACK')
      // E com a clínica A, enxerga os dela — a varredura acima não é vazia por acaso.
      await c.query('BEGIN')
      await c.query("SELECT set_config('app.clinica_id', $1, true)", [clinicaA])
      const r = await c.query('SELECT count(*)::int AS n FROM links_de_acesso WHERE clinica_id = $1', [clinicaA])
      expect(r.rows[0].n).toBeGreaterThan(0)
      await c.query('ROLLBACK')
    } finally {
      await c.end()
    }
  })

  it('fir_app: sem DELETE; UPDATE só em usado_em e invalidado_em; evento só INSERT', async () => {
    const priv = async (sql: string) => (await migrate.query<{ v: boolean }>(`SELECT ${sql} AS v`)).rows[0]!.v
    expect(await priv("has_table_privilege('fir_app', 'links_de_acesso', 'DELETE')")).toBe(false)
    expect(await priv("has_table_privilege('fir_app', 'links_de_acesso', 'TRUNCATE')")).toBe(false)
    expect(await priv("has_column_privilege('fir_app', 'links_de_acesso', 'usado_em', 'UPDATE')")).toBe(true)
    expect(await priv("has_column_privilege('fir_app', 'links_de_acesso', 'invalidado_em', 'UPDATE')")).toBe(true)
    for (const col of ['token_hash', 'expira_em', 'pessoa_id', 'email_hmac', 'clinica_id', 'finalidade']) {
      expect(await priv(`has_column_privilege('fir_app', 'links_de_acesso', '${col}', 'UPDATE')`), col).toBe(false)
    }
    expect(await priv("has_table_privilege('fir_app', 'eventos_de_acesso', 'UPDATE')")).toBe(false)
    expect(await priv("has_table_privilege('fir_app', 'eventos_de_acesso', 'DELETE')")).toBe(false)
    expect(await priv("has_table_privilege('fir_app', 'eventos_de_acesso', 'INSERT')")).toBe(true)
  })

  it('o banco guarda o HASH do token, e a trilha do link não tem token nem e-mail', async () => {
    const tokens = correio.mensagens
      .map((m) => /#t=([A-Za-z0-9_-]{43})/.exec(m.texto)?.[1])
      .filter((t): t is string => t !== undefined)
    expect(tokens.length).toBeGreaterThan(5)
    const links = await migrate.query('SELECT to_jsonb(l) AS j FROM links_de_acesso l WHERE clinica_id = $1', [clinicaA])
    const trilha = await migrate.query(
      `SELECT to_jsonb(a) AS j FROM auditoria a WHERE clinica_id = $1 AND entidade = 'links_de_acesso'`,
      [clinicaA],
    )
    expect(trilha.rowCount).toBeGreaterThan(0)
    const tudo = JSON.stringify([links.rows, trilha.rows])
    for (const t of tokens) expect(tudo).not.toContain(t)
    expect(tudo).not.toContain('@')
  })

  it('a trilha de pessoas mascara o e-mail PENDENTE (o confirmado é decisão à parte)', async () => {
    // `email_pendente` está na lista de segredos da trilha (0097): pode ser um
    // erro de digitação, o endereço de um terceiro. O CONFIRMADO segue na
    // trilha como dado da pessoa — a coluna `email` é compartilhada por outras
    // tabelas e mascará-la globalmente apagaria trilha de clientes da carteira.
    const r = await migrate.query<{ de: Record<string, unknown> | null; para: Record<string, unknown> | null }>(
      `SELECT de, para FROM auditoria
        WHERE clinica_id = $1 AND entidade = 'pessoas' AND entidade_id = $2`,
      [clinicaA, ids['troca']],
    )
    const valores = r.rows.flatMap((x) => [x.de?.['email_pendente'], x.para?.['email_pendente']])
    expect(valores.some((v) => v !== undefined && v !== null)).toBe(true)
    for (const v of valores) {
      if (v !== undefined && v !== null) expect(String(v)).not.toContain('@')
    }
  })

  it('eventos_de_acesso não têm e-mail, IP nem token (LGPD L6)', async () => {
    const r = await migrate.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'eventos_de_acesso'`,
    )
    expect(r.rows.map((x) => x.column_name).sort()).toEqual(
      ['clinica_id', 'em', 'evento', 'id', 'pessoa_id', 'por_pessoa_id'].sort(),
    )
  })
})

describe('Atividades da clínica lê os eventos de acesso', () => {
  it('o evento aparece com rótulo, sem e-mail', async () => {
    const admin = await sessao('helena')
    const r = await srv().get('/v1/atividades?assunto=eventos_de_acesso').set('Cookie', admin).expect(200)
    const itens = r.body.itens as { evento: { codigo: string; rotulo: string } | null; assunto: string }[]
    expect(itens.length).toBeGreaterThan(0)
    expect(itens.every((i) => i.assunto === 'eventos_de_acesso' && i.evento !== null)).toBe(true)
    expect(itens.map((i) => i.evento!.codigo)).toContain('senha_redefinida_pelo_link')
    expect(JSON.stringify(r.body)).not.toContain('@')
  })

  it('a paginação atravessa as duas fontes sem repetir', async () => {
    const admin = await sessao('helena')
    const vistas = new Set<string>()
    let antes: string | null = null
    for (let i = 0; i < 20; i++) {
      const q: string = antes === null ? '' : `?antes=${encodeURIComponent(antes)}`
      const r = await srv().get(`/v1/atividades${q}`).set('Cookie', admin).expect(200)
      for (const it of r.body.itens as { chave: string }[]) {
        expect(vistas.has(it.chave), it.chave).toBe(false)
        vistas.add(it.chave)
      }
      antes = r.body.proximo
      if (antes === null) break
    }
    expect([...vistas].some((k) => k.startsWith('evento:'))).toBe(true)
  })
})

describe('log (LGPD L3; appsec 13)', () => {
  it('um fluxo inteiro não escreve token, link nem e-mail completo no console', async () => {
    const linhas: string[] = []
    const espioes = (['log', 'info', 'warn', 'error', 'debug'] as const).map((k) =>
      vi.spyOn(console, k).mockImplementation((...a: unknown[]) => {
        linhas.push(a.map(String).join(' '))
      }),
    )
    try {
      await pessoa(clinicaA, 'logada', { email: 'logada.completa@sol.com' })
      await esqueci('logada.completa@sol.com').expect(202)
      await assentar()
      const token = ultimoToken('logada.completa@sol.com')
      await consultar(token).expect(200)
      await usar(token, SENHA_NOVA).expect(204)
      await usar(token, SENHA_NOVA).expect(410)
      await entrar('logada.completa@sol.com', SENHA_NOVA).expect(200)
      await assentar()
      const tudo = linhas.join('\n')
      expect(tudo).not.toContain(token)
      expect(tudo).not.toContain('logada.completa@sol.com')
      expect(tudo).not.toContain(URL_PUBLICA)
    } finally {
      for (const e of espioes) e.mockRestore()
    }
  })
})

describe('revisão: o próprio e-mail não muda pelo PATCH (appsec 1, P1)', () => {
  it('a admin sobre si mesma: 403, nenhum link e nenhum e-mail', async () => {
    const admin = await sessao('helena')
    const antes = correio.mensagens.length
    const links0 = await migrate.query('SELECT count(*)::int AS n FROM links_de_acesso WHERE pessoa_id = $1', [
      ids['helena'],
    ])
    const r = await srv()
      .patch(`/v1/pessoas/${ids['helena']}`)
      .set('Cookie', admin)
      .send({ email: 'atacante@mal.example' })
      .expect(403)
    expect(r.body.message).toBe('Troque o seu e-mail em Trocar senha › E-mail.')
    const links1 = await migrate.query('SELECT count(*)::int AS n FROM links_de_acesso WHERE pessoa_id = $1', [
      ids['helena'],
    ])
    expect(links1.rows[0].n).toBe(links0.rows[0].n)
    await assentar()
    expect(correio.mensagens.length).toBe(antes)
    const linha = await migrate.query('SELECT email_pendente FROM pessoas WHERE id = $1', [ids['helena']])
    expect(linha.rows[0].email_pendente).toBeNull()
  })

  it('o operador de suporte sobre a administradora em cujo nome assina (comoPessoa): 403', async () => {
    const servico = app.get(AcessoService)
    const ator = {
      ...operadorIdDeFonteConfiavel('00000000-0000-4000-8000-0000000000aa'),
      comoPessoa: pessoaIdDeFonteConfiavel(ids['helena']!),
    }
    await expect(
      servico.editar({ clinicaId: clinicaIdDeFonteConfiavel(clinicaA), ator }, ids['helena']!, {
        email: 'atacante@mal.example',
      }),
    ).rejects.toMatchObject({ status: 403 })
  })

  it('o resto da própria ficha continua editável pelo PATCH', async () => {
    const admin = await sessao('helena')
    await srv().patch(`/v1/pessoas/${ids['helena']}`).set('Cookie', admin).send({ funcao: 'Direção' }).expect(200)
  })
})

describe('revisão: o PATCH diz se o e-mail saiu', () => {
  it("enviado: 'enviado'; SMTP recusou: 'falhou', e a correção fica salva", async () => {
    await pessoa(clinicaA, 'aviso', { email: 'aviso@sol.com' })
    const admin = await sessao('helena')
    const ok = await srv()
      .patch(`/v1/pessoas/${ids['aviso']}`)
      .set('Cookie', admin)
      .send({ email: 'aviso.um@sol.com' })
      .expect(200)
    expect(ok.body.envioDeEmail).toBe('enviado')
    correio.falhar = true
    let falhou
    try {
      falhou = await srv()
        .patch(`/v1/pessoas/${ids['aviso']}`)
        .set('Cookie', admin)
        .send({ email: 'aviso.dois@sol.com' })
        .expect(200)
    } finally {
      correio.falhar = false
    }
    expect(falhou.body).toMatchObject({ envioDeEmail: 'falhou', emailPendente: 'aviso.dois@sol.com' })
    const semEmail = await srv()
      .patch(`/v1/pessoas/${ids['aviso']}`)
      .set('Cookie', admin)
      .send({ funcao: 'Recepção' })
      .expect(200)
    expect(semEmail.body.envioDeEmail).toBeNull()
  })
})

describe('revisão: PATCH { email: null } (LGPD L8)', () => {
  it('apaga confirmado e pendente, o link aberto morre, e ela continua entrando pelo usuário', async () => {
    await pessoa(clinicaA, 'retirar', { email: 'retirar@sol.com' })
    const admin = await sessao('helena')
    await esqueci('retirar@sol.com').expect(202)
    await assentar()
    const token = ultimoToken('retirar@sol.com')
    await srv().patch(`/v1/pessoas/${ids['retirar']}`).set('Cookie', admin).send({ email: null }).expect(200)
    const r = await migrate.query('SELECT email, email_pendente, email_confirmado_em FROM pessoas WHERE id = $1', [
      ids['retirar'],
    ])
    expect(r.rows[0]).toEqual({ email: null, email_pendente: null, email_confirmado_em: null })
    await consultar(token).expect(410)
    await entrar('retirar').expect(200)
    await entrar('retirar@sol.com').expect(401)
    await assentar()
    expect(para('retirar@sol.com').at(-1)!.tipo).toBe('email_trocado')
  })
})

describe('revisão: um link vivo, garantido pelo banco (appsec 6)', () => {
  it('10 emissões concorrentes deixam exatamente 1 link vivo', async () => {
    await pessoa(clinicaA, 'corrida', { email: 'corrida@sol.com' })
    const admin = await sessao('helena')
    // Cinco pelo esqueci-senha e cinco pela admin — os dois tetos (5 por
    // e-mail, 5 por pessoa-alvo) somam dez emissões da MESMA finalidade.
    const pedidos = [
      ...Array.from({ length: 5 }, () => esqueci('corrida@sol.com')),
      ...Array.from({ length: 5 }, () => srv().post(`/v1/pessoas/${ids['corrida']}/redefinicao`).set('Cookie', admin)),
    ]
    const rs = await Promise.all(pedidos)
    for (const r of rs) expect(r.status, JSON.stringify(r.body)).toBe(202)
    await assentar()
    const vivos = await migrate.query(
      `SELECT count(*)::int AS n FROM links_de_acesso
        WHERE pessoa_id = $1 AND usado_em IS NULL AND invalidado_em IS NULL`,
      [ids['corrida']],
    )
    expect(vivos.rows[0].n).toBe(1)
    const todos = await migrate.query('SELECT count(*)::int AS n FROM links_de_acesso WHERE pessoa_id = $1', [
      ids['corrida'],
    ])
    expect(todos.rows[0].n).toBe(10)
  })
})

describe('revisão: o que mais invalida (appsec 7) e a amarração ao e-mail (appsec 3)', () => {
  it('clínica inativa: o link vivo deixa de valer, e volta a valer só se ela voltar', async () => {
    await esqueci('helena@sol.com', codigoB).expect(202)
    await assentar()
    const token = ultimoToken('helena@sol.com')
    expect((await consultar(token).expect(200)).body.clinicaCodigo).toBe(codigoB)
    await migrate.query('UPDATE clinicas SET ativa = false WHERE id = $1', [clinicaB])
    try {
      await consultar(token).expect(410)
      await usar(token, SENHA_NOVA).expect(410)
    } finally {
      await migrate.query('UPDATE clinicas SET ativa = true WHERE id = $1', [clinicaB])
    }
  })

  it('trocar o PRÓPRIO e-mail por /v1/eu/email invalida os links abertos', async () => {
    await pessoa(clinicaA, 'propria2', { email: 'propria2@sol.com' })
    await esqueci('propria2@sol.com').expect(202)
    await assentar()
    const token = ultimoToken('propria2@sol.com')
    const s = await sessao('propria2')
    await srv()
      .post('/v1/eu/email')
      .set('Cookie', s)
      .send({ email: 'propria2.nova@sol.com', senha: SENHA })
      .expect(202)
    await consultar(token).expect(410)
    const vivos = await migrate.query<{ finalidade: string }>(
      `SELECT finalidade FROM links_de_acesso
        WHERE pessoa_id = $1 AND usado_em IS NULL AND invalidado_em IS NULL`,
      [ids['propria2']],
    )
    expect(vivos.rows.map((r) => r.finalidade)).toEqual(['confirmacao_de_email'])
  })

  it('o HMAC sozinho prende o convite ao e-mail: trocado por fora da invalidação, o link morre', async () => {
    const admin = await sessao('helena')
    const r = await srv()
      .post('/v1/pessoas')
      .set('Cookie', admin)
      .send({ nome: 'Fabi', usuario: 'fabi', email: 'fabi@sol.com', acesso: { admin: false, perfilId: perfilRec } })
      .expect(201)
    const token = ultimoToken('fabi@sol.com')
    await consultar(token).expect(200)
    // Só o pendente muda; o link NÃO é invalidado. É a amarração pelo HMAC
    // (appsec 3), sem a invalidação explícita por cima, que precisa recusar.
    await migrate.query("UPDATE pessoas SET email_pendente = 'outra@sol.com' WHERE id = $1", [r.body.id])
    await consultar(token).expect(410)
    await usar(token, SENHA_NOVA).expect(410)
    await migrate.query("UPDATE pessoas SET email_pendente = 'fabi@sol.com' WHERE id = $1", [r.body.id])
    await consultar(token).expect(200)
  })

  it('convite: a admin troca o e-mail e o link antigo não vale; o novo convite vai para o novo', async () => {
    const admin = await sessao('helena')
    const r = await srv()
      .post('/v1/pessoas')
      .set('Cookie', admin)
      .send({ nome: 'Gabi', usuario: 'gabi', email: 'gabi.errado@sol.com', acesso: { admin: false, perfilId: perfilRec } })
      .expect(201)
    const antigo = ultimoToken('gabi.errado@sol.com')
    const p = await srv()
      .patch(`/v1/pessoas/${r.body.id}`)
      .set('Cookie', admin)
      .send({ email: 'gabi@sol.com' })
      .expect(200)
    expect(p.body).toMatchObject({ envioDeEmail: 'enviado', situacaoDoAcesso: 'convite_pendente' })
    await consultar(antigo).expect(410)
    const novo = ultimoToken('gabi@sol.com')
    expect(para('gabi@sol.com').at(-1)!.tipo).toBe('convite')
    await usar(novo, SENHA_NOVA).expect(204)
    await entrar('gabi@sol.com', SENHA_NOVA).expect(200)
  })
})

describe('revisão: resolver_link_de_acesso no molde da 0022 (appsec 17)', () => {
  it("'%' e o prefixo do hash não devolvem nada; o hash inteiro devolve um; sem clínica, fir_app lê 0 links", async () => {
    const um = await migrate.query<{ token_hash: string }>(
      'SELECT token_hash FROM links_de_acesso WHERE clinica_id = $1 LIMIT 1',
      [clinicaA],
    )
    const hash = um.rows[0]!.token_hash
    const c = new pg.Client({ connectionString: URL_APP })
    await c.connect()
    try {
      const contar = async (arg: string) =>
        (await c.query('SELECT count(*)::int AS n FROM resolver_link_de_acesso($1)', [arg])).rows[0].n as number
      expect(await contar('%')).toBe(0)
      expect(await contar(hash.slice(0, 16))).toBe(0)
      expect(await contar(`${hash.slice(0, 16)}%`)).toBe(0)
      expect(await contar(hash)).toBe(1)
      const direto = await c.query('SELECT count(*)::int AS n FROM links_de_acesso')
      expect(direto.rows[0].n).toBe(0)
    } finally {
      await c.end()
    }
  })
})

describe('revisão: o 429 por origem do esqueci-senha (appsec 12)', () => {
  it('o sexto pedido da mesma origem na hora é 429, com Retry-After', async () => {
    const apertado = await montar(true, new LimitePorOrigem(5, HORA))
    try {
      for (let i = 0; i < 5; i++) {
        await request(apertado.getHttpServer())
          .post('/v1/esqueci-senha')
          .send({ clinica: codigoA, email: `origem${i}@sol.com` })
          .expect(202)
      }
      const r = await request(apertado.getHttpServer())
        .post('/v1/esqueci-senha')
        .send({ clinica: codigoA, email: 'origem6@sol.com' })
        .expect(429)
      expect(Number(r.headers['retry-after'])).toBeGreaterThan(0)
    } finally {
      await apertado.close()
    }
  })
})

describe('revisão: o tempo do esqueci-senha não diz quem tem conta (appsec 11)', () => {
  const AMOSTRAS = 7
  const mediana = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!

  it('as medianas dos cinco caminhos diferem menos de 10% do piso', async () => {
    expect(PISO_DE_RESPOSTA_MS, 'o piso está desligado: não há o que medir').toBeGreaterThan(0)
    for (let i = 0; i < AMOSTRAS; i++) {
      await pessoa(clinicaA, `tempo.conta${i}`, { email: `tempo.conta${i}@sol.com` })
      await pessoa(clinicaA, `tempo.pend${i}`, { pendente: `tempo.pend${i}@sol.com` })
    }
    // O teto por e-mail já estourado: o caminho "limite" responde igual.
    for (let k = 0; k < 5; k++) await esqueci('tempo.teto@sol.com').expect(202)

    const caminhos: Record<string, (i: number) => ReturnType<typeof esqueci>> = {
      conta: (i) => esqueci(`tempo.conta${i}@sol.com`),
      semConta: (i) => esqueci(`tempo.ninguem${i}@sol.com`),
      pendente: (i) => esqueci(`tempo.pend${i}@sol.com`),
      clinicaInexistente: (i) => esqueci(`tempo.conta${i}@sol.com`, `nao-existe-${i}`),
      limite: () => esqueci('tempo.teto@sol.com'),
    }
    const tempos: Record<string, number[]> = {}
    // INTERCALADO, como em `oraculo-de-tempo.e2e.test.ts`: uma rajada de carga
    // atinge os cinco caminhos por igual.
    for (let i = 0; i < AMOSTRAS; i++) {
      for (const [nome, f] of Object.entries(caminhos)) {
        const inicio = performance.now()
        await f(i).expect(202)
        ;(tempos[nome] ??= []).push(performance.now() - inicio)
      }
    }
    await assentar()
    const medianas = Object.fromEntries(Object.entries(tempos).map(([k, v]) => [k, mediana(v)]))
    const valores = Object.values(medianas)
    const diferenca = Math.max(...valores) - Math.min(...valores)
    expect(
      diferenca,
      `medianas ${JSON.stringify(medianas)} diferem ${diferenca} ms; o limite é 10% do piso (${PISO_DE_RESPOSTA_MS} ms)`,
    ).toBeLessThan(PISO_DE_RESPOSTA_MS * 0.1)
    for (const v of valores) expect(v).toBeGreaterThanOrEqual(PISO_DE_RESPOSTA_MS)
  })
})
