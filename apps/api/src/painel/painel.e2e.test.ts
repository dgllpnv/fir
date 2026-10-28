import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify'
import { Test } from '@nestjs/testing'
import { randomBytes } from 'node:crypto'
import pg from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AppModule } from '../app.module'
import { PISO_DE_RESPOSTA_MS } from '../autenticacao/autenticacao.service'
import { LimitePorOrigem } from '../autenticacao/limite-por-origem'
import { hashDeSenha } from '../autenticacao/senha'
import {
  apagarClinicaDeTeste,
  apagarOperadorDeTeste,
  declararAtorSistema,
} from '../banco/limpeza-de-teste'
import { registrarCookie } from '../main'
import { LIMITE_DO_PAINEL } from './limite-do-painel'
import { DURACAO_SESSAO_PAINEL_MS } from './painel.guard'

const URL_MIG =
  process.env['DATABASE_URL_MIGRATE'] ?? 'postgresql://fir_migrate:fir_local_dev@127.0.0.1:4832/fir'

const SENHA_OP = 'quatro-pedras-no-caminho'
const SENHA_PESSOA = 'tres-montanhas-de-barro'

let app: NestFastifyApplication
let migrate: pg.Client
let clinica: string
let operador: string
let operadorInativo: string

/**
 * Sufixo ALEATÓRIO, não `Date.now()`.
 *
 * `operadores.usuario` é único GLOBALMENTE — o operador não pertence a
 * clínica nenhuma, então não há `clinica_id` para separar fixtures. Com
 * `Date.now() % 1e6`, dois arquivos de teste que começam no mesmo
 * milissegundo (e eles rodam em paralelo) produzem o MESMO usuário, e o
 * segundo morre em `duplicate key value violates unique constraint`. Medido:
 * 2 de 6 execuções seguidas.
 */
const sufixo = randomBytes(4).toString('hex')
const codigo = `pnl-${sufixo}`
const USUARIO_OP = `dono.${sufixo}`
const USUARIO_INATIVO = `inativo.${sufixo}`
/**
 * O usuário da PESSOA e o nome que não existe também levam o sufixo, e isso
 * não é estética.
 *
 * `tentativas_de_operador` é GLOBAL — o operador não pertence a clínica
 * nenhuma, então não há `clinica_id` para separar execuções. Com um
 * identificador fixo (`helena`), cada rodada deste arquivo somava uma falha
 * à mesma conta, e na quinta rodada dentro de quinze minutos o teste "a
 * credencial de pessoa NÃO entra" passava a receber **429 em vez de 401** —
 * verde na primeira execução, vermelho na quinta, acusando um defeito que
 * não existe.
 */
const USUARIO_PESSOA = `helena.${sufixo}`
const NAO_EXISTE = `ninguem.${sufixo}`

const cookies = (r: { headers: Record<string, string> }): string[] => {
  const v = r.headers['set-cookie'] as unknown
  return Array.isArray(v) ? (v as string[]) : typeof v === 'string' ? [v] : []
}

/** Só o par `nome=valor`, que é o que o `Cookie:` da requisição seguinte leva. */
const paresDe = (lista: string[]): string => lista.map((c) => c.split(';')[0]!).join('; ')

const criarOperador = async (usuario: string, ativo = true): Promise<string> => {
  const r = await migrate.query<{ id: string }>(
    `INSERT INTO operadores (usuario, nome, senha_hash, ativo)
     VALUES ($1, 'Dono do painel', $2, $3) RETURNING id`,
    [usuario, await hashDeSenha(SENHA_OP), ativo],
  )
  return r.rows[0]!.id
}

beforeAll(async () => {
  migrate = new pg.Client({ connectionString: URL_MIG })
  await migrate.connect()
  await declararAtorSistema(migrate)

  clinica = (
    await migrate.query<{ id: string }>(
      `INSERT INTO clinicas (codigo, nome) VALUES ($1, 'Clínica do Painel') RETURNING id`,
      [codigo],
    )
  ).rows[0]!.id
  await migrate.query(
    `INSERT INTO pessoas (clinica_id, nome, usuario, senha_hash, admin)
     VALUES ($1, 'Dra. Helena', $3, $2, true)`,
    [clinica, await hashDeSenha(SENHA_PESSOA), USUARIO_PESSOA],
  )

  operador = await criarOperador(USUARIO_OP)
  operadorInativo = await criarOperador(USUARIO_INATIVO, false)

  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile()
  app = mod.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
  await registrarCookie(app)
  await app.init()
  await app.getHttpAdapter().getInstance().ready()
})

afterAll(async () => {
  await declararAtorSistema(migrate)
  await migrate.query('DELETE FROM tentativas_de_operador WHERE identificador = ANY($1)', [
    [USUARIO_OP, USUARIO_INATIVO, USUARIO_PESSOA, NAO_EXISTE],
  ])
  for (const id of [operador, operadorInativo]) await apagarOperadorDeTeste(migrate, id)
  await apagarClinicaDeTeste(migrate, clinica)
  await migrate.end()
  await app.close()
})

