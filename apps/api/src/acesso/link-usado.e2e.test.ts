import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify'
import { Test } from '@nestjs/testing'
import { randomBytes } from 'node:crypto'
import pg from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { AppModule } from '../app.module'
import { LimitePorOrigem } from '../autenticacao/limite-por-origem'
import { hashDeSenha } from '../autenticacao/senha'
import { hashDoToken } from '../autenticacao/sessao'
import { apagarClinicaDeTeste, declararAtorSistema } from '../banco/limpeza-de-teste'
import { registrarCookie } from '../main'
import { AcessoPorEmailService } from './acesso-por-email.service'
import { CorreioCapturador, ENVIO } from './correio'
import { LIMITE_ESQUECI_POR_ORIGEM } from './limites'

/**
 * DEPOIS DO USO, NADA RESGATA O LINK (appsec 5, 13, 18).
 *
 * O desenho, conferido no código: o banco nunca teve o token — só o SHA-256
 * dele (`token_hash`, `NOT NULL UNIQUE`, 0097). Usar o link NÃO apaga o hash:
 * marca `usado_em`, e é o hash que permite à segunda tentativa virar o evento
 * `link_ja_usado`. O que o torna inútil é o encerramento, e desde a 0111 o
 * encerramento é TERMINAL (trigger): nem `fir_app` nem o dono voltam
 * `usado_em` a NULL. A segunda tentativa ouve a MESMA frase de um token que
 * nunca existiu, e o token não aparece em resposta, banco ou log.
 */

const URL_MIG =
  process.env['DATABASE_URL_MIGRATE'] ?? 'postgresql://fir_migrate:fir_local_dev@127.0.0.1:4832/fir'
const URL_APP = process.env['DATABASE_URL'] ?? 'postgresql://fir_app:fir_local_dev@127.0.0.1:4832/fir'
const URL_PUBLICA = 'https://fir.teste'
const SENHA = 'senha-de-teste-longa'
const SENHA_NOVA = 'uma frase nova e comprida'
const HORA = 3_600_000
const codigo = `lus-${randomBytes(4).toString('hex')}`

const correio = new CorreioCapturador()
let app: NestFastifyApplication
let migrate: pg.Client
let clinica: string
const ids: Record<string, string> = {}

const srv = () => request(app.getHttpServer())
const assentar = () => app.get(AcessoPorEmailService).ocioso()
const usar = (token: string, senha?: string) =>
  srv()
    .post('/v1/link-de-acesso/usar')
    .send(senha === undefined ? { token } : { token, senha })
const consultar = (token: string) => srv().post('/v1/link-de-acesso/consultar').send({ token })
const ultimoToken = (email: string): string => {
  const m = correio.mensagens.filter((x) => x.para === email).at(-1)
  const t = m === undefined ? null : /#t=([A-Za-z0-9_-]{43})/.exec(m.texto)
  if (t === null || t === undefined) throw new Error(`nenhum link para ${email}`)
  return t[1]!
}
/** Um token bem formado que nunca foi emitido: a resposta de referência. */
const tokenQueNuncaExistiu = () => randomBytes(32).toString('base64url')

/** Captura TUDO o que o processo escreveria: console e os dois fluxos. */
function capturarSaida(): { texto: () => string; parar: () => void } {
  const linhas: string[] = []
  const espioes = [
    ...(['log', 'info', 'warn', 'error', 'debug'] as const).map((k) =>
      vi.spyOn(console, k).mockImplementation((...a: unknown[]) => {
        linhas.push(a.map(String).join(' '))
      }),
    ),
    ...([process.stdout, process.stderr] as const).map((s) =>
      vi.spyOn(s, 'write').mockImplementation((pedaco: string | Uint8Array) => {
        linhas.push(typeof pedaco === 'string' ? pedaco : Buffer.from(pedaco).toString('utf8'))
        return true
      }),
    ),
  ]
  return { texto: () => linhas.join('\n'), parar: () => espioes.forEach((e) => e.mockRestore()) }
}

