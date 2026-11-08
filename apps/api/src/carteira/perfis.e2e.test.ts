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

/**
 * **G8 0.5 — PERFIS DO `Usuário de Gestão`, contra Postgres real e pela API
 * inteira** (`AppModule`: `CarteiraGuard`, `RedacaoInterceptor`, RLS).
 *
 * Seam: HTTP da API sobre Postgres real. O que este arquivo prova:
 *  - com `valores`, o dinheiro atravessa; sem, sai `null` (A-2, regra 17);
 *  - escrever campo monetário sem `valores` é 403, e nada muda (A-6);
 *  - "só a minha carteira" devolve só os clientes dela, e o alheio é o mesmo
 *    404 de um id que não existe, inclusive por query (A-3);
 *  - "minha" não troca responsável (A-3);
 *  - o isolamento por grupo continua de pé;
 *  - a tela da rota é autorização de servidor (A-4), `mensalidades` exige
 *    `valores`, e `setor` não muda decisão nenhuma;
 *  - revogar `valores` vale na requisição seguinte, sem novo login (caso 4);
 *  - `fir_carteira` não escreve o próprio privilégio (A-1, caso 1).
 *
 * Nenhum cliente fica `ativo` com mensalidade e vencimento: o job de cobrança
 * de outro arquivo os varreria.
 */
const URL_MIG =
  process.env['DATABASE_URL_MIGRATE'] ?? 'postgresql://fir_migrate:fir_local_dev@127.0.0.1:4832/fir'
const URL_CARTEIRA =
  process.env['DATABASE_URL_CARTEIRA'] ?? 'postgresql://fir_carteira:fir_local_dev@127.0.0.1:4832/fir'

const SENHA = 'quatro-pedras-no-caminho'
const sufixo = randomBytes(4).toString('hex')
const ID_INEXISTENTE = '00000000-0000-4000-8000-000000000000'

let app: NestFastifyApplication
let migrate: pg.Client
let grupoA: string
let grupoB: string
let clienteDaMinha: string
let clienteAlheio: string
let clienteB: string
const ugs: Record<string, string> = {}
const cookie: Record<string, string> = {}

const cookies = (r: { headers: Record<string, string> }): string[] => {
  const v = r.headers['set-cookie'] as unknown
  return Array.isArray(v) ? (v as string[]) : typeof v === 'string' ? [v] : []
}
const paresDe = (lista: string[]): string => lista.map((c) => c.split(';')[0]!).join('; ')
const http = () => request(app.getHttpServer())

type Perfil = { valores?: boolean; carteira?: 'minha' | 'todos'; modulos?: string[]; setor?: string | null }

const criarUg = async (apelido: string, escopo: 'grupo' | 'geral', grupo: string | null, p: Perfil = {}) => {
  const id = (
    await migrate.query<{ id: string }>(
      `INSERT INTO usuarios_gestao (usuario, nome, senha_hash, escopo, grupo_id, valores, carteira, modulos, setor)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::text[], $9) RETURNING id`,
      [
        `perf.${apelido}.${sufixo}`,
        `Pessoa ${apelido}`,
        await hashDeSenha(SENHA),
        escopo,
        grupo,
        p.valores ?? false,
        p.carteira ?? 'todos',
        p.modulos ?? ['painel', 'rotina', 'clientes', 'firclinic', 'metas', 'campanhas', 'resumo', 'prospeccao', 'cadastros'],
        p.setor ?? null,
      ],
    )
  ).rows[0]!.id
  ugs[apelido] = id
  return id
}

const entrar = async (apelido: string): Promise<string> =>
  paresDe(
    cookies(await http().post('/v1/carteira/entrar').send({ usuario: `perf.${apelido}.${sufixo}`, senha: SENHA }).expect(200)),
  )

const mensalidadeNoBanco = async (id: string): Promise<string> =>
  (await migrate.query<{ m: string }>('SELECT mensalidade_centavos::text AS m FROM clientes_carteira WHERE id = $1', [id]))
    .rows[0]!.m