const entrarNoPainel = (usuario = USUARIO_OP, senha = SENHA_OP) =>
  request(app.getHttpServer()).post('/v1/superadmin/entrar').send({ usuario, senha })

const sessaoDoPainel = async (): Promise<string> =>
  paresDe(cookies(await entrarNoPainel().expect(200)))

const sessaoDoProduto = async (): Promise<string> =>
  paresDe(
    cookies(
      await request(app.getHttpServer())
        .post('/v1/entrar')
        .send({ clinica: codigo, usuario: USUARIO_PESSOA, senha: SENHA_PESSOA })
        .expect(200),
    ),
  )

describe('POST /v1/superadmin/entrar', () => {
  it('entra no painel com usuário e senha de OPERADOR', async () => {
    const r = await entrarNoPainel().expect(200)
    expect(r.body.operador.usuario).toBe(USUARIO_OP)
    expect(cookies(r).join()).toMatch(/__Host-fir-painel=/)
  })

  it('nunca devolve hash nem prazo interno', async () => {
    const r = await entrarNoPainel().expect(200)
    expect(JSON.stringify(r.body)).not.toMatch(/\$argon2|senha_hash|expira/i)
  })

  it('o cookie do painel é HttpOnly, Secure, SameSite e Path=/', async () => {
    const bruto = cookies(await entrarNoPainel().expect(200)).join(';')
    expect(bruto).toMatch(/HttpOnly/i)
    expect(bruto).toMatch(/Secure/i)
    expect(bruto).toMatch(/SameSite=Strict/i)
    expect(bruto).toMatch(/Path=\//i)
  })

  it('a sessão do painel dura 8 horas, não 30 dias', async () => {
    const bruto = cookies(await entrarNoPainel().expect(200)).join(';')
    const m = /Max-Age=(\d+)/i.exec(bruto)
    expect(m?.[1]).toBe(String(DURACAO_SESSAO_PAINEL_MS / 1000))
    expect(Number(m?.[1])).toBe(8 * 60 * 60)
  })

  it('senha errada e operador inexistente dizem a MESMA frase', async () => {
    const a = await entrarNoPainel(USUARIO_OP, 'chute-errado-aqui').expect(401)
    const b = await entrarNoPainel(NAO_EXISTE, 'chute-errado-aqui').expect(401)
    expect(a.body.message).toBe(b.body.message)
    expect(a.body.message).toBe('Usuário ou senha incorretos.')
  })

  it('operador INATIVO não entra, com a frase de sempre', async () => {
    const r = await entrarNoPainel(USUARIO_INATIVO, SENHA_OP).expect(401)
    expect(r.body.message).toBe('Usuário ou senha incorretos.')
  })

  it('o corpo é estrito: um campo `clinica` é 400, não ignorado', async () => {
    // O operador não pertence a clínica nenhuma. Aceitar e ignorar o campo
    // faria o próximo leitor achar que ele funciona.
    await request(app.getHttpServer())
      .post('/v1/superadmin/entrar')
      .send({ usuario: USUARIO_OP, senha: SENHA_OP, clinica: codigo })
      .expect(400)
  })

  it('entrar grava em auditoria_do_painel, nunca na trilha de clínica nenhuma', async () => {
    const antesDaClinica = await migrate.query<{ n: string }>(
      'SELECT count(*) AS n FROM auditoria WHERE clinica_id = $1',
      [clinica],
    )
    await entrarNoPainel().expect(200)

    const t = await migrate.query<{ ator_tipo: string; acao: string; entidade: string }>(
      `SELECT ator_tipo, acao, entidade FROM auditoria_do_painel
        WHERE ator_id = $1 ORDER BY em DESC, id DESC LIMIT 1`,
      [operador],
    )
    expect(t.rows[0]).toMatchObject({
      ator_tipo: 'operador',
      acao: 'entrou',
      entidade: 'operadores',
    })

    const depoisDaClinica = await migrate.query<{ n: string }>(
      'SELECT count(*) AS n FROM auditoria WHERE clinica_id = $1',
      [clinica],
    )
    expect(depoisDaClinica.rows[0]!.n).toBe(antesDaClinica.rows[0]!.n)
  })

  it('o piso de tempo vale aqui também, nas três saídas', async () => {
    // Herdado de `/v1/entrar`, e pela mesma razão: o painel tem UM usuário
    // conhecido. Quem mede a camada DEBAIXO do piso é
    // `oraculo-do-painel.e2e.test.ts`, com o piso em zero.
    const medir = async (fn: () => Promise<unknown>) => {
      const inicio = performance.now()
      await fn()
      return performance.now() - inicio
    }
    const casos: [string, () => Promise<unknown>][] = [
      ['sucesso', () => entrarNoPainel().expect(200)],
      ['senha errada', () => entrarNoPainel(USUARIO_OP, 'chute-errado-aqui').expect(401)],
      ['inexistente', () => entrarNoPainel(NAO_EXISTE, 'chute-errado-aqui').expect(401)],
    ]
    for (const [nome, fn] of casos) {
      expect(await medir(fn), nome).toBeGreaterThanOrEqual(PISO_DE_RESPOSTA_MS - 5)
    }
  })
})

describe('os dois espaços de identidade são disjuntos', () => {
  it('a credencial de operador NÃO entra pelo login do produto', async () => {
    await request(app.getHttpServer())
      .post('/v1/entrar')
      .send({ clinica: codigo, usuario: USUARIO_OP, senha: SENHA_OP })
      .expect(401)
  })

  it('a credencial de pessoa NÃO entra pelo login do painel', async () => {
    await entrarNoPainel(USUARIO_PESSOA, SENHA_PESSOA).expect(401)
  })

  it('o cookie do PRODUTO não abre o painel — 404, não 401', async () => {
    const produto = await sessaoDoProduto()
    await request(app.getHttpServer())
      .get('/v1/superadmin/eu')
      .set('Cookie', produto)
      .expect(404)
  })

  it('o cookie do PAINEL não abre o produto', async () => {
    const painel = await sessaoDoPainel()
    await request(app.getHttpServer()).get('/v1/eu').set('Cookie', painel).expect(401)
    await request(app.getHttpServer()).get('/v1/hoje').set('Cookie', painel).expect(401)
  })

  it('rota de painel sem sessão de painel responde 404, não 401', async () => {
    // 401 confirma que a rota existe. Atrás da allowlist isso importa pouco;
    // numa origem permitida mas sem credencial, importa.
    await request(app.getHttpServer()).get('/v1/superadmin/eu').expect(404)
  })
})

describe('a sessão do painel', () => {
  it('GET /v1/superadmin/eu devolve o operador', async () => {
    const painel = await sessaoDoPainel()
    const r = await request(app.getHttpServer())
      .get('/v1/superadmin/eu')
      .set('Cookie', painel)
      .expect(200)
    expect(r.body.operador.id).toBe(operador)
  })

  it('sair revoga a sessão: a mesma chamada passa a dar 404', async () => {
    const painel = await sessaoDoPainel()
    await request(app.getHttpServer())
      .post('/v1/superadmin/sair')
      .set('Cookie', painel)
      .expect(204)
    await request(app.getHttpServer()).get('/v1/superadmin/eu').set('Cookie', painel).expect(404)
  })

  it('sair sem cookie nenhum responde 204 e não estoura', async () => {
    await request(app.getHttpServer()).post('/v1/superadmin/sair').expect(204)
  })

  it('operador desativado DEPOIS de entrar perde a sessão na hora', async () => {
    const descartavel = await criarOperador(`temp.${Date.now() % 1_000_000}`)
    try {
      const r = await entrarNoPainel(
        (await migrate.query<{ usuario: string }>('SELECT usuario FROM operadores WHERE id = $1', [
          descartavel,
        ])).rows[0]!.usuario,
      ).expect(200)
      const painel = paresDe(cookies(r))
      await request(app.getHttpServer())
        .get('/v1/superadmin/eu')
        .set('Cookie', painel)
        .expect(200)

      await migrate.query('UPDATE operadores SET ativo = false WHERE id = $1', [descartavel])
      // Sem esperar a sessão de oito horas vencer: `ativo` é um estado com
      // efeito, não um rótulo.
      await request(app.getHttpServer())
        .get('/v1/superadmin/eu')
        .set('Cookie', painel)
        .expect(404)
    } finally {
      await apagarOperadorDeTeste(migrate, descartavel)
    }
  })
})

describe('o limite por origem do painel é SEPARADO do limite do produto', () => {
  let appLimitado: NestFastifyApplication

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(LIMITE_DO_PAINEL)
      .useValue(new LimitePorOrigem(3, 60_000))
      .compile()
    appLimitado = mod.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
    await registrarCookie(appLimitado)
    await appLimitado.init()
    await appLimitado.getHttpAdapter().getInstance().ready()
  })

  afterAll(async () => {
    await appLimitado.close()
  })

  it('estourado o limite, nem a senha CERTA entra', async () => {
    const tentar = (senha: string) =>
      request(appLimitado.getHttpServer())
        .post('/v1/superadmin/entrar')
        .send({ usuario: USUARIO_OP, senha })
    for (let i = 0; i < 3; i++) await tentar('chute-errado-aqui')
    const r = await tentar(SENHA_OP)
    expect(r.status).toBe(429)
    expect(r.headers['retry-after']).toBeDefined()
  })

  it('e o limite do PRODUTO continua de pé, na própria janela', async () => {
    // Se os dois dividissem a mesma instância, a rajada acima teria fechado
    // `/v1/entrar` também — e o sintoma seria "a clínica não entra e ninguém
    // tentou nada nela".
    await request(appLimitado.getHttpServer())
      .post('/v1/entrar')
      .send({ clinica: codigo, usuario: USUARIO_PESSOA, senha: SENHA_PESSOA })
      .expect(200)
  })
})
