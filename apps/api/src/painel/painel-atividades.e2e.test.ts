import { perfisPadrao } from '@fir/domain'
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify'
import { Test } from '@nestjs/testing'
import { randomBytes } from 'node:crypto'
import pg from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { AppModule } from '../app.module'
import { hashDeSenha } from '../autenticacao/senha'
import {
  apagarClinicaDeTeste,
  apagarOperadorDeTeste,
  declararAtorSistema,
} from '../banco/limpeza-de-teste'
import { registrarCookie } from '../main'

const URL_MIG =
  process.env['DATABASE_URL_MIGRATE'] ?? 'postgresql://fir_migrate:fir_local_dev@127.0.0.1:4832/fir'

const SENHA_OP = 'quatro-pedras-no-caminho'
const PROVISORIA = /^[a-z]+(-[a-z]+){3}$/

let app: NestFastifyApplication
let migrate: pg.Client
let operador: string
let painel: string
/** Toda clínica criada por este arquivo, para o `afterAll` desfazer. */
const criadas: string[] = []

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
const USUARIO_OP = `dono.${sufixo}`

const cookies = (r: { headers: Record<string, string> }): string[] => {
  const v = r.headers['set-cookie'] as unknown
  return Array.isArray(v) ? (v as string[]) : typeof v === 'string' ? [v] : []
}
const paresDe = (lista: string[]): string => lista.map((c) => c.split(';')[0]!).join('; ')

let proximo = 0
const novoCodigo = () => `pcl${sufixo}x${proximo++}`

const http = () => request(app.getHttpServer())

/** Toda chave do corpo, em qualquer profundidade. Para o teste do mínimo. */
const chavesProfundas = (v: unknown): string[] => {
  if (Array.isArray(v)) return v.flatMap(chavesProfundas)
  if (v !== null && typeof v === 'object') {
    return Object.entries(v).flatMap(([k, x]) => [k, ...chavesProfundas(x)])
  }
  return []
}

const criarClinica = (corpo: Record<string, unknown> = {}, cookie = painel) =>
  http()
    .post('/v1/superadmin/clinicas')
    .set('Cookie', cookie)
    .send({
      codigo: novoCodigo(),
      nome: 'Clínica Nova',
      fuso: 'America/Bahia',
      admin: { nome: 'Dra. Helena', usuario: 'helena' },
      ...corpo,
    })

/** Cria e registra para limpeza. Falha alto se a criação não deu 201. */
const criarClinicaOk = async (corpo: Record<string, unknown> = {}) => {
  const r = await criarClinica(corpo).expect(201)
  criadas.push(r.body.id)
  return r.body as {
    id: string
    codigo: string
    admin: { id: string; senhaProvisoria: string }
  }
}

beforeAll(async () => {
  migrate = new pg.Client({ connectionString: URL_MIG })
  await migrate.connect()
  await declararAtorSistema(migrate)

  operador = (
    await migrate.query<{ id: string }>(
      `INSERT INTO operadores (usuario, nome, senha_hash)
       VALUES ($1, 'Dono', $2) RETURNING id`,
      [USUARIO_OP, await hashDeSenha(SENHA_OP)],
    )
  ).rows[0]!.id

  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile()
  app = mod.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
  await registrarCookie(app)
  await app.init()
  await app.getHttpAdapter().getInstance().ready()

  painel = paresDe(
    cookies(
      await http()
        .post('/v1/superadmin/entrar')
        .send({ usuario: USUARIO_OP, senha: SENHA_OP })
        .expect(200),
    ),
  )
})

afterAll(async () => {
  await declararAtorSistema(migrate)
  for (const id of criadas) await apagarClinicaDeTeste(migrate, id)
  await migrate.query('DELETE FROM tentativas_de_operador WHERE identificador = $1', [USUARIO_OP])
  await apagarOperadorDeTeste(migrate, operador)
  await migrate.end()
  await app.close()
})


const atividades = (qs = '', cookie = painel) =>
  http().get(`/v1/superadmin/atividades${qs}`).set('Cookie', cookie)