/** O banco inteiro da clínica onde um token poderia ter ido parar, como texto. */
async function tudoNoBanco(): Promise<string> {
  const consultas = [
    'SELECT to_jsonb(l)::text AS t FROM links_de_acesso l WHERE clinica_id = $1',
    'SELECT to_jsonb(a)::text AS t FROM auditoria a WHERE clinica_id = $1',
    'SELECT to_jsonb(e)::text AS t FROM eventos_de_acesso e WHERE clinica_id = $1',
    'SELECT to_jsonb(s)::text AS t FROM sessoes s WHERE clinica_id = $1',
  ]
  const partes: string[] = []
  for (const q of consultas) partes.push(...(await migrate.query<{ t: string }>(q, [clinica])).rows.map((r) => r.t))
  return partes.join('\n')
}

async function pessoa(usuario: string, o: { email?: string; pendente?: string }) {
  const r = await migrate.query<{ id: string }>(
    `INSERT INTO pessoas (clinica_id, nome, usuario, senha_hash, admin, email, email_confirmado_em, email_pendente)
     VALUES ($1, $2, $3, $4, true, $5, CASE WHEN $5::text IS NULL THEN NULL ELSE now() END, $6) RETURNING id`,
    [clinica, `${usuario} Souza`, usuario, await hashDeSenha(SENHA), o.email ?? null, o.pendente ?? null],
  )
  ids[usuario] = r.rows[0]!.id
}

beforeAll(async () => {
  migrate = new pg.Client({ connectionString: URL_MIG })
  await migrate.connect()
  await declararAtorSistema(migrate)
  clinica = (
    await migrate.query<{ id: string }>("INSERT INTO clinicas (codigo, nome) VALUES ($1, 'Clínica Sol') RETURNING id", [
      codigo,
    ])
  ).rows[0]!.id
  await pessoa('rita', { email: 'rita.completa@sol.com' })
  await pessoa('vera', { email: 'vera@sol.com' })

  const mod = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(ENVIO)
    .useValue({ urlPublica: URL_PUBLICA, correio })
    .overrideProvider(LIMITE_ESQUECI_POR_ORIGEM)
    .useValue(new LimitePorOrigem(10_000, HORA))
    .overrideProvider(LimitePorOrigem)
    .useValue(new LimitePorOrigem(10_000, HORA))
    .compile()
  app = mod.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
  await registrarCookie(app)
  await app.init()
  await app.getHttpAdapter().getInstance().ready()
})

afterAll(async () => {
  if (app !== undefined) await assentar()
  await declararAtorSistema(migrate)
  if (clinica !== undefined) await apagarClinicaDeTeste(migrate, clinica)
  await migrate.end()
  if (app !== undefined) await app.close()
})

