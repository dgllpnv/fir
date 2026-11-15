import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify'
import { Test } from '@nestjs/testing'
import { randomBytes } from 'node:crypto'
import pg from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AppModule } from '../app.module'
import { hashDeSenha } from '../autenticacao/senha'
import { apagarClinicaDeTeste, apagarOperadorDeTeste, declararAtorSistema } from '../banco/limpeza-de-teste'
import { registrarCookie } from '../main'

/**
 * A clínica de quem JÁ É cliente (2026-11-15, caso real): criar o Fir de uma
 * clínica criava um segundo Cliente Firmare, vazio, ao lado do que tinha o
 * histórico — e não havia como juntar os dois.
 *
 *  - Corrigir: ligar o cliente que já existe à clínica encerra o automático
 *    (só se ele não tem histórico próprio) e leva o que o sistema gerou.
 *  - Prevenir: ao criar a clínica, escolher o cliente que já existe.
 */
const URL_MIG =
  process.env['DATABASE_URL_MIGRATE'] ?? 'postgresql://fir_migrate:fir_local_dev@127.0.0.1:4832/fir'
const SENHA_OP = 'quatro-pedras-no-caminho'

let app: NestFastifyApplication
let migrate: pg.Client
let operador: string
let painel: string
let firmare: string
let arquivo: string

const sufixo = randomBytes(4).toString('hex')
const USUARIO_OP = `dono.${sufixo}`
const clinicas: string[] = []
const clientes: string[] = []

const cookies = (r: { headers: Record<string, string> }): string[] => {
  const v = r.headers['set-cookie'] as unknown
  return Array.isArray(v) ? (v as string[]) : typeof v === 'string' ? [v] : []
}
const http = () => request(app.getHttpServer())
let seq = 0

const criarClinica = (extra: Record<string, unknown> = {}) =>
  http()
    .post('/v1/superadmin/clinicas')
    .set('Cookie', painel)
    .send({
      codigo: `existente-${sufixo}-${++seq}`,
      nome: `Clínica Existente ${seq}`,
      fuso: 'America/Bahia',
      admin: { nome: 'Dra. Teste', usuario: 'teste' },
      ...extra,
    })

/** Um Cliente Firmare antigo, SEM clínica, como os da carteira de antes do Fir. */
const clienteSemClinica = async (nome: string): Promise<string> => {
  const id = (
    await migrate.query<{ id: string }>(
      `INSERT INTO clientes_carteira (grupo_id, nome, produto, status)
       VALUES ($1, $2, 'Gestão por Assinatura', 'ativo') RETURNING id`,
      [firmare, nome],
    )
  ).rows[0]!.id
  clientes.push(id)
  return id
}

const automaticoDa = async (clinicaId: string): Promise<string> =>
  (
    await migrate.query<{ id: string }>(
      'SELECT id FROM clientes_carteira WHERE clinica_id = $1 AND excluido_em IS NULL',
      [clinicaId],
    )
  ).rows[0]!.id

beforeAll(async () => {
  migrate = new pg.Client({ connectionString: URL_MIG })
  await migrate.connect()
  await declararAtorSistema(migrate)
  operador = (
    await migrate.query<{ id: string }>(
      `INSERT INTO operadores (usuario, nome, senha_hash) VALUES ($1, 'Dono', $2) RETURNING id`,
      [USUARIO_OP, await hashDeSenha(SENHA_OP)],
    )
  ).rows[0]!.id
  firmare = (await migrate.query<{ id: string }>('SELECT id FROM grupos WHERE padrao')).rows[0]!.id
  arquivo = (await migrate.query<{ id: string }>('SELECT id FROM grupos WHERE arquivo')).rows[0]!.id

  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile()
  app = mod.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
  await registrarCookie(app)
  await app.init()
  await app.getHttpAdapter().getInstance().ready()
  painel = cookies(
    await http().post('/v1/superadmin/entrar').send({ usuario: USUARIO_OP, senha: SENHA_OP }).expect(200),
  )
    .map((c) => c.split(';')[0]!)
    .join('; ')
})

afterAll(async () => {
  await declararAtorSistema(migrate)
  const todos = [
    ...clientes,
    ...(
      await migrate.query<{ id: string }>('SELECT id FROM clientes_carteira WHERE clinica_id = ANY($1)', [clinicas])
    ).rows.map((r) => r.id),
  ]
  await migrate.query('DELETE FROM indicadores_carteira WHERE cliente_carteira_id = ANY($1)', [todos])
  await migrate.query('DELETE FROM sincronizacao_campanhas_carteira WHERE cliente_carteira_id = ANY($1)', [todos])
  await migrate.query('DELETE FROM uso_diario_cliente WHERE cliente_carteira_id = ANY($1)', [todos])
  for (const c of clinicas) await apagarClinicaDeTeste(migrate, c)
  await migrate.query('DELETE FROM clientes_carteira WHERE id = ANY($1)', [clientes])
  await migrate.query('DELETE FROM tentativas_de_operador WHERE identificador = $1', [USUARIO_OP])
  await apagarOperadorDeTeste(migrate, operador)
  await migrate.end()
  await app.close()
})

