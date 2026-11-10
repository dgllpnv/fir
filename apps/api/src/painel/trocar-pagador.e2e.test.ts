import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify'
import { Test } from '@nestjs/testing'
import { randomBytes } from 'node:crypto'
import pg from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AppModule } from '../app.module'
import { hashDeSenha } from '../autenticacao/senha'
import { apagarClinicaDeTeste, apagarHistoricoGrupoDeTeste, apagarOperadorDeTeste, declararAtorSistema } from '../banco/limpeza-de-teste'
import { registrarCookie } from '../main'

/**
 * T8, "trocar pagador" (spec clinica-em-varios-grupos §8). Seam: HTTP da API
 * sobre Postgres real. Só o Operador; mensalidade nunca copiada.
 */
const URL_MIG = process.env['DATABASE_URL_MIGRATE'] ?? 'postgresql://fir_migrate:fir_local_dev@127.0.0.1:4832/fir'
const SENHA = 'quatro-pedras-no-caminho'
const sufixo = randomBytes(4).toString('hex')

let app: NestFastifyApplication
let m: pg.Client
let operador = ''
let painel = ''
let grupoPadrao = ''
let grupoX = ''
let clinica = ''
let outraClinica = ''
let clienteFirmare = ''
let clienteX = ''
let clienteOutra = ''
const http = () => request(app.getHttpServer())

const cookies = (r: { headers: Record<string, string> }): string[] => {
  const v = r.headers['set-cookie'] as unknown
  return Array.isArray(v) ? (v as string[]) : typeof v === 'string' ? [v] : []
}
const comoOperador = () => m.query(`SELECT set_config('app.pessoa_id', $1, false)`, [`operador:${operador}`])
const novaClinica = async (nome: string): Promise<string> => {
  await comoOperador()
  const id = (
    await m.query<{ id: string }>(`INSERT INTO clinicas (codigo, nome) VALUES ($1, $2) RETURNING id`, [`pg-${sufixo}-${nome}`, `Clinica ${nome}`])
  ).rows[0]!.id
  await declararAtorSistema(m)
  return id
}
const pagadores = async (c: string) =>
  (await m.query<{ id: string }>(`SELECT id FROM clientes_carteira WHERE clinica_id = $1 AND excluido_em IS NULL AND conta_na_receita`, [c])).rows.map((r) => r.id)
/** O MRR da clínica: soma, em inteiros, só do que conta na receita. */
const mrr = async (c: string): Promise<bigint> =>
  BigInt(
    (await m.query<{ s: string }>(
      `SELECT coalesce(sum(mensalidade_centavos), 0)::text AS s FROM clientes_carteira WHERE clinica_id = $1 AND excluido_em IS NULL AND conta_na_receita`,
      [c],
    )).rows[0]!.s,
  )
const trocar = (c: string, clienteId: string, motivo = 'combinado com o financeiro') =>
  http().post(`/v1/superadmin/clinicas/${c}/pagador`).set('Cookie', painel).send({ clienteId, motivo })