describe('GET /v1/superadmin/atividades: o log da equipe, de todas as clínicas', () => {
  it('sem sessão do painel é 404 (a rota não confirma que existe)', async () => {
    await http().get('/v1/superadmin/atividades').expect(404)
  })

  it('lista o que o operador fez numa clínica, com quem e quando, e filtra por ela', async () => {
    const nova = await criarClinicaOk()
    const r = await atividades(`?clinicaId=${nova.id}`).expect(200)
    expect(r.body.itens.length).toBeGreaterThan(0)
    for (const a of r.body.itens) {
      expect(a.clinica.id).toBe(nova.id)
      expect(a.quem.tipo).toBe('superadmin')
      expect(a.quem.nome).toBe('Dono')
      expect(['criou', 'alterou', 'removeu', 'acessou']).toContain(a.acao)
    }
    // mais recente primeiro
    const ems = r.body.itens.map((a: { em: string }) => a.em)
    expect([...ems].sort().reverse()).toEqual(ems)
  })

  it('NUNCA entrega valor: nem de→para, nem a senha provisória (só nomes de campo)', async () => {
    const nova = await criarClinicaOk()
    const r = await atividades(`?clinicaId=${nova.id}`).expect(200)
    const chaves = new Set(chavesProfundas(r.body))
    for (const proibida of ['de', 'para', 'valor', 'senha_hash', 'senhaProvisoria']) {
      expect(chaves.has(proibida), `chave ${proibida} vazou`).toBe(false)
    }
    expect(JSON.stringify(r.body)).not.toContain(nova.admin.senhaProvisoria)
  })

  it('filtra por quem fez, por ação e por assunto', async () => {
    const nova = await criarClinicaOk()
    const base = `?clinicaId=${nova.id}`
    const equipe = await atividades(`${base}&quem=equipe`).expect(200)
    expect(equipe.body.itens).toEqual([])
    const so = await atividades(`${base}&quem=superadmin&acao=criou&assunto=pessoas`).expect(200)
    expect(so.body.itens.length).toBeGreaterThan(0)
    for (const a of so.body.itens) {
      expect([a.acao, a.assunto]).toEqual(['criou', 'pessoas'])
    }
  })

  it('autor da carteira e do portal aparecem com o tipo certo, e filtram', async () => {
    const nova = await criarClinicaOk()
    await declararAtorSistema(migrate)
    await migrate.query(
      `INSERT INTO auditoria (clinica_id, ator_tipo, ator_id, acao, entidade, entidade_id)
       VALUES ($1, 'usuario_gestao', gen_random_uuid(), 'acessou', 'uso_diario_cliente', '1'),
              ($1, 'usuario_portal', gen_random_uuid(), 'acessou', 'uso_diario_cliente', '2')`,
      [nova.id],
    )
    const c = await atividades(`?clinicaId=${nova.id}&quem=carteira`).expect(200)
    expect(c.body.itens.map((a: { quem: { tipo: string } }) => a.quem.tipo)).toEqual(['carteira'])
    const p = await atividades(`?clinicaId=${nova.id}&quem=portal`).expect(200)
    expect(p.body.itens.map((a: { quem: { tipo: string } }) => a.quem.tipo)).toEqual(['portal'])
    const todas = await atividades(`?clinicaId=${nova.id}`).expect(200)
    for (const a of todas.body.itens) expect(a.quem.tipo).toBeTruthy()
  })

  it('o período é por dia civil na clínica: hoje entra, o dia seguinte não', async () => {
    const nova = await criarClinicaOk()
    const hoje = new Date().toISOString().slice(0, 10)
    const amanha = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10)
    const dentro = await atividades(`?clinicaId=${nova.id}&de=${hoje}`).expect(200)
    expect(dentro.body.itens.length).toBeGreaterThan(0)
    const fora = await atividades(`?clinicaId=${nova.id}&de=${amanha}`).expect(200)
    expect(fora.body.itens).toEqual([])
  })

  it('filtro malformado é 400, parâmetro vazio é "sem filtro"', async () => {
    await atividades('?acao=apagou').expect(400)
    await atividades('?clinicaId=nao-e-uuid').expect(400)
    await atividades('?de=2026-02-31').expect(400)
    await atividades('?acao=&quem=').expect(200)
  })

  it('a paginação não perde nem repete linha, mesmo com muitas no MESMO instante', async () => {
    const nova = await criarClinicaOk()
    // 120 linhas com o mesmo `em`: a divisa de página cai no meio delas.
    await declararAtorSistema(migrate)
    await migrate.query(
      `INSERT INTO auditoria (clinica_id, em, ator_tipo, acao, entidade, entidade_id)
       SELECT $1, '2026-01-05T12:00:00Z', 'sistema', 'criou', 'teste_de_pagina', g::text
         FROM generate_series(1, 120) g`,
      [nova.id],
    )
    const total = (
      await migrate.query<{ n: number }>(
        'SELECT count(*)::int AS n FROM auditoria WHERE clinica_id = $1',
        [nova.id],
      )
    ).rows[0]!.n

    const vistas: string[] = []
    let cursor: string | null = null
    for (let i = 0; i < 20; i++) {
      const qs: string = `?clinicaId=${nova.id}` + (cursor ? `&antes=${encodeURIComponent(cursor)}` : '')
      const r = await atividades(qs).expect(200)
      vistas.push(...r.body.itens.map((a: { chave: string }) => a.chave))
      cursor = r.body.proximo
      if (!cursor) break
    }
    expect(cursor).toBeNull()
    expect(new Set(vistas).size).toBe(vistas.length)
    expect(vistas.length).toBe(total)
  })
})