describe('ligar à clínica o cliente que já existe (corrige o duplicado)', () => {
  it('encerra o automático, leva o uso diário e a sincronização, e deixa a trilha com o motivo', async () => {
    const criada = await criarClinica().expect(201)
    const clinicaId = criada.body.clinica?.id ?? criada.body.id
    clinicas.push(clinicaId)
    const automatico = await automaticoDa(clinicaId)
    await migrate.query(
      `INSERT INTO uso_diario_cliente (cliente_carteira_id, grupo_id, dia) VALUES ($1, $2, '2026-11-14')`,
      [automatico, firmare],
    )
    await migrate.query(
      `INSERT INTO sincronizacao_campanhas_carteira (cliente_carteira_id, grupo_id, sincronizado_em) VALUES ($1, $2, now())`,
      [automatico, firmare],
    )
    const antigo = await clienteSemClinica(`Cliente Antigo ${sufixo}`)

    const r = await http()
      .patch(`/v1/superadmin/clientes-carteira/${antigo}`)
      .set('Cookie', painel)
      .send({ clinicaId, motivo: 'já era cliente' })
      .expect(200)
    expect(r.body.cliente).toMatchObject({ id: antigo, clinicaId })

    const dup = (
      await migrate.query<{ excluido_em: Date | null; grupo_id: string; conta_na_receita: boolean; status: string }>(
        'SELECT excluido_em, grupo_id, conta_na_receita, status FROM clientes_carteira WHERE id = $1',
        [automatico],
      )
    ).rows[0]!
    expect(dup.excluido_em).not.toBeNull()
    expect(dup.grupo_id).toBe(arquivo)
    expect(dup.conta_na_receita).toBe(false)
    expect(dup.status).toBe('encerrado')

    const uso = await migrate.query('SELECT 1 FROM uso_diario_cliente WHERE cliente_carteira_id = $1', [antigo])
    expect(uso.rowCount).toBe(1)
    const sinc = await migrate.query('SELECT 1 FROM sincronizacao_campanhas_carteira WHERE cliente_carteira_id = $1', [antigo])
    expect(sinc.rowCount).toBe(1)

    const ativos = await migrate.query(
      'SELECT id FROM clientes_carteira WHERE clinica_id = $1 AND excluido_em IS NULL',
      [clinicaId],
    )
    expect(ativos.rows.map((x) => x.id)).toEqual([antigo])

    const trilha = await migrate.query(
      `SELECT motivo FROM auditoria_do_painel WHERE entidade = 'clientes_carteira' AND entidade_id = $1 AND ator_id = $2`,
      [automatico, operador],
    )
    expect(trilha.rows.map((x) => x.motivo)).toContain('já era cliente')
  })

  it('se o cliente da clínica já tem histórico próprio, é 409 e nada muda', async () => {
    const criada = await criarClinica().expect(201)
    const clinicaId = criada.body.clinica?.id ?? criada.body.id
    clinicas.push(clinicaId)
    const automatico = await automaticoDa(clinicaId)
    await migrate.query(
      `INSERT INTO indicadores_carteira (cliente_carteira_id, grupo_id, nome, unidade, sentido)
       VALUES ($1, $2, 'Faturamento', 'R$', 'maior_melhor')`,
      [automatico, firmare],
    )
    const antigo = await clienteSemClinica(`Cliente Com Conflito ${sufixo}`)

    await http()
      .patch(`/v1/superadmin/clientes-carteira/${antigo}`)
      .set('Cookie', painel)
      .send({ clinicaId, motivo: 'tentativa' })
      .expect(409)

    expect(await automaticoDa(clinicaId)).toBe(automatico)
    const a = await migrate.query<{ clinica_id: string | null }>('SELECT clinica_id FROM clientes_carteira WHERE id = $1', [antigo])
    expect(a.rows[0]!.clinica_id).toBeNull()
  })
})

describe('criar a clínica de quem já é cliente (previne o duplicado)', () => {
  it('liga a clínica nova ao cliente escolhido, sem criar outro', async () => {
    const antigo = await clienteSemClinica(`Cliente Escolhido ${sufixo}`)
    const criada = await criarClinica({ clienteCarteiraId: antigo }).expect(201)
    const clinicaId = criada.body.clinica?.id ?? criada.body.id
    clinicas.push(clinicaId)

    const todos = await migrate.query('SELECT id FROM clientes_carteira WHERE clinica_id = $1', [clinicaId])
    expect(todos.rows.map((x) => x.id)).toEqual([antigo])
  })

  it('cliente que já tem clínica é 409, e a clínica não é criada', async () => {
    const outra = await criarClinica().expect(201)
    const outraId = outra.body.clinica?.id ?? outra.body.id
    clinicas.push(outraId)
    const jaLigado = await automaticoDa(outraId)
    const codigo = `existente-${sufixo}-recusada`

    await criarClinica({ codigo, clienteCarteiraId: jaLigado }).expect(409)
    const r = await migrate.query('SELECT 1 FROM clinicas WHERE codigo = $1', [codigo])
    expect(r.rowCount).toBe(0)
  })

  it('a lista do painel oferece só os clientes sem clínica', async () => {
    const livre = await clienteSemClinica(`Cliente Livre ${sufixo}`)
    const l = await http().get('/v1/superadmin/clientes-carteira').set('Cookie', painel).expect(200)
    const achado = l.body.clientes.find((c: { id: string }) => c.id === livre)
    expect(achado).toMatchObject({ clinicaId: null })
  })
})
