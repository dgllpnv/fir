import type { PainelDeMetasSaida } from '@fir/contracts'
import { RelogioFixo } from '@fir/domain'
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify'
import { Test } from '@nestjs/testing'
import { randomBytes } from 'node:crypto'
import pg from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AppModule } from '../../app.module'
import { hashDeSenha } from '../../autenticacao/senha'
import { BancoService } from '../../banco/banco.service'
import {
  apagarClinicaDeTeste,
  apagarHistoricoGrupoDeTeste,
  declararAtorSistema,
  participarDoGrupoDeTeste,
} from '../../banco/limpeza-de-teste'
import { RELOGIO } from '../../comum/relogio'
import { registrarCookie } from '../../main'

/**
 * **Painel de metas com a clínica em 2 grupos (0068).** Seam: HTTP da API sobre
 * Postgres real.
 *
 * Cada grupo tem um Cliente Firmare da MESMA clínica, um deles com
 * `conta_na_receita`. O escopo `geral` lista a clínica UMA vez, e é o cliente
 * que paga; o escopo `grupo` continua vendo só o do seu grupo.
 *
 * O universo exato vem do filtro `?responsavel=` (todo cliente do teste tem o
 * mesmo responsável): outros arquivos rodando em paralelo não entram na conta.
 */
const URL_MIG =
  process.env['DATABASE_URL_MIGRATE'] ?? 'postgresql://fir_migrate:fir_local_dev@127.0.0.1:4832/fir'
const SENHA = 'quatro-pedras-no-caminho'
const sufixo = randomBytes(4).toString('hex')

let app: NestFastifyApplication
let migrate: pg.Client
let banco: BancoService
const grupos: string[] = []
const clinicas: string[] = []
const clientes: string[] = []
const usuarios: string[] = []
// Os nomes diferem de propósito: o que NÃO paga vem primeiro na ordem por nome,
// então "pegar o primeiro" erraria.
const ids = { g1: '', g2: '', geral: '', doG2: '', pagador: '', outro: '', clinica: '' }
const cookie = { geral: '', doG2: '' }

const http = () => request(app.getHttpServer())
const um = async (sql: string, p: unknown[]): Promise<string> => (await migrate.query<{ id: string }>(sql, p)).rows[0]!.id
const entrar = async (usuario: string): Promise<string> => {
  const r = await http().post('/v1/carteira/entrar').send({ usuario, senha: SENHA }).expect(200)
  const v = r.headers['set-cookie'] as unknown
  return (Array.isArray(v) ? (v as string[]) : [String(v)]).map((c) => c.split(';')[0]!).join('; ')
}
const painel = async (c: string, responsavel?: string): Promise<PainelDeMetasSaida> =>
  (await http().get(`/v1/carteira/metas/painel${responsavel ? `?responsavel=${responsavel}` : ''}`).set('cookie', c).expect(200))
    .body as PainelDeMetasSaida
/** Todos os clientes que o painel mostra, com meta ou sem. */
const listados = (p: PainelDeMetasSaida): string[] => [...p.clientes.map((x) => x.id), ...p.semMeta.map((x) => x.id)]

const novoGrupo = async (nome: string) => {
  const id = await um('INSERT INTO grupos (nome) VALUES ($1) RETURNING id', [`${nome} ${sufixo}`])
  grupos.push(id)
  return id
}
const novoUsuario = async (nome: string, escopo: 'geral' | 'grupo', grupo: string | null) => {
  const id = await um(
    `INSERT INTO usuarios_gestao (usuario, nome, senha_hash, escopo, grupo_id, valores, carteira, administrar)
     VALUES ($1, $2, $3, $4, $5, true, 'todos', false) RETURNING id`,
    [`${nome}.${sufixo}`, `${nome} ${sufixo}`, await hashDeSenha(SENHA), escopo, grupo],
  )
  usuarios.push(id)
  return id
}
const novoCliente = async (grupo: string, nome: string, conta: boolean, responsavel: string | null) => {
  await participarDoGrupoDeTeste(migrate, ids.clinica, grupo)
  const id = await um(
    `INSERT INTO clientes_carteira (grupo_id, clinica_id, nome, produto, status, conta_na_receita, responsavel_usuario_gestao_id)
     VALUES ($1, $2, $3, 'FIR Clinic', 'ativo', $4, $5) RETURNING id`,
    [grupo, ids.clinica, nome, conta, responsavel],
  )
  clientes.push(id)
  return id
}

