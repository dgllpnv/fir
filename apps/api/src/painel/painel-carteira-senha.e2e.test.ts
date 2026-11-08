import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify'
import { Test } from '@nestjs/testing'
import { Logger } from '@nestjs/common'
import { randomBytes } from 'node:crypto'
import pg from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AppModule } from '../app.module'
import { LimitePorOrigem } from '../autenticacao/limite-por-origem'
import { hashDeSenha } from '../autenticacao/senha'
import { apagarOperadorDeTeste, declararAtorSistema } from '../banco/limpeza-de-teste'
import { CODIGO_SENHA_PROVISORIA_DA_CARTEIRA } from '../carteira/carteira.guard'
import { LIMITE_DA_CARTEIRA } from '../carteira/limite-da-carteira'
import { registrarCookie } from '../main'

/**
 * O SUPERADMIN REDEFINE A SENHA DE UM `Usuário de Gestão` (D-23 item 3) —
 * `POST /v1/superadmin/usuarios-gestao/:id/senha`, no padrão da clínica
 * (D-18). App inteiro, Postgres real, e TUDO que o processo escreve
 * capturado: a senha escolhida não aparece em resposta, em log nem na trilha.
 */
const URL_MIG =
  process.env['DATABASE_URL_MIGRATE'] ?? 'postgresql://fir_migrate:fir_local_dev@127.0.0.1:4832/fir'

const SENHA_OP = 'quatro-pedras-no-caminho'
const SENHA_ATUAL = 'cadeira-amarela-no-quintal'
/** A senha que o superadmin ESCOLHE. Única para a varredura achar qualquer eco. */
const ESCOLHIDA = `girassol-${randomBytes(3).toString('hex')}-na-janela`
const NOVA_DELA = 'telhado-verde-sobre-o-rio'
const GERADA = /^[a-z]+(-[a-z]+){3}$/
const PROVISORIA_VALE_MS = 72 * 60 * 60 * 1000

const sufixo = randomBytes(4).toString('hex')
const USUARIO_OP = `opsenha.${sufixo}`

let app: NestFastifyApplication
let migrate: pg.Client
let operador: string
let painel: string
const criados: string[] = []

const capturado: string[] = []
const respostas: string[] = []
const escritaOriginal = { out: process.stdout.write.bind(process.stdout), err: process.stderr.write.bind(process.stderr) }

const http = () => request(app.getHttpServer())
const cookies = (r: { headers: Record<string, string> }): string[] => {
  const v = r.headers['set-cookie'] as unknown
  return Array.isArray(v) ? (v as string[]) : typeof v === 'string' ? [v] : []
}
const sessaoDe = (r: { headers: Record<string, string> }): string =>
  cookies(r)
    .map((c) => c.split(';')[0]!)
    .find((c) => c.startsWith('__Host-fir-carteira=') && c.length > '__Host-fir-carteira='.length)!

const guardar = <T extends { text?: string; headers: Record<string, string> }>(r: T): T => {
  respostas.push(r.text ?? '', JSON.stringify(r.headers))
  return r
}

const criarUsuario = async (usuario: string): Promise<string> => {
  const r = await migrate.query<{ id: string }>(
    `INSERT INTO usuarios_gestao (usuario, nome, senha_hash, escopo, grupo_id)
     VALUES ($1, 'Gestora Esqueceu a Senha', $2, 'geral', NULL) RETURNING id`,
    [usuario, await hashDeSenha(SENHA_ATUAL)],
  )
  criados.push(r.rows[0]!.id)
  return r.rows[0]!.id
}

const entrar = (usuario: string, senha: string) => http().post('/v1/carteira/entrar').send({ usuario, senha })
const redefinir = async (id: string, corpo?: object) => {
  const r = http().post(`/v1/superadmin/usuarios-gestao/${id}/senha`).set('Cookie', painel)
  return guardar(await (corpo === undefined ? r : r.send(corpo)))
}
const sessoesVivas = async (id: string): Promise<number> =>
  Number(
    (
      await migrate.query<{ n: string }>(
        'SELECT count(*) AS n FROM sessoes_de_carteira WHERE usuario_gestao_id = $1 AND revogada_em IS NULL',
        [id],
      )
    ).rows[0]!.n,
  )