beforeAll(async () => {
  migrate = new pg.Client({ connectionString: URL_MIG })
  await migrate.connect()
  await declararAtorSistema(migrate)

  grupoA = (await migrate.query<{ id: string }>('INSERT INTO grupos (nome) VALUES ($1) RETURNING id', [`Perfis A ${sufixo}`]))
    .rows[0]!.id
  grupoB = (await migrate.query<{ id: string }>('INSERT INTO grupos (nome) VALUES ($1) RETURNING id', [`Perfis B ${sufixo}`]))
    .rows[0]!.id

  await criarUg('comvalores', 'grupo', grupoA, { valores: true })
  await criarUg('semvalores', 'grupo', grupoA, { valores: false })
  await criarUg('minha', 'grupo', grupoA, { carteira: 'minha' })
  await criarUg('umatela', 'grupo', grupoA, { modulos: ['clientes'] })
  await criarUg('outrogrupo', 'grupo', grupoB, { valores: true })
  // Escopo geral inserido sem `administrar`: o gatilho da 0050 dá a chave.
  await criarUg('diretora', 'geral', null)

  const cliente = async (grupo: string, nome: string, responsavel: string | null) =>
    (
      await migrate.query<{ id: string }>(
        `INSERT INTO clientes_carteira (grupo_id, nome, produto, status, mensalidade_centavos, responsavel_usuario_gestao_id)
         VALUES ($1, $2, 'Consultoria', 'onboarding', 250000, $3) RETURNING id`,
        [grupo, nome, responsavel],
      )
    ).rows[0]!.id
  clienteDaMinha = await cliente(grupoA, `Cliente da Minha ${sufixo}`, ugs['minha']!)
  clienteAlheio = await cliente(grupoA, `Cliente Alheio ${sufixo}`, ugs['comvalores']!)
  clienteB = await cliente(grupoB, `Cliente do B ${sufixo}`, null)

  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile()
  app = mod.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
  await registrarCookie(app)
  await app.init()
  await app.getHttpAdapter().getInstance().ready()

  for (const a of Object.keys(ugs)) cookie[a] = await entrar(a)
})

afterAll(async () => {
  await declararAtorSistema(migrate)
  const clientes = [clienteDaMinha, clienteAlheio, clienteB]
  const ids = Object.values(ugs)
  await migrate.query('DELETE FROM cobrancas_do_cliente_firmare WHERE cliente_carteira_id = ANY($1)', [clientes])
  await migrate.query('DELETE FROM clientes_carteira WHERE id = ANY($1)', [clientes])
  await migrate.query('DELETE FROM tentativas_de_carteira WHERE identificador LIKE $1', [`perf.%.${sufixo}`])
  await migrate.query('DELETE FROM sessoes_de_carteira WHERE usuario_gestao_id = ANY($1)', [ids])
  await migrate.query('DELETE FROM usuarios_gestao WHERE id = ANY($1)', [ids])
  await migrate.query('DELETE FROM grupos WHERE id = ANY($1)', [[grupoA, grupoB]])
  await migrate.end()
  await app.close()
})

describe('valores: a redação por perfil, no ponto único (A-2)', () => {
  it('quem tem `valores` vê a mensalidade', async () => {
    const r = await http().get(`/v1/carteira/clientes/${clienteAlheio}`).set('Cookie', cookie['comvalores']!).expect(200)
    expect(r.body.cliente.mensalidade).toBe('250000')
  })

  it('quem não tem `valores` recebe `null` na mensalidade e na seção Pagamento', async () => {
    const r = await http().get(`/v1/carteira/clientes/${clienteAlheio}`).set('Cookie', cookie['semvalores']!).expect(200)
    expect(r.body.cliente.mensalidade).toBeNull()
    expect(r.body.cliente.pagamentoDaMensalidade).toBeNull()
    expect(JSON.stringify(r.body)).not.toContain('250000')
  })

  it('revogar `valores` vale na requisição seguinte, sem novo login (caso de abuso 4)', async () => {
    const id = await criarUg('revogada', 'grupo', grupoA, { valores: true })
    const c = await entrar('revogada')
    const antes = await http().get(`/v1/carteira/clientes/${clienteAlheio}`).set('Cookie', c).expect(200)
    expect(antes.body.cliente.mensalidade).toBe('250000')
    await migrate.query('UPDATE usuarios_gestao SET valores = false WHERE id = $1', [id])
    const depois = await http().get(`/v1/carteira/clientes/${clienteAlheio}`).set('Cookie', c).expect(200)
    expect(depois.body.cliente.mensalidade).toBeNull()
  })
})

