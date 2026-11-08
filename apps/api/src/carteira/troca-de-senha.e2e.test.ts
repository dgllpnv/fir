import { RequestMethod } from '@nestjs/common'
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants'
import { MetadataScanner, ModulesContainer } from '@nestjs/core'
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify'
import { Test } from '@nestjs/testing'
import { randomBytes } from 'node:crypto'
import pg from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AppModule } from '../app.module'
import { hashDeSenha } from '../autenticacao/senha'
import { declararAtorSistema } from '../banco/limpeza-de-teste'
import { registrarCookie } from '../main'
import {
  CODIGO_SENHA_PROVISORIA_DA_CARTEIRA,
  LIBERADAS_COM_PROVISORIA_NA_CARTEIRA,
} from './carteira.guard'
import { SO_USUARIO_DE_GESTAO } from './so-usuario-de-gestao.decorator'

/**
 * A TROCA DA PRÓPRIA SENHA NA CARTEIRA — o defeito de produção de 2026-11-08:
 * o `Usuário de Gestão` nascia com provisória de 72 h, o login a recusava
 * vencida, e não havia rota para trocá-la. Postgres real, app inteiro.
 */

const URL_MIG =
  process.env['DATABASE_URL_MIGRATE'] ?? 'postgresql://fir_migrate:fir_local_dev@127.0.0.1:4832/fir'

const PROVISORIA = 'pinheiro-balde-sete-azul'
const NOVA = 'cadeira-amarela-no-quintal'
const sufixo = randomBytes(4).toString('hex')

let app: NestFastifyApplication
let migrate: pg.Client
const criados: string[] = []

const http = () => request(app.getHttpServer())
const cookies = (r: { headers: Record<string, string> }): string[] => {
  const v = r.headers['set-cookie'] as unknown
  return Array.isArray(v) ? (v as string[]) : typeof v === 'string' ? [v] : []
}
const paresDe = (lista: string[]): string => lista.map((c) => c.split(';')[0]!).join('; ')

/** Um `Usuário de Gestão` com provisória, como o superadmin o cria. */
const criarUsuario = async (
  usuario: string,
  { expira = "now() + interval '72 hours'", provisoria = true } = {},
): Promise<string> => {
  const r = await migrate.query<{ id: string }>(
    `INSERT INTO usuarios_gestao
       (usuario, nome, senha_hash, escopo, grupo_id, senha_provisoria, senha_provisoria_expira_em)
     VALUES ($1, 'Gestora Nova', $2, 'geral', NULL, $3, ${provisoria ? expira : 'NULL'})
     RETURNING id`,
    [usuario, await hashDeSenha(PROVISORIA), provisoria],
  )
  criados.push(r.rows[0]!.id)
  return r.rows[0]!.id
}

const entrar = async (usuario: string, senha = PROVISORIA): Promise<string> => {
  const r = await http().post('/v1/carteira/entrar').send({ usuario, senha }).expect(200)
  return paresDe(cookies(r))
}

const trocar = (sessao: string, corpo: unknown) =>
  http().post('/v1/carteira/eu/senha').set('Cookie', sessao).send(corpo as object)

beforeAll(async () => {
  migrate = new pg.Client({ connectionString: URL_MIG })
  await migrate.connect()
  await declararAtorSistema(migrate)

  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile()
  app = mod.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
  await registrarCookie(app)
  await app.init()
  await app.getHttpAdapter().getInstance().ready()
})

afterAll(async () => {
  await declararAtorSistema(migrate)
  await migrate.query(
    `DELETE FROM tentativas_de_carteira WHERE identificador LIKE $1`,
    [`%.${sufixo}`],
  )
  await migrate.query('DELETE FROM sessoes_de_carteira WHERE usuario_gestao_id = ANY($1)', [criados])
  await migrate.query('DELETE FROM usuarios_gestao WHERE id = ANY($1)', [criados])
  await migrate.end()
  await app.close()
})

