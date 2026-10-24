import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify'
import { Test } from '@nestjs/testing'
import pg from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AppModule } from '../app.module'
import { registrarCookie } from '../main'
import { LimitePorOrigem } from './limite-por-origem'
import { hashDeSenha } from './senha'

const URL_MIG =
  process.env['DATABASE_URL_MIGRATE'] ?? 'postgresql://fir_migrate:fir_local_dev@127.0.0.1:4832/fir'

let app: NestFastifyApplication
let migrate: pg.Client
let clinica: string
const codigo = `e2e-${Date.now()}`

beforeAll(async () => {
  migrate = new pg.Client({ connectionString: URL_MIG })
  await migrate.connect()

  const c = await migrate.query<{ id: string }>(
    `INSERT INTO clinicas (codigo, nome) VALUES ($1, 'Clínica E2E') RETURNING id`,
    [codigo],
  )
  clinica = c.rows[0]!.id

  const p = await migrate.query<{ id: string }>(
    `INSERT INTO perfis (clinica_id, chave, nome, perms)
     VALUES ($1, 'pf_rec', 'Recepção', ARRAY['jornada','receber']) RETURNING id`,
    [clinica],
  )
  await migrate.query(
    `INSERT INTO pessoas (clinica_id, nome, email, senha_hash, perfil_id)
     VALUES ($1, 'Juliana', 'juliana@e2e.local', $2, $3)`,
    [clinica, await hashDeSenha('senha-de-teste'), p.rows[0]!.id],
  )
  // Duas contas A/B dedicadas ao teste de isolamento do limite de
  // tentativas — nunca usadas por outro teste, para que o teste não dependa
  // da ordem de execução dos demais.
  await migrate.query(
    `INSERT INTO pessoas (clinica_id, nome, email, senha_hash, perfil_id)
     VALUES ($1, 'Conta A', 'conta.a@e2e.local', $2, $3)`,
    [clinica, await hashDeSenha('senha-da-conta-a'), p.rows[0]!.id],
  )
  await migrate.query(
    `INSERT INTO pessoas (clinica_id, nome, email, senha_hash, perfil_id)
     VALUES ($1, 'Conta B', 'conta.b@e2e.local', $2, $3)`,
    [clinica, await hashDeSenha('senha-da-conta-b'), p.rows[0]!.id],
  )
  // Conta dedicada à medição de tempo (Rodada de correção 1): precisa
  // existir de verdade, com hash válido, para que o caminho "senha errada"
  // rode Argon2 de produção — comparado contra um e-mail que nunca existe.
  await migrate.query(
    `INSERT INTO pessoas (clinica_id, nome, email, senha_hash, perfil_id)
     VALUES ($1, 'Conta Tempo', 'conta.tempo.existe@e2e.local', $2, $3)`,
    [clinica, await hashDeSenha('senha-da-conta-tempo'), p.rows[0]!.id],
  )

  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile()
  app = mod.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
  await registrarCookie(app)
  await app.init()
  await app.getHttpAdapter().getInstance().ready()
})

afterAll(async () => {
  await migrate.query('DELETE FROM sessoes WHERE clinica_id = $1', [clinica])
  await migrate.query('DELETE FROM tentativas_login WHERE clinica_id = $1', [clinica])
  await migrate.query('DELETE FROM pessoas WHERE clinica_id = $1', [clinica])
  await migrate.query('DELETE FROM perfis WHERE clinica_id = $1', [clinica])
  await migrate.query('DELETE FROM clinicas WHERE id = $1', [clinica])
  await migrate.end()
  await app.close()
})

const entrar = (senha: string) =>
  request(app.getHttpServer())
    .post('/v1/entrar')
    .send({ clinica: codigo, email: 'juliana@e2e.local', senha })

/**
 * O tipo de `Response.headers` do supertest/superagent não reflete o
 * caso especial de `set-cookie` do Node (sempre um array, mesmo com um só
 * cookie) — a biblioteca o tipa como `string`. Esta função corrige o tipo
 * sem mudar o valor em tempo de execução.
 */
const cookieDaResposta = (r: { headers: Record<string, string> }): string[] => {
  const v = r.headers['set-cookie'] as unknown
  return Array.isArray(v) ? (v as string[]) : typeof v === 'string' ? [v] : []
}