beforeAll(async () => {
  process.stdout.write = ((chunk: unknown, ...resto: unknown[]) => {
    capturado.push(String(chunk))
    return (escritaOriginal.out as (...a: unknown[]) => boolean)(chunk, ...resto)
  }) as typeof process.stdout.write
  process.stderr.write = ((chunk: unknown, ...resto: unknown[]) => {
    capturado.push(String(chunk))
    return (escritaOriginal.err as (...a: unknown[]) => boolean)(chunk, ...resto)
  }) as typeof process.stderr.write

  migrate = new pg.Client({ connectionString: URL_MIG })
  await migrate.connect()
  await declararAtorSistema(migrate)
  operador = (
    await migrate.query<{ id: string }>(
      `INSERT INTO operadores (usuario, nome, senha_hash) VALUES ($1, 'Dono', $2) RETURNING id`,
      [USUARIO_OP, await hashDeSenha(SENHA_OP)],
    )
  ).rows[0]!.id

  const mod = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(LIMITE_DA_CARTEIRA)
    .useValue(new LimitePorOrigem(5000, 15 * 60 * 1000))
    .compile()
  app = mod.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
  await registrarCookie(app)
  await app.init()
  await app.getHttpAdapter().getInstance().ready()

  const p = await http().post('/v1/superadmin/entrar').send({ usuario: USUARIO_OP, senha: SENHA_OP }).expect(200)
  painel = cookies(p).map((c) => c.split(';')[0]!).join('; ')
})

afterAll(async () => {
  process.stdout.write = escritaOriginal.out
  process.stderr.write = escritaOriginal.err
  await declararAtorSistema(migrate)
  await migrate.query('DELETE FROM tentativas_de_carteira WHERE identificador LIKE $1', [`%.${sufixo}`])
  await migrate.query('DELETE FROM desafios_de_carteira WHERE usuario_gestao_id = ANY($1)', [criados])
  await migrate.query('DELETE FROM sessoes_de_carteira WHERE usuario_gestao_id = ANY($1)', [criados])
  await migrate.query('DELETE FROM usuarios_gestao WHERE id = ANY($1)', [criados])
  await migrate.query('DELETE FROM tentativas_de_operador WHERE identificador = $1', [USUARIO_OP])
  await apagarOperadorDeTeste(migrate, operador)
  await migrate.end()
  await app.close()
})