describe('o link usado não resgata mais nada', () => {
  it('redefinição: marcado usado, só o hash na linha, a segunda vez ouve a frase do token inexistente, e o token não sai em resposta, banco nem log', async () => {
    const saida = capturarSaida()
    let token = ''
    let respostas: string[] = []
    try {
      await srv().post('/v1/esqueci-senha').send({ clinica: codigo, email: 'rita.completa@sol.com' }).expect(202)
      await assentar()
      token = ultimoToken('rita.completa@sol.com')

      const consulta = await consultar(token).expect(200)
      const uso = await usar(token, SENHA_NOVA).expect(204)
      const segunda = await usar(token, 'outra frase longa demais').expect(410)
      const consultaDepois = await consultar(token).expect(410)
      const nunca = await usar(tokenQueNuncaExistiu(), 'outra frase longa demais').expect(410)
      const consultaNunca = await consultar(tokenQueNuncaExistiu()).expect(410)
      await assentar()

      // A MESMA resposta genérica do token que nunca existiu: nada distingue
      // "já usado" de "inventado" para quem tem o token na mão.
      expect(segunda.body).toEqual(nunca.body)
      expect(consultaDepois.body).toEqual(consultaNunca.body)

      respostas = [consulta, uso, segunda, consultaDepois].map(
        (r) => JSON.stringify(r.headers) + (r.text ?? ''),
      )
    } finally {
      saida.parar()
    }

    for (const r of respostas) expect(r).not.toContain(token)
    expect(saida.texto()).not.toContain(token)
    expect(saida.texto()).not.toContain('rita.completa@sol.com')

    // A linha: USADA, e o que ficou é o SHA-256 — nunca o token.
    const hash = hashDoToken(token)
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
    expect(hash).not.toBe(token)
    const linha = await migrate.query<{ usado_em: Date | null; invalidado_em: Date | null; token_hash: string }>(
      'SELECT usado_em, invalidado_em, token_hash FROM links_de_acesso WHERE token_hash = $1',
      [hash],
    )
    expect(linha.rows).toHaveLength(1)
    expect(linha.rows[0]!.usado_em).not.toBeNull()
    expect(linha.rows[0]!.invalidado_em).toBeNull()
    expect(await tudoNoBanco()).not.toContain(token)

    const eventos = (
      await migrate.query<{ evento: string }>('SELECT evento FROM eventos_de_acesso WHERE pessoa_id = $1', [ids['rita']])
    ).rows.map((e) => e.evento)
    expect(eventos).toEqual(expect.arrayContaining(['senha_redefinida_pelo_link', 'link_ja_usado']))

    // A nova senha é a do PRIMEIRO uso; a segunda tentativa não mudou nada.
    await srv().post('/v1/entrar').send({ clinica: codigo, usuario: 'rita', senha: SENHA_NOVA }).expect(200)
    await srv()
      .post('/v1/entrar')
      .send({ clinica: codigo, usuario: 'rita', senha: 'outra frase longa demais' })
      .expect(401)
  })

  it('o encerramento é terminal: nem fir_app nem o dono devolvem o link usado à vida', async () => {
    await srv().post('/v1/esqueci-senha').send({ clinica: codigo, email: 'vera@sol.com' }).expect(202)
    await assentar()
    const token = ultimoToken('vera@sol.com')
    await usar(token, SENHA_NOVA).expect(204)
    const hash = hashDoToken(token)

    const comoApp = new pg.Client({ connectionString: URL_APP })
    await comoApp.connect()
    try {
      await comoApp.query('BEGIN')
      await comoApp.query("SELECT set_config('app.clinica_id', $1, true), set_config('app.pessoa_id', 'sistema', true)", [
        clinica,
      ])
      await expect(
        comoApp.query('UPDATE links_de_acesso SET usado_em = NULL WHERE token_hash = $1', [hash]),
      ).rejects.toThrow(/encerrado não muda/)
      await comoApp.query('ROLLBACK')
    } finally {
      await comoApp.end()
    }
    await expect(
      migrate.query('UPDATE links_de_acesso SET usado_em = NULL WHERE token_hash = $1', [hash]),
    ).rejects.toThrow(/encerrado não muda/)
    // Nem trocar o prazo de um link VIVO: só usado_em e invalidado_em mudam.
    await srv().post('/v1/esqueci-senha').send({ clinica: codigo, email: 'vera@sol.com' }).expect(202)
    await assentar()
    const vivo = hashDoToken(ultimoToken('vera@sol.com'))
    await expect(
      migrate.query("UPDATE links_de_acesso SET expira_em = expira_em + interval '1 day' WHERE token_hash = $1", [vivo]),
    ).rejects.toThrow(/só usado_em e invalidado_em/)

    await usar(token, 'mais uma frase comprida').expect(410)
  })

  it('confirmação de e-mail: a mesma coisa, sem senha', async () => {
    // O pendente nasce pelo /v1/eu/email da própria, que manda o link.
    const s = await srv().post('/v1/entrar').send({ clinica: codigo, usuario: 'vera', senha: SENHA_NOVA }).expect(200)
    const cookie = ([] as string[]).concat(s.headers['set-cookie'] as unknown as string[]).map((c) => c.split(';')[0]!).join('; ')
    await srv().post('/v1/eu/email').set('Cookie', cookie).send({ email: 'vera.nova@sol.com', senha: SENHA_NOVA }).expect(202)
    const token = ultimoToken('vera.nova@sol.com')

    await usar(token).expect(204)
    const segunda = await usar(token).expect(410)
    const nunca = await usar(tokenQueNuncaExistiu()).expect(410)
    expect(segunda.body).toEqual(nunca.body)
    const l = await migrate.query<{ usado_em: Date | null }>('SELECT usado_em FROM links_de_acesso WHERE token_hash = $1', [
      hashDoToken(token),
    ])
    expect(l.rows[0]!.usado_em).not.toBeNull()
    expect(await tudoNoBanco()).not.toContain(token)
  })
})