describe('POST /v1/carteira/eu/senha — a saída da provisória', () => {
  it('provisória entra → só troca → depois navega', async () => {
    const usuario = `prov.fluxo.${sufixo}`
    const id = await criarUsuario(usuario)
    const sessao = await entrar(usuario)

    // `eu` atravessa, e diz à tela para onde mandar a pessoa.
    const eu = await http().get('/v1/carteira/eu').set('Cookie', sessao).expect(200)
    expect(eu.body.usuarioDeGestao.senhaProvisoria).toBe(true)

    // Qualquer outra rota: 409 com o código da carteira.
    const preso = await http().get('/v1/carteira/clientes').set('Cookie', sessao).expect(409)
    expect(preso.body).toMatchObject({
      codigo: CODIGO_SENHA_PROVISORIA_DA_CARTEIRA,
      message: 'Troque a senha provisória antes de continuar.',
    })

    await trocar(sessao, { atual: PROVISORIA, nova: NOVA }).expect(204)

    // A MESMA sessão, agora livre.
    const depois = await http().get('/v1/carteira/eu').set('Cookie', sessao).expect(200)
    expect(depois.body.usuarioDeGestao.senhaProvisoria).toBe(false)
    await http().get('/v1/carteira/clientes').set('Cookie', sessao).expect(200)

    const linha = await migrate.query<{ senha_provisoria: boolean; senha_provisoria_expira_em: Date | null }>(
      'SELECT senha_provisoria, senha_provisoria_expira_em FROM usuarios_gestao WHERE id = $1',
      [id],
    )
    expect(linha.rows[0]).toEqual({ senha_provisoria: false, senha_provisoria_expira_em: null })

    // A senha nova entra; a provisória não entra mais.
    await entrar(usuario, NOVA)
    await http().post('/v1/carteira/entrar').send({ usuario, senha: PROVISORIA }).expect(401)
  })

  it('grava a trilha em auditoria_do_painel, com o ator usuario_gestao e sem a senha', async () => {
    const usuario = `prov.trilha.${sufixo}`
    const id = await criarUsuario(usuario)
    const sessao = await entrar(usuario)
    await trocar(sessao, { atual: PROVISORIA, nova: NOVA }).expect(204)

    const r = await migrate.query<{ ator_tipo: string; ator_id: string; acao: string; para: unknown }>(
      `SELECT ator_tipo, ator_id, acao, para FROM auditoria_do_painel
        WHERE entidade = 'usuarios_gestao' AND entidade_id = $1`,
      [id],
    )
    expect(r.rows).toHaveLength(1)
    expect(r.rows[0]).toMatchObject({ ator_tipo: 'usuario_gestao', ator_id: id, acao: 'alterou' })
    const bruto = JSON.stringify(r.rows)
    expect(bruto).not.toContain(NOVA)
    expect(bruto).not.toContain(PROVISORIA)
    expect(bruto).not.toMatch(/\$argon2/)
  })

  it('senha fraca: 422 com a mensagem do domínio, e nada muda', async () => {
    const usuario = `prov.fraca.${sufixo}`
    const id = await criarUsuario(usuario)
    const sessao = await entrar(usuario)

    const curta = await trocar(sessao, { atual: PROVISORIA, nova: 'curta' }).expect(422)
    expect(curta.body.message).toMatch(/pelo menos/)
    // O próprio usuário dentro da senha — o contexto vem do servidor.
    const comUsuario = await trocar(sessao, { atual: PROVISORIA, nova: `${usuario}-e-mais-coisa` }).expect(422)
    expect(comUsuario.body.message).toMatch(/seu usuário/)

    const linha = await migrate.query<{ senha_provisoria: boolean }>(
      'SELECT senha_provisoria FROM usuarios_gestao WHERE id = $1',
      [id],
    )
    expect(linha.rows[0]!.senha_provisoria).toBe(true)
  })

  it('senha atual errada: 403, e nada muda', async () => {
    const usuario = `prov.errada.${sufixo}`
    const id = await criarUsuario(usuario)
    const sessao = await entrar(usuario)

    const r = await trocar(sessao, { atual: 'nao-e-esta-aqui', nova: NOVA }).expect(403)
    expect(r.body.message).toBe('A senha atual não confere.')

    const linha = await migrate.query<{ senha_provisoria: boolean }>(
      'SELECT senha_provisoria FROM usuarios_gestao WHERE id = $1',
      [id],
    )
    expect(linha.rows[0]!.senha_provisoria).toBe(true)
  })

  it('corpo fora do contrato (campo a mais, campo faltando): 400', async () => {
    const usuario = `prov.corpo.${sufixo}`
    await criarUsuario(usuario)
    const sessao = await entrar(usuario)
    await trocar(sessao, { atual: PROVISORIA }).expect(400)
    await trocar(sessao, { atual: PROVISORIA, nova: NOVA, contexto: [] }).expect(400)
  })

  it('revoga as OUTRAS sessões e mantém a de quem trocou', async () => {
    const usuario = `prov.sessoes.${sufixo}`
    await criarUsuario(usuario)
    const outra = await entrar(usuario)
    const esta = await entrar(usuario)

    await trocar(esta, { atual: PROVISORIA, nova: NOVA }).expect(204)

    await http().get('/v1/carteira/eu').set('Cookie', esta).expect(200)
    // A outra caiu: o guard responde 404, como para qualquer sessão morta.
    await http().get('/v1/carteira/eu').set('Cookie', outra).expect(404)
  })

  it('sem sessão: 404, como toda rota da carteira', async () => {
    await http().post('/v1/carteira/eu/senha').send({ atual: PROVISORIA, nova: NOVA }).expect(404)
  })

  it('troca voluntária (sem provisória) também funciona', async () => {
    const usuario = `prov.voluntaria.${sufixo}`
    await criarUsuario(usuario, { provisoria: false })
    const sessao = await entrar(usuario)
    await trocar(sessao, { atual: PROVISORIA, nova: NOVA }).expect(204)
    await entrar(usuario, NOVA)
  })

  it('provisória vencida continua recusada no login, com a frase única', async () => {
    const usuario = `prov.vencida.${sufixo}`
    await criarUsuario(usuario, { expira: "now() - interval '1 minute'" })
    const r = await http().post('/v1/carteira/entrar').send({ usuario, senha: PROVISORIA }).expect(401)
    expect(r.body.message).toBe('Usuário ou senha incorretos.')
  })
})