beforeAll(async () => {
  m = new pg.Client({ connectionString: URL_MIG })
  await m.connect()
  await declararAtorSistema(m)
  operador = (
    await m.query<{ id: string }>(`INSERT INTO operadores (usuario, nome, senha_hash) VALUES ($1, 'Dono', $2) RETURNING id`, [
      `pg.${sufixo}`,
      await hashDeSenha(SENHA),
    ])
  ).rows[0]!.id
  grupoPadrao = (await m.query<{ id: string }>(`SELECT id FROM grupos WHERE padrao`)).rows[0]!.id
  grupoX = (await m.query<{ id: string }>(`INSERT INTO grupos (nome) VALUES ($1) RETURNING id`, [`Grupo T8 ${sufixo}`])).rows[0]!.id
  clinica = await novaClinica('a')
  outraClinica = await novaClinica('b')

  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile()
  app = mod.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
  await registrarCookie(app)
  await app.init()
  await app.getHttpAdapter().getInstance().ready()
  painel = cookies(await http().post('/v1/superadmin/entrar').send({ usuario: `pg.${sufixo}`, senha: SENHA }).expect(200))
    .map((c) => c.split(';')[0]!)
    .join('; ')

  clienteFirmare = (await m.query<{ id: string }>(`SELECT id FROM clientes_carteira WHERE clinica_id = $1 AND grupo_id = $2`, [clinica, grupoPadrao])).rows[0]!.id
  clienteOutra = (await m.query<{ id: string }>(`SELECT id FROM clientes_carteira WHERE clinica_id = $1`, [outraClinica])).rows[0]!.id
  const add = await http().post(`/v1/superadmin/clinicas/${clinica}/grupos`).set('Cookie', painel).send({ grupoId: grupoX, motivo: 'rede parceira' }).expect(201)
  clienteX = add.body.clienteId
  // A mensalidade é lançada à mão, cliente a cliente: o do Firmare paga R$ 500,00; o do grupo X ainda é 0.
  await comoOperador()
  await m.query(`UPDATE clientes_carteira SET mensalidade_centavos = 50000 WHERE id = $1`, [clienteFirmare])
  await declararAtorSistema(m)
})

afterAll(async () => {
  await declararAtorSistema(m)
  await m.query('DELETE FROM clientes_carteira WHERE clinica_id = ANY($1)', [[clinica, outraClinica]])
  for (const c of [clinica, outraClinica]) await apagarHistoricoGrupoDeTeste(m, c)
  await m.query('DELETE FROM grupos WHERE id = $1', [grupoX])
  for (const c of [clinica, outraClinica]) await apagarClinicaDeTeste(m, c)
  await m.query('DELETE FROM sessoes_de_operador WHERE operador_id = $1', [operador])
  await m.query('DELETE FROM tentativas_de_operador WHERE identificador = $1', [`pg.${sufixo}`])
  await apagarOperadorDeTeste(m, operador)
  await m.end()
  await app.close()
})