describe('escrita monetária exige `valores` (A-6)', () => {
  it('sem `valores`, PATCH com mensalidade é 403 e nada muda', async () => {
    await http()
      .patch(`/v1/carteira/clientes/${clienteAlheio}`)
      .set('Cookie', cookie['semvalores']!)
      .send({ mensalidade: '1' })
      .expect(403)
    expect(await mensalidadeNoBanco(clienteAlheio)).toBe('250000')
  })

  it('sem `valores`, o formulário reenviado com `mensalidade: null` também é 403 e não zera nada', async () => {
    await http()
      .patch(`/v1/carteira/clientes/${clienteAlheio}`)
      .set('Cookie', cookie['semvalores']!)
      .send({ nome: `Cliente Alheio ${sufixo}`, mensalidade: null })
      .expect(403)
    expect(await mensalidadeNoBanco(clienteAlheio)).toBe('250000')
  })

  it('com `valores`, o mesmo PATCH grava', async () => {
    const r = await http()
      .patch(`/v1/carteira/clientes/${clienteAlheio}`)
      .set('Cookie', cookie['comvalores']!)
      .send({ mensalidade: '260000' })
      .expect(200)
    expect(r.body.cliente.mensalidade).toBe('260000')
    expect(await mensalidadeNoBanco(clienteAlheio)).toBe('260000')
    await migrate.query('UPDATE clientes_carteira SET mensalidade_centavos = 250000 WHERE id = $1', [clienteAlheio])
  })
})

describe('"só a minha carteira" é filtro de servidor (A-3)', () => {
  it('a lista devolve só os clientes em que ela é a responsável', async () => {
    const r = await http().get('/v1/carteira/clientes').set('Cookie', cookie['minha']!).expect(200)
    const ids = (r.body.clientes as { id: string }[]).map((c) => c.id)
    expect(ids).toEqual([clienteDaMinha])
    expect(JSON.stringify(r.body)).not.toContain('Cliente Alheio')
  })

  it('quem vê todas recebe os dois clientes do grupo', async () => {
    const r = await http().get('/v1/carteira/clientes').set('Cookie', cookie['semvalores']!).expect(200)
    const ids = (r.body.clientes as { id: string }[]).map((c) => c.id)
    expect(ids).toEqual(expect.arrayContaining([clienteDaMinha, clienteAlheio]))
  })

  it('a ficha do cliente alheio é o MESMO 404 de um id que não existe', async () => {
    const alheio = await http().get(`/v1/carteira/clientes/${clienteAlheio}`).set('Cookie', cookie['minha']!)
    const inexistente = await http().get(`/v1/carteira/clientes/${ID_INEXISTENTE}`).set('Cookie', cookie['minha']!)
    expect(alheio.status).toBe(404)
    expect(inexistente.status).toBe(404)
    expect(alheio.body).toEqual(inexistente.body)
  })

  it('sub-recurso e query também passam pelo filtro: cobranças e reuniões do alheio são 404', async () => {
    await http().get(`/v1/carteira/cobrancas?clienteId=${clienteAlheio}`).set('Cookie', cookie['minha']!).expect(404)
    await http().get(`/v1/carteira/clientes/${clienteAlheio}/reunioes`).set('Cookie', cookie['minha']!).expect(404)
    await http().get(`/v1/carteira/clientes/${clienteDaMinha}/reunioes`).set('Cookie', cookie['minha']!).expect(200)
  })

  it('"minha" não troca responsável, nem para si mesma (caso de abuso 16)', async () => {
    await http()
      .patch(`/v1/carteira/clientes/${clienteDaMinha}`)
      .set('Cookie', cookie['minha']!)
      .send({ responsavelId: ugs['comvalores'] })
      .expect(403)
    await http()
      .patch(`/v1/carteira/clientes/${clienteAlheio}`)
      .set('Cookie', cookie['minha']!)
      .send({ responsavelId: ugs['minha'] })
      .expect(404)
    const r = await migrate.query<{ r: string }>(
      'SELECT responsavel_usuario_gestao_id AS r FROM clientes_carteira WHERE id = ANY($1) ORDER BY nome',
      [[clienteAlheio, clienteDaMinha]],
    )
    expect(r.rows.map((x) => x.r)).toEqual([ugs['comvalores'], ugs['minha']])
  })
})

