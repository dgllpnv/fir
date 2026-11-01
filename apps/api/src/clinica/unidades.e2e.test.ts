import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify'
import { Test } from '@nestjs/testing'
import pg from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { AppModule } from '../app.module'
import { apagarClinicaDeTeste, declararAtorSistema } from '../banco/limpeza-de-teste'
import { registrarCookie } from '../main'
import { hashDeSenha } from '../autenticacao/senha'

/**
 * **`salvarUnidade`** — a última linha ⬜ do épico 2.
 *
 * A tabela nasceu completa na `0006`; faltava a rota. O que estes testes medem:
 *
 *  1. **Ler é de todos, escrever é `config`.** Escolher a unidade de um
 *     atendimento é parte de atender; criar unidade é configurar a clínica.
 *  2. **O nome único vem do ÍNDICE, pelo nome NORMALIZADO.** "Pituba" e
 *     "pituba" colidem — é o que o protótipo faz (`norm()`), e é o que impede
 *     a clínica de ficar com duas unidades e metade do caixa em cada.
 *  3. **O `PATCH` é parcial.** Desativar não apaga o endereço.
 *  4. **Desativar não é excluir** (regra 20): `pacientes`, `tarefas` e
 *     `recebimentos` apontam para a unidade.
 */
const URL_MIG =
  process.env['DATABASE_URL_MIGRATE'] ?? 'postgresql://fir_migrate:fir_local_dev@127.0.0.1:4832/fir'

const SENHA = 'montanha-de-vidro-aberta'

let app: NestFastifyApplication
let migrate: pg.Client
let clinica: string
let outraClinica: string
let unidadeDaOutra: string
const codigo = `uni-${Date.now()}`

const entrar = (usuario: string, senha: string, cod = codigo) =>
  request(app.getHttpServer()).post('/v1/entrar').send({ clinica: cod, usuario, senha })

const cookieDe = (r: { headers: Record<string, string> }): string[] => {
  const v = r.headers['set-cookie'] as unknown
  return Array.isArray(v) ? (v as string[]) : typeof v === 'string' ? [v] : []
}

let admin: string[]
let recepcao: string[]

const listar = (sessao: string[]) =>
  request(app.getHttpServer()).get('/v1/unidades').set('Cookie', sessao)

const criar = (sessao: string[], corpo: Record<string, unknown>) =>
  request(app.getHttpServer()).post('/v1/unidades').set('Cookie', sessao).send(corpo)

const editar = (sessao: string[], id: string, corpo: Record<string, unknown>) =>
  request(app.getHttpServer()).patch(`/v1/unidades/${id}`).set('Cookie', sessao).send(corpo)

beforeAll(async () => {
  migrate = new pg.Client({ connectionString: URL_MIG })
  await migrate.connect()
  await declararAtorSistema(migrate)

  const novaClinica = async (cod: string) =>
    (
      await migrate.query<{ id: string }>(
        `INSERT INTO clinicas (codigo, nome) VALUES ($1, 'Clínica das Unidades') RETURNING id`,
        [cod],
      )
    ).rows[0]!.id
  clinica = await novaClinica(codigo)
  outraClinica = await novaClinica(`${codigo}-b`)

  const perfil = (
    await migrate.query<{ id: string }>(
      `INSERT INTO perfis (clinica_id, chave, nome, perms)
       VALUES ($1, 'pf_rec', 'Recepção', ARRAY['jornada']) RETURNING id`,
      [clinica],
    )
  ).rows[0]!.id

  const hash = await hashDeSenha(SENHA)
  await migrate.query(
    `INSERT INTO pessoas (clinica_id, nome, usuario, senha_hash, admin)
     VALUES ($1, 'Helena Prado', 'helena', $2, true)`,
    [clinica, hash],
  )
  await migrate.query(
    `INSERT INTO pessoas (clinica_id, nome, usuario, senha_hash, perfil_id)
     VALUES ($1, 'Juliana', 'juliana', $2, $3)`,
    [clinica, hash, perfil],
  )
  unidadeDaOutra = (
    await migrate.query<{ id: string }>(
      `INSERT INTO unidades (clinica_id, nome) VALUES ($1, 'Unidade da Vizinha') RETURNING id`,
      [outraClinica],
    )
  ).rows[0]!.id

  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile()
  app = mod.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
  await registrarCookie(app)
  await app.init()
  await app.getHttpAdapter().getInstance().ready()

  admin = cookieDe(await entrar('helena', SENHA).expect(200))
  recepcao = cookieDe(await entrar('juliana', SENHA).expect(200))
})

afterAll(async () => {
  await apagarClinicaDeTeste(migrate, clinica)
  await apagarClinicaDeTeste(migrate, outraClinica)
  await migrate.end()
  await app.close()
})