describe('POST /v1/superadmin/clinicas/:id/pagador', () => {
  it('antes da troca: o Firmare paga, com R$ 500,00 de MRR', async () => {
    expect(await pagadores(clinica)).toEqual([clienteFirmare])
    expect(await mrr(clinica)).toBe(50000n)
  })

  it('sem sessão de operador, 404 e nada muda', async () => {
    await http().post(`/v1/superadmin/clinicas/${clinica}/pagador`).send({ clienteId: clienteX, motivo: 'tentativa sem sessão' }).expect(404)
    expect(await pagadores(clinica)).toEqual([clienteFirmare])
  })

  it('motivo curto é 400', async () => {
    await trocar(clinica, clienteX, 'ab').expect(400)
    expect(await pagadores(clinica)).toEqual([clienteFirmare])
  })

  it('cliente de outra clínica é recusado (409) e nada muda', async () => {
    const r = await trocar(clinica, clienteOutra).expect(409)
    expect(r.body.message).toMatch(/ativo desta clínica/)
    expect(await pagadores(clinica)).toEqual([clienteFirmare])
    expect(await pagadores(outraClinica)).toEqual([clienteOutra])
  })

  it('cliente inexistente é recusado (409)', async () => {
    await trocar(clinica, '00000000-0000-4000-8000-000000000001').expect(409)
    expect(await pagadores(clinica)).toEqual([clienteFirmare])
  })

  it('troca feliz: exatamente um pagador; o MRR muda só pela mensalidade do novo; nada é copiado', async () => {
    const r = await trocar(clinica, clienteX).expect(200)
    expect(r.body).toMatchObject({ pagadorId: clienteX, anteriorId: clienteFirmare, trocou: true })
    expect(r.body.aviso).toMatch(/mensalidade/i)
    expect(await pagadores(clinica)).toEqual([clienteX])
    expect(await mrr(clinica)).toBe(0n)
    const antigo = (await m.query<{ m: string }>(`SELECT mensalidade_centavos::text AS m FROM clientes_carteira WHERE id = $1`, [clienteFirmare])).rows[0]!.m
    expect(antigo).toBe('50000')

    // O dono lança a mensalidade do novo pagador à mão: só então o MRR a reflete.
    await comoOperador()
    await m.query(`UPDATE clientes_carteira SET mensalidade_centavos = 70000 WHERE id = $1`, [clienteX])
    await declararAtorSistema(m)
    expect(await mrr(clinica)).toBe(70000n)
  })

  it('a troca fica na auditoria do painel e no histórico do grupo, com ator e de -> para', async () => {
    const a = await m.query(
      `SELECT ator_tipo, ator_id, de, para, motivo FROM auditoria_do_painel WHERE entidade = 'clientes_carteira' AND entidade_id = $1 AND acao = 'alterou'`,
      [clienteX],
    )
    expect(a.rows).toHaveLength(1)
    expect(a.rows[0]).toMatchObject({ ator_tipo: 'operador', ator_id: operador, motivo: 'combinado com o financeiro' })
    expect(a.rows[0].de).toMatchObject({ pagador_id: clienteFirmare })
    expect(a.rows[0].para).toMatchObject({ pagador_id: clienteX })
    const h = await m.query(
      `SELECT grupo_anterior_id, grupo_novo_id, mudado_por, motivo FROM historico_grupo_da_clinica WHERE clinica_id = $1 AND motivo LIKE 'pagador trocado:%'`,
      [clinica],
    )
    expect(h.rows).toEqual([
      { grupo_anterior_id: grupoPadrao, grupo_novo_id: grupoX, mudado_por: operador, motivo: 'pagador trocado: combinado com o financeiro' },
    ])
  })

  it('trocar para quem já paga é idempotente: 200, trocou=false, nada novo na trilha', async () => {
    const r = await trocar(clinica, clienteX).expect(200)
    expect(r.body).toMatchObject({ pagadorId: clienteX, trocou: false })
    expect(await pagadores(clinica)).toEqual([clienteX])
    const a = await m.query(`SELECT 1 FROM auditoria_do_painel WHERE entidade = 'clientes_carteira' AND entidade_id = $1`, [clienteX])
    expect(a.rowCount).toBe(1)
    const h = await m.query(`SELECT 1 FROM historico_grupo_da_clinica WHERE clinica_id = $1 AND motivo LIKE 'pagador trocado:%'`, [clinica])
    expect(h.rowCount).toBe(1)
  })

  it('GET dos grupos mostra quem paga', async () => {
    const r = await http().get(`/v1/superadmin/clinicas/${clinica}/grupos`).set('Cookie', painel).expect(200)
    const paga = r.body.grupos.filter((g: { paga: boolean }) => g.paga)
    expect(paga).toHaveLength(1)
    expect(paga[0]).toMatchObject({ grupoId: grupoX, clienteId: clienteX })
  })

  it('remover o grupo que paga é 409 e a mensagem aponta para a troca; depois de trocar de volta, remove', async () => {
    const r = await http().post(`/v1/superadmin/clinicas/${clinica}/grupos/remover`).set('Cookie', painel).send({ grupoId: grupoX, motivo: 'saiu da rede' }).expect(409)
    expect(r.body.message).toMatch(/Troque o pagador/)
    await trocar(clinica, clienteFirmare).expect(200)
    expect(await pagadores(clinica)).toEqual([clienteFirmare])
    await http().post(`/v1/superadmin/clinicas/${clinica}/grupos/remover`).set('Cookie', painel).send({ grupoId: grupoX, motivo: 'saiu da rede' }).expect(204)
  })

  it('cliente encerrado (grupo removido) não pode ser o novo pagador', async () => {
    await trocar(clinica, clienteX).expect(409)
    expect(await pagadores(clinica)).toEqual([clienteFirmare])
  })
})