describe('isolamento por grupo continua de pé', () => {
  it('o grupo B não lê nem lista o cliente do grupo A, mesmo com `valores` e todas as clientes', async () => {
    await http().get(`/v1/carteira/clientes/${clienteAlheio}`).set('Cookie', cookie['outrogrupo']!).expect(404)
    const r = await http().get('/v1/carteira/clientes').set('Cookie', cookie['outrogrupo']!).expect(200)
    const ids = (r.body.clientes as { id: string }[]).map((c) => c.id)
    expect(ids).toContain(clienteB)
    expect(ids).not.toContain(clienteAlheio)
    expect(ids).not.toContain(clienteDaMinha)
  })
})

describe('a tela da rota é autorização de servidor (A-4)', () => {
  it('sem o módulo, a rota responde 403; com ele, 200', async () => {
    await http().get('/v1/carteira/leads').set('Cookie', cookie['umatela']!).expect(403)
    await http().get('/v1/carteira/clientes').set('Cookie', cookie['umatela']!).expect(200)
    await http().get('/v1/carteira/leads').set('Cookie', cookie['semvalores']!).expect(200)
  })

  it('mensalidades exige `valores`: sem, 403 mesmo com todas as telas; com, 200', async () => {
    await http().get('/v1/carteira/cobrancas/painel').set('Cookie', cookie['semvalores']!).expect(403)
    await http().get('/v1/carteira/cobrancas/painel').set('Cookie', cookie['comvalores']!).expect(200)
  })

  it('a sessão (`GET /eu`) devolve o perfil relido do banco — a tela decide com a MESMA função', async () => {
    const eu = await http().get('/v1/carteira/eu').set('Cookie', cookie['umatela']!).expect(200)
    expect(eu.body.usuarioDeGestao).toMatchObject({ valores: false, carteira: 'todos', modulos: ['clientes'], administrar: false })
  })

  it('mudar `setor` não muda nenhuma decisão 200/403 (caso de abuso 8)', async () => {
    const rotas = ['/v1/carteira/clientes', '/v1/carteira/leads', '/v1/carteira/cobrancas/painel', `/v1/carteira/clientes/${clienteAlheio}`]
    const status = async () =>
      Promise.all(rotas.map(async (r) => (await http().get(r).set('Cookie', cookie['umatela']!)).status))
    const antes = await status()
    for (const setor of ['diretoria', 'comercial', 'financeiro', null]) {
      await migrate.query('UPDATE usuarios_gestao SET setor = $2 WHERE id = $1', [ugs['umatela'], setor])
      expect(await status()).toEqual(antes)
    }
  })
})

describe('`fir_carteira` não escreve o próprio privilégio (A-1, caso de abuso 1)', () => {
  it.each(['valores = true', "carteira = 'todos'", "modulos = '{painel}'", 'administrar = true', "setor = 'diretoria'"])(
    'UPDATE usuarios_gestao SET %s → permission denied',
    async (set) => {
      const c = new pg.Client({ connectionString: URL_CARTEIRA })
      await c.connect()
      try {
        await expect(c.query(`UPDATE usuarios_gestao SET ${set} WHERE id = $1`, [ugs['semvalores']])).rejects.toThrow(
          /permission denied/,
        )
      } finally {
        await c.end()
      }
    },
  )
})