describe('POST /v1/entrar', () => {
  it('sem sessão, /v1/eu responde 401', async () => {
    await request(app.getHttpServer()).get('/v1/eu').expect(401)
  })

  it('entra e devolve usuário, clínica e perfis', async () => {
    const r = await entrar('senha-de-teste').expect(200)
    expect(r.body.usuario.email).toBe('juliana@e2e.local')
    expect(r.body.clinica.codigo).toBe(codigo)
    expect(r.body.perfis[0].perms).toContain('jornada')
    expect(cookieDaResposta(r).join()).toMatch(/__Host-fir-sessao=/)
  })

  it('o cookie é HttpOnly, Secure, SameSite e de caminho raiz', async () => {
    const r = await entrar('senha-de-teste').expect(200)
    const cookie = cookieDaResposta(r).join()
    expect(cookie).toMatch(/HttpOnly/i)
    expect(cookie).toMatch(/Secure/i)
    expect(cookie).toMatch(/SameSite=Lax/i)
    expect(cookie).toMatch(/Path=\//)
  })

  it('a resposta NUNCA contém o hash da senha nem o token cru', async () => {
    const r = await entrar('senha-de-teste').expect(200)
    const texto = JSON.stringify(r.body)
    expect(texto).not.toMatch(/\$argon2id\$/)
    expect(texto).not.toMatch(/token/i)
  })

  it('senha errada responde 401 com a MESMA frase de e-mail inexistente', async () => {
    const a = await entrar('senha-errada').expect(401)
    const b = await request(app.getHttpServer())
      .post('/v1/entrar')
      .send({ clinica: codigo, email: 'ninguem@e2e.local', senha: 'senha-de-teste' })
      .expect(401)
    // Mensagens diferentes dizem ao atacante quais e-mails existem na clínica.
    expect(a.body.message).toBe(b.body.message)
  })

  it('com sessão, /v1/eu devolve usuário, clínica COMPLETA e perfis', async () => {
    const r = await entrar('senha-de-teste').expect(200)
    const cookie = cookieDaResposta(r)
    const eu = await request(app.getHttpServer()).get('/v1/eu').set('Cookie', cookie).expect(200)
    expect(eu.body.usuario.nome).toBe('Juliana')
    // Código e nome vêm preenchidos: a tela monta o cabeçalho com eles, e um
    // campo vazio aqui vira "Firmare" genérico em produção.
    expect(eu.body.clinica.codigo).toBe(codigo)
    expect(eu.body.clinica.nome).toBe('Clínica E2E')
    expect(eu.body.clinica.fuso).toBe('America/Bahia')
    expect(eu.body.perfis[0].chave).toBe('pf_rec')
  })

  it('sair revoga a sessão: o mesmo cookie passa a dar 401', async () => {
    const r = await entrar('senha-de-teste').expect(200)
    const cookie = cookieDaResposta(r)
    await request(app.getHttpServer()).post('/v1/sair').set('Cookie', cookie).expect(204)
    await request(app.getHttpServer()).get('/v1/eu').set('Cookie', cookie).expect(401)
  })

  it('cinco senhas erradas bloqueiam a sexta tentativa, mesmo com a senha certa', async () => {
    for (let i = 0; i < 5; i++) await entrar('senha-errada').expect(401)
    await entrar('senha-de-teste').expect(429)
  })

  it('o limite é por identificador: falhas na conta A não bloqueiam a conta B', async () => {
    const porConta = (email: string, senha: string) =>
      request(app.getHttpServer()).post('/v1/entrar').send({ clinica: codigo, email, senha })

    // Esgota o limite da conta A, isolada e nunca usada por outro teste.
    for (let i = 0; i < 5; i++) {
      await porConta('conta.a@e2e.local', 'senha-errada').expect(401)
    }
    await porConta('conta.a@e2e.local', 'senha-da-conta-a').expect(429)

    // A conta B, na MESMA clínica, nunca tentou entrar: a consulta de
    // `limiteExcedido` filtra por `identificador = $1`, então as falhas da
    // conta A não aparecem na janela de tentativas da conta B.
    await porConta('conta.b@e2e.local', 'senha-da-conta-b').expect(200)
  })

  /**
   * Rodada de correção 1: o relógio da resposta não pode dizer qual e-mail
   * existe. Medido contra a API viva ANTES da correção (hash falso):
   *
   *   existe@t.local      401 em 20 / 68 / 20 ms   (Argon2 roda)
   *   naoexiste@t.local   401 em  8 /  9 /  8 ms   (Argon2 não roda)
   *
   * Três a oito vezes mais rápido. Tempo é ruidoso (a primeira medição de
   * cada processo carrega o aquecimento do binding nativo do Argon2 — por
   * isso 5 medições por caminho e a MEDIANA, não a primeira nem a média).
   * Não afirmamos igualdade: só que o caminho sem pessoa custa pelo menos a
   * metade do caminho com pessoa real — suficiente para pegar a regressão
   * óbvia (hash falso removido), que reabriria a razão de 3x–8x medida acima.
   */
  it('o tempo de resposta não distingue e-mail inexistente de senha errada', async () => {
    const medir = async (email: string, senha: string): Promise<number> => {
      const tempos: number[] = []
      for (let i = 0; i < 5; i++) {
        const inicio = performance.now()
        await request(app.getHttpServer())
          .post('/v1/entrar')
          .send({ clinica: codigo, email, senha })
          .expect(401)
        tempos.push(performance.now() - inicio)
      }
      tempos.sort((a, b) => a - b)
      return tempos[2]! // mediana de 5
    }

    const medianaExiste = await medir('conta.tempo.existe@e2e.local', 'senha-errada-tempo')
    const medianaNaoExiste = await medir('conta.tempo.naoexiste@e2e.local', 'senha-de-teste')

    expect(medianaNaoExiste).toBeGreaterThanOrEqual(medianaExiste * 0.5)
  })

  /**
   * Correção final da branch, achado 3: o ORÁCULO DE CÓDIGO DE CLÍNICA.
   *
   * `clinicaPorCodigo` devolvia `null` e a função recusava antes de qualquer
   * Argon2 e sem gravar tentativa. Medido pelo revisor contra a API viva:
   *
   *   clínica existente     29,0 ms
   *   clínica inexistente    2,9 ms
   *
   * Dez vezes — uma requisição por código enumerava todos os tenants da
   * instalação, sem deixar rastro. O remédio é o mesmo do `HASH_FALSO`:
   * rodar a verificação de qualquer forma, pelo mesmo semáforo.
   *
   * Mesma disciplina de medição do teste de e-mail acima: 5 amostras e a
   * MEDIANA (a primeira de cada processo carrega o aquecimento do binding
   * nativo), e a asserção é de RAZÃO, não de igualdade — tempo é ruidoso.
   */
  it('o tempo de resposta não distingue clínica inexistente de clínica existente', async () => {
    const medir = async (clinicaCodigo: string): Promise<number> => {
      const tempos: number[] = []
      for (let i = 0; i < 5; i++) {
        const inicio = performance.now()
        await request(app.getHttpServer())
          .post('/v1/entrar')
          .send({
            clinica: clinicaCodigo,
            email: `ninguem-${i}@e2e.local`,
            senha: 'senha-qualquer-longa',
          })
          .expect(401)
        tempos.push(performance.now() - inicio)
      }
      tempos.sort((a, b) => a - b)
      return tempos[2]!
    }

    const medianaExiste = await medir(codigo)
    const medianaNaoExiste = await medir(`nao-existe-${Date.now()}`)

    // Sem a correção esta razão era ~0,1 (2,9 ms contra 29,0 ms).
    expect(medianaNaoExiste).toBeGreaterThanOrEqual(medianaExiste * 0.5)
  })
})

/**
 * O limite por ORIGEM, com um provedor de teto 3 em vez do teto de produção
 * (60 em 5 minutos): o que está sob teste é a rota devolver 429 com
 * `Retry-After`, não o valor do parâmetro — esse é medido em
 * `limite-por-origem.test.ts`.
 */
describe('POST /v1/entrar — limite por origem', () => {
  let appLimitado: NestFastifyApplication

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(LimitePorOrigem)
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

  it('mil e-mails distintos NÃO atravessam o limite: a quarta tentativa leva 429', async () => {
    const tentar = (i: number) =>
      request(appLimitado.getHttpServer())
        .post('/v1/entrar')
        .send({
          clinica: codigo,
          // E-mails DISTINTOS de propósito: é assim que o limite por
          // identificador (cinco falhas na mesma conta) é contornado, e é o
          // buraco que este limite tapa.
          email: `origem-${i}-${Date.now()}@e2e.local`,
          senha: 'senha-qualquer-longa',
        })

    await tentar(1).expect(401)
    await tentar(2).expect(401)
    await tentar(3).expect(401)
    const r = await tentar(4).expect(429)
    // `Retry-After` existe para o cliente não insistir às cegas — e para que
    // o navegador da recepção não entre em laço de nova tentativa.
    expect(Number(r.headers['retry-after'])).toBeGreaterThan(0)
  })
})