describe('POST /v1/superadmin/usuarios-gestao/:id/senha', () => {
  it('sem senha: o servidor GERA, devolve uma vez, provisória de 72 h; todas as sessões caem', async () => {
    const usuario = `gerada.${sufixo}`
    const id = await criarUsuario(usuario)
    const s1 = sessaoDe(await entrar(usuario, SENHA_ATUAL).expect(200))
    const s2 = sessaoDe(await entrar(usuario, SENHA_ATUAL).expect(200))
    expect(await sessoesVivas(id)).toBe(2)

    const antes = Date.now()
    const r = await redefinir(id)
    expect(r.status).toBe(200)
    expect(r.body.id).toBe(id)
    expect(r.body.senhaProvisoria).toMatch(GERADA)
    const expira = new Date(r.body.senhaProvisoriaExpiraEm as string).getTime()
    expect(expira).toBeGreaterThanOrEqual(antes + PROVISORIA_VALE_MS - 5_000)
    expect(expira).toBeLessThanOrEqual(Date.now() + PROVISORIA_VALE_MS + 5_000)

    // Sessões revogadas, no banco e na borda.
    expect(await sessoesVivas(id)).toBe(0)
    await http().get('/v1/carteira/eu').set('Cookie', s1).expect(404)
    await http().get('/v1/carteira/eu').set('Cookie', s2).expect(404)

    // A senha antiga morreu; a gerada entra, PROVISÓRIA.
    await entrar(usuario, SENHA_ATUAL).expect(401)
    const nova = await entrar(usuario, r.body.senhaProvisoria as string).expect(200)
    expect(nova.body.usuarioDeGestao.senhaProvisoria).toBe(true)
  })

  it('com senha: o superadmin ESCOLHE; a resposta traz `senhaProvisoria: null` e a troca é obrigatória no primeiro acesso', async () => {
    const usuario = `escolhida.${sufixo}`
    const id = await criarUsuario(usuario)
    const velha = sessaoDe(await entrar(usuario, SENHA_ATUAL).expect(200))

    const r = await redefinir(id, { senha: ESCOLHIDA })
    expect(r.status).toBe(200)
    expect(r.body).toEqual({ id, senhaProvisoria: null, senhaProvisoriaExpiraEm: expect.any(String) })
    expect(r.text).not.toContain(ESCOLHIDA)
    await http().get('/v1/carteira/eu').set('Cookie', velha).expect(404)

    const linha = await migrate.query<{ p: boolean; e: Date | null }>(
      'SELECT senha_provisoria AS p, senha_provisoria_expira_em AS e FROM usuarios_gestao WHERE id = $1',
      [id],
    )
    expect(linha.rows[0]!.p).toBe(true)
    expect(linha.rows[0]!.e).not.toBeNull()

    // Primeiro acesso: entra, mas só alcança a troca.
    const sessao = sessaoDe(await entrar(usuario, ESCOLHIDA).expect(200))
    const presa = await http().get('/v1/carteira/clientes').set('Cookie', sessao).expect(409)
    expect(presa.body.codigo).toBe(CODIGO_SENHA_PROVISORIA_DA_CARTEIRA)
    await http()
      .post('/v1/carteira/eu/senha')
      .set('Cookie', sessao)
      .send({ atual: ESCOLHIDA, nova: NOVA_DELA })
      .expect(204)
    await http().get('/v1/carteira/clientes').set('Cookie', sessao).expect(200)
  })

  it('a escolhida passa pela MESMA regra de força, com o nome dela no contexto: 422 sem eco', async () => {
    const usuario = `fraca.${sufixo}`
    const id = await criarUsuario(usuario)

    const curta = await redefinir(id, { senha: 'abc12' })
    expect(curta.status).toBe(422)
    expect(curta.text).not.toContain('abc12')
    const comUsuario = await redefinir(id, { senha: `${usuario}-e-mais-coisa` })
    expect(comUsuario.status).toBe(422)
    expect(comUsuario.text).not.toContain(`${usuario}-e-mais-coisa`)

    // Nada mudou: a senha de antes ainda entra, sem provisória.
    const ok = await entrar(usuario, SENHA_ATUAL).expect(200)
    expect(ok.body.usuarioDeGestao.senhaProvisoria).toBe(false)
  })

  it('corpo fora do contrato é 400 e NUNCA ecoa a senha', async () => {
    const usuario = `corpo.${sufixo}`
    const id = await criarUsuario(usuario)
    const extra = await redefinir(id, { senha: ESCOLHIDA, motivo: 'x' })
    expect(extra.status).toBe(400)
    expect(extra.text).not.toContain(ESCOLHIDA)
    const longa = `${ESCOLHIDA}${'z'.repeat(400)}`
    const r = await redefinir(id, { senha: longa })
    expect(r.status).toBe(400)
    expect(r.text).not.toContain(ESCOLHIDA)
    expect((await redefinir(id, { senha: 12345678 })).status).toBe(400)
    expect((await redefinir(id, { senha: '' })).status).toBe(400)
  })

  it('404 para id inexistente e para id malformado; a sessão da CARTEIRA não alcança a rota', async () => {
    expect((await redefinir('00000000-0000-4000-8000-000000000000', { senha: ESCOLHIDA })).status).toBe(404)
    expect((await redefinir('00000000-0000-4000-8000-000000000000')).status).toBe(404)
    expect((await redefinir('nao-e-uuid')).status).toBe(404)

    const usuario = `alheia.${sufixo}`
    const id = await criarUsuario(usuario)
    const sessao = sessaoDe(await entrar(usuario, SENHA_ATUAL).expect(200))
    await http().post(`/v1/superadmin/usuarios-gestao/${id}/senha`).set('Cookie', sessao).send({}).expect(404)
    await http().post(`/v1/superadmin/usuarios-gestao/${id}/senha`).send({}).expect(404)
  })

  it('a conta de gestão de um superadmin (ADR 0024, sem senha) é 409: a senha não abre uma porta lateral', async () => {
    const vinculo = await migrate.query<{ id: string; hash: string }>(
      `SELECT u.id, u.senha_hash AS hash FROM contas_de_gestao_do_operador v
         JOIN usuarios_gestao u ON u.id = v.usuario_gestao_id WHERE v.operador_id = $1`,
      [operador],
    )
    const conta = vinculo.rows[0]!
    const r = await redefinir(conta.id, { senha: ESCOLHIDA })
    expect(r.status).toBe(409)
    expect((await redefinir(conta.id)).status).toBe(409)
    const depois = await migrate.query<{ hash: string; p: boolean }>(
      'SELECT senha_hash AS hash, senha_provisoria AS p FROM usuarios_gestao WHERE id = $1',
      [conta.id],
    )
    expect(depois.rows[0]!.hash).toBe(conta.hash)
  })

  it('a trilha em `auditoria_do_painel` registra quem e a origem, nunca a senha nem o hash', async () => {
    const usuario = `trilha.${sufixo}`
    const id = await criarUsuario(usuario)
    expect((await redefinir(id, { senha: ESCOLHIDA })).status).toBe(200)
    const gerada = await redefinir(id)
    expect(gerada.status).toBe(200)

    const trilha = await migrate.query<{ ator_tipo: string; ator_id: string; acao: string; de: unknown; para: unknown }>(
      `SELECT ator_tipo, ator_id, acao, de, para FROM auditoria_do_painel
        WHERE entidade = 'usuarios_gestao' AND entidade_id = $1 ORDER BY id`,
      [id],
    )
    expect(trilha.rows).toEqual([
      {
        ator_tipo: 'operador',
        ator_id: operador,
        acao: 'alterou',
        de: { senhaProvisoria: false },
        para: { senhaProvisoria: true, senhaRedefinida: 'escolhida pelo operador' },
      },
      {
        ator_tipo: 'operador',
        ator_id: operador,
        acao: 'alterou',
        de: { senhaProvisoria: true },
        para: { senhaProvisoria: true, senhaRedefinida: 'gerada pelo servidor' },
      },
    ])
    const tudo = JSON.stringify(trilha.rows)
    expect(tudo).not.toContain(ESCOLHIDA)
    expect(tudo).not.toContain(gerada.body.senhaProvisoria as string)
    expect(tudo).not.toContain('$argon2')
  })
})

describe('a senha não vaza', () => {
  it('nem a escolhida nem a gerada aparecem em log; a escolhida não aparece em resposta nenhuma', async () => {
    const usuario = `vaza.${sufixo}`
    const id = await criarUsuario(usuario)
    const gerada = (await redefinir(id)).body.senhaProvisoria as string
    await redefinir(id, { senha: ESCOLHIDA })
    await redefinir(id, { senha: 'abc12' })

    new Logger('canario-senha').error('canario-da-redefinicao')
    const log = capturado.join('\n')
    expect(log).toContain('canario-da-redefinicao')
    expect(log).not.toContain(ESCOLHIDA)
    expect(log).not.toContain(gerada)
    expect(respostas.join('\n')).not.toContain(ESCOLHIDA)
  })
})