beforeEach(async () => {
  await migrate.query('DELETE FROM unidades WHERE clinica_id = $1', [clinica])
})

describe('POST /v1/unidades', () => {
  it('cria com nome e endereço, e já aparece em GET /v1/unidades', async () => {
    const r = await criar(admin, { nome: 'Unidade Pituba', endereco: 'R. Alfa, 100' })
    expect(r.status).toBe(201)
    expect(r.body).toMatchObject({ nome: 'Unidade Pituba', endereco: 'R. Alfa, 100', ativa: true })

    const lista = await listar(admin).expect(200)
    expect((lista.body.unidades as { nome: string }[]).map((u) => u.nome)).toEqual([
      'Unidade Pituba',
    ])
  })

  it('o nome repetido é recusado pelo ÍNDICE, ignorando caixa e acento', async () => {
    await criar(admin, { nome: 'Unidade Pituba' }).expect(201)
    // `unidades_nome_unico` é sobre `normalizar_nome(nome)`: a recusa não vem
    // de um `SELECT` antes do `INSERT`, que perderia a corrida entre duas abas.
    const r = await criar(admin, { nome: 'unidade pítuba' })
    expect(r.status).toBe(409)
    expect(r.body.message).toContain('unidade pítuba')
  })

  it('nome vazio é 400, com a frase dela', async () => {
    const r = await criar(admin, { nome: '   ' })
    expect(r.status).toBe(400)
    expect(r.body.message).toContain('nome')
  })

  it('campo a mais é 400 — nunca ignorado em silêncio', async () => {
    await criar(admin, { nome: 'Unidade X', clinicaId: outraClinica }).expect(400)
  })

  it('LER é de todos; ESCREVER exige `config`', async () => {
    // A leitura sem permissão é deliberada: escolher a unidade de um
    // atendimento é parte de atender (`ClinicaController`, sem `@Exige`).
    await listar(recepcao).expect(200)
    await criar(recepcao, { nome: 'Unidade da Recepção' }).expect(403)
  })
})

describe('PATCH /v1/unidades/:id', () => {
  it('desativar NÃO apaga o endereço — o PATCH é parcial', async () => {
    const criada = await criar(admin, {
      nome: 'Unidade Itaigara',
      endereco: 'Av. Beta, 200',
    }).expect(201)

    const r = await editar(admin, criada.body.id as string, { ativa: false }).expect(200)
    expect(r.body).toMatchObject({
      nome: 'Unidade Itaigara',
      endereco: 'Av. Beta, 200',
      ativa: false,
    })
  })

  it('a unidade inativa CONTINUA existindo e é listada por último', async () => {
    const a = await criar(admin, { nome: 'Unidade Alfa' }).expect(201)
    await criar(admin, { nome: 'Unidade Zeta' }).expect(201)
    await editar(admin, a.body.id as string, { ativa: false }).expect(200)

    // Regra 20: desativar é um estado. `pacientes.unidade_id`,
    // `tarefas.unidade_id` e `recebimentos.unidade_id` apontam para ela, e
    // excluí-la apagaria o nome do histórico.
    const lista = await listar(admin).expect(200)
    expect((lista.body.unidades as { nome: string; ativa: boolean }[]).map((u) => u.nome)).toEqual([
      'Unidade Zeta',
      'Unidade Alfa',
    ])
  })

  it('renomear para um nome já usado é 409', async () => {
    await criar(admin, { nome: 'Unidade Alfa' }).expect(201)
    const b = await criar(admin, { nome: 'Unidade Beta' }).expect(201)
    await editar(admin, b.body.id as string, { nome: 'Unidade Alfa' }).expect(409)
  })

  it('a unidade da VIZINHA é 404, não 403 — ela não existe vista daqui', async () => {
    await editar(admin, unidadeDaOutra, { nome: 'Tomada' }).expect(404)
    // E nada foi escrito do outro lado.
    const l = await migrate.query<{ nome: string }>('SELECT nome FROM unidades WHERE id = $1', [
      unidadeDaOutra,
    ])
    expect(l.rows[0]!.nome).toBe('Unidade da Vizinha')
  })

  it('a escrita entra na TRILHA pelo trigger, com de → para', async () => {
    const criada = await criar(admin, { nome: 'Unidade Trilha' }).expect(201)
    await editar(admin, criada.body.id as string, { endereco: 'R. Nova, 1' }).expect(200)

    const t = await migrate.query<{ de: Record<string, unknown>; para: Record<string, unknown> }>(
      `SELECT de, para FROM auditoria
        WHERE clinica_id = $1 AND entidade = 'unidades' AND entidade_id = $2
        ORDER BY id DESC LIMIT 1`,
      [clinica, criada.body.id],
    )
    expect(t.rows[0]!.para['endereco']).toBe('R. Nova, 1')
    expect(t.rows[0]!.de['endereco']).toBe('')
  })
})