beforeAll(async () => {
  migrate = new pg.Client({ connectionString: URL_MIG })
  await migrate.connect()
  await declararAtorSistema(migrate)
  banco = new BancoService()

  ids.g1 = await novoGrupo('Metas A')
  ids.g2 = await novoGrupo('Metas B')
  ids.geral = await novoUsuario('metas-geral', 'geral', null)
  ids.doG2 = await novoUsuario('metas-g2', 'grupo', ids.g2)
  ids.clinica = await um('INSERT INTO clinicas (codigo, nome) VALUES ($1, $2) RETURNING id', [`mt-${sufixo}`, `Clinica Metas ${sufixo}`])
  clinicas.push(ids.clinica)
  // O pagador está no grupo 1 e vem DEPOIS na ordem por nome; o outro, no grupo 2.
  ids.pagador = await novoCliente(ids.g1, `Zeta ${sufixo}`, true, ids.geral)
  ids.outro = await novoCliente(ids.g2, `Alfa ${sufixo}`, false, ids.geral)

  const mod = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(RELOGIO)
    .useValue(new RelogioFixo(new Date('2026-11-11T15:00:00Z')))
    .compile()
  app = mod.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
  await registrarCookie(app)
  await app.init()
  await app.getHttpAdapter().getInstance().ready()
  cookie.geral = await entrar(`metas-geral.${sufixo}`)
  cookie.doG2 = await entrar(`metas-g2.${sufixo}`)
})

afterAll(async () => {
  await declararAtorSistema(migrate)
  await migrate.query('DELETE FROM auditoria_da_carteira WHERE grupo_id = ANY($1)', [grupos])
  await migrate.query('DELETE FROM sessoes_de_carteira WHERE usuario_gestao_id = ANY($1)', [usuarios])
  await migrate.query('DELETE FROM tentativas_de_carteira WHERE identificador = ANY($1)', [
    ['metas-geral', 'metas-g2'].map((u) => `${u}.${sufixo}`),
  ])
  await migrate.query('DELETE FROM clientes_carteira WHERE id = ANY($1)', [clientes])
  await migrate.query('DELETE FROM usuarios_gestao WHERE id = ANY($1)', [usuarios])
  for (const c of clinicas) await apagarHistoricoGrupoDeTeste(migrate, c)
  await migrate.query('DELETE FROM grupos WHERE id = ANY($1)', [grupos])
  for (const c of clinicas) await apagarClinicaDeTeste(migrate, c)
  await migrate.end()
  await app.close()
  await banco.onModuleDestroy()
})

describe('painel de metas: a clínica em 2 grupos', () => {
  it('geral: lista a clínica UMA vez, e é o cliente que paga (que não é o primeiro por nome)', async () => {
    // Os DOIS têm o mesmo responsável: o filtro isola o teste sem esconder o duplicado.
    const p = await painel(cookie.geral, ids.geral)
    const doTeste = listados(p).filter((id) => [ids.pagador, ids.outro].includes(id))
    expect(doTeste).toEqual([ids.pagador])
  })

  it('geral: inverter quem paga inverte quem aparece, sempre um só', async () => {
    // Trocar o pagador é ação do Operador (gatilho de vínculos).
    const trocar = async (de: string, para: string) => {
      const op = (await migrate.query<{ id: string }>(`SELECT id FROM operadores WHERE usuario = 'participacao-de-teste'`)).rows[0]!.id
      await migrate.query('BEGIN')
      try {
        await migrate.query(`SELECT set_config('app.pessoa_id', $1, true)`, [`operador:${op}`])
        await migrate.query('UPDATE clientes_carteira SET conta_na_receita = false WHERE id = $1', [de])
        await migrate.query('UPDATE clientes_carteira SET conta_na_receita = true WHERE id = $1', [para])
        await migrate.query('COMMIT')
      } catch (e) {
        await migrate.query('ROLLBACK')
        throw e
      }
    }
    await trocar(ids.pagador, ids.outro)
    try {
      const p = await painel(cookie.geral, ids.geral)
      expect(listados(p).filter((id) => [ids.pagador, ids.outro].includes(id))).toEqual([ids.outro])
    } finally {
      await trocar(ids.outro, ids.pagador)
    }
  })

  it('grupo: o usuário do grupo 2 vê só o cliente do seu grupo, mesmo sendo o que não paga', async () => {
    const p = await painel(cookie.doG2)
    const meus = listados(p)
    expect(meus).toContain(ids.outro)
    expect(meus).not.toContain(ids.pagador)
  })
})