/**
 * A VARREDURA: TODA rota da carteira, menos as três liberadas, recusa a
 * sessão com provisória — inclusive a rota que alguém escrever amanhã. Mesma
 * forma da varredura do produto em `teste/rotas-protegidas.test.ts`.
 */
describe('nenhuma rota da carteira atravessa a senha provisória', () => {
  const juntar = (...partes: (string | undefined)[]): string =>
    `/${partes
      .filter((p): p is string => typeof p === 'string')
      .flatMap((p) => p.split('/'))
      .filter((p) => p !== '')
      .join('/')}`

  it('toda rota @SoUsuarioDeGestao não liberada responde 409 SENHA_PROVISORIA_CARTEIRA', async () => {
    const usuario = `prov.varredura.${sufixo}`
    await criarUsuario(usuario)
    const sessao = await entrar(usuario)

    const scanner = new MetadataScanner()
    const alvos: { metodo: string; caminho: string }[] = []
    for (const [, modulo] of app.get(ModulesContainer)) {
      for (const [, wrapper] of modulo.controllers) {
        const classe = wrapper.metatype
        const instancia = wrapper.instance
        if (typeof classe !== 'function' || instancia === null || typeof instancia !== 'object') continue
        const naClasse = Reflect.getMetadata(SO_USUARIO_DE_GESTAO, classe) === true
        const prefixo = Reflect.getMetadata(PATH_METADATA, classe) as string | undefined
        const proto = Object.getPrototypeOf(instancia) as Record<string, unknown>
        for (const nome of scanner.getAllMethodNames(proto)) {
          const handler = proto[nome]
          if (typeof handler !== 'function') continue
          const verbo = Reflect.getMetadata(METHOD_METADATA, handler) as number | undefined
          const caminho = Reflect.getMetadata(PATH_METADATA, handler) as string | undefined
          if (verbo === undefined || caminho === undefined) continue
          if (!naClasse && Reflect.getMetadata(SO_USUARIO_DE_GESTAO, handler) !== true) continue
          alvos.push({ metodo: RequestMethod[verbo] ?? '?', caminho: juntar(prefixo, caminho) })
        }
      }
    }

    const verificar = alvos.filter(
      (r) =>
        !LIBERADAS_COM_PROVISORIA_NA_CARTEIRA.has(`${r.metodo} ${r.caminho}`) &&
        r.caminho !== '/v1/carteira/entrar',
    )
    expect(verificar.length, 'nenhuma rota da carteira encontrada — a varredura quebrou').toBeGreaterThan(10)

    const fastify = app.getHttpAdapter().getInstance()
    const [nome, ...resto] = sessao.split('=')
    for (const rota of verificar) {
      const url = rota.caminho.replace(/:[^/]+/g, '00000000-0000-0000-0000-000000000000')
      const r = await fastify.inject({
        method: (rota.metodo === 'ALL' ? 'GET' : rota.metodo) as 'GET',
        url,
        payload: {},
        cookies: { [nome!]: resto.join('=') },
      })
      expect(r.statusCode, `${rota.metodo} ${rota.caminho} respondeu ${r.statusCode} com provisória`).toBe(409)
      expect(r.json()).toMatchObject({ codigo: CODIGO_SENHA_PROVISORIA_DA_CARTEIRA })
    }
  })
})