describe('encerrar um cliente exige `carteira.administrar` (A-9, achado do 1A)', () => {
  const statusNoBanco = async (id: string) =>
    (await migrate.query<{ s: string }>('SELECT status AS s FROM clientes_carteira WHERE id = $1', [id])).rows[0]!.s

  it('sem a chave, encerrar é 403 e nada muda; com ela, encerra; reativar sem ela também é 403', async () => {
    await http()
      .patch(`/v1/carteira/clientes/${clienteAlheio}`)
      .set('Cookie', cookie['comvalores']!)
      .send({ status: 'encerrado' })
      .expect(403)
    expect(await statusNoBanco(clienteAlheio)).toBe('onboarding')

    await http()
      .patch(`/v1/carteira/clientes/${clienteAlheio}`)
      .set('Cookie', cookie['diretora']!)
      .send({ status: 'encerrado' })
      .expect(200)
    expect(await statusNoBanco(clienteAlheio)).toBe('encerrado')

    await http()
      .patch(`/v1/carteira/clientes/${clienteAlheio}`)
      .set('Cookie', cookie['comvalores']!)
      .send({ status: 'ativo' })
      .expect(403)
    expect(await statusNoBanco(clienteAlheio)).toBe('encerrado')

    await http()
      .patch(`/v1/carteira/clientes/${clienteAlheio}`)
      .set('Cookie', cookie['diretora']!)
      .send({ status: 'onboarding' })
      .expect(200)
    expect(await statusNoBanco(clienteAlheio)).toBe('onboarding')
  })

  it('mudar entre os outros status não pede a chave', async () => {
    await http()
      .patch(`/v1/carteira/clientes/${clienteDaMinha}`)
      .set('Cookie', cookie['comvalores']!)
      .send({ status: 'pausado' })
      .expect(200)
    await http()
      .patch(`/v1/carteira/clientes/${clienteDaMinha}`)
      .set('Cookie', cookie['comvalores']!)
      .send({ status: 'onboarding' })
      .expect(200)
  })
})

describe('"só a minha carteira" no painel de Mensalidades: linhas E totais (A-3)', () => {
  it('quem vê só a própria carteira (com valores) recebe só as cobranças e o MRR dos clientes dela', async () => {
    for (const [cliente, valor] of [
      [clienteDaMinha, 250000],
      [clienteAlheio, 990000],
    ] as const) {
      await migrate.query(
        `INSERT INTO cobrancas_do_cliente_firmare
           (cliente_carteira_id, grupo_id, competencia, mensalidade_centavos, valor_centavos, vencimento)
         VALUES ($1, $2, '2020-01-01', $3, $3, '2020-01-10')`,
        [cliente, grupoA, valor],
      )
    }
    await migrate.query('UPDATE usuarios_gestao SET valores = true WHERE id = $1', [ugs['minha']])
    try {
      const r = await http().get('/v1/carteira/cobrancas/painel?mes=2020-01').set('Cookie', cookie['minha']!).expect(200)
      expect((r.body.mensalidades as { clienteCarteiraId: string }[]).map((m) => m.clienteCarteiraId)).toEqual([clienteDaMinha])
      expect(r.body.totais.somaValor).toBe('250000')
      expect(r.body.recorrente.clientesComMensalidade).toBe(1)
      expect(r.body.recorrente.receita).toBe('250000')
      expect(JSON.stringify(r.body)).not.toContain('990000')

      const todas = await http().get('/v1/carteira/cobrancas/painel?mes=2020-01').set('Cookie', cookie['comvalores']!).expect(200)
      expect(todas.body.totais.somaValor).toBe('1240000')
    } finally {
      await migrate.query('UPDATE usuarios_gestao SET valores = false WHERE id = $1', [ugs['minha']])
    }
  })
})
