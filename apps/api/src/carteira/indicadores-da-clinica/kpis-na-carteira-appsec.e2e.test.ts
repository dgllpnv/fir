import type { IndicadoresDaClinicaNaCarteiraSaida } from '@fir/contracts'
import type { Relogio } from '@fir/domain'
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify'
import { Test } from '@nestjs/testing'
import { randomBytes } from 'node:crypto'
import pg from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { AppModule } from '../../app.module'
import { hashDeSenha } from '../../autenticacao/senha'
import { operadorIdDeFonteConfiavel } from '../../banco/ator'
import { BancoService } from '../../banco/banco.service'
import {
  apagarClinicaDeTeste,
  apagarHistoricoGrupoDeTeste,
  declararAtorSistema,
  participarDoGrupoDeTeste,
} from '../../banco/limpeza-de-teste'
import { registrarCookie } from '../../main'
import { PainelCarteiraService } from '../../painel/painel-carteira.service'
import { executarUsoDiarioCliente } from '../jobs/uso-diario-cliente'

/**
 * Revisão adversarial de appsec/LGPD do T10 (C5, C26, C28, C29, L-IN-18).
 * Cobre o que `kpis-na-carteira.e2e.test.ts` não cobre: o desvínculo REAL
 * (`removerGrupoDaClinica`, com o arquivo), o registro de acesso a cada
 * leitura e falhando fechado, a tela `firclinic` e a "minha carteira", o log
 * sem nome nem valor, os privilégios de todos os papéis e o CHECK de campanha.
 */
const URL_MIG = process.env['DATABASE_URL_MIGRATE'] ?? 'postgresql://fir_migrate:fir_local_dev@127.0.0.1:4832/fir'
const SENHA = 'quatro-pedras-no-caminho'
const sufixo = randomBytes(4).toString('hex')
const AGORA = new Date('2026-11-12T15:00:00.000Z')
const relogio: Relogio = { agora: () => AGORA }
const NOME_SECRETO = `Faturamento sigiloso ${sufixo}`

let app: NestFastifyApplication
let migrate: pg.Client
let banco: BancoService
let grupoA: string
let clinicaA: string
let clienteA: string
let kpiFin: string
const usuarios: string[] = []
const cookie: Record<string, string> = {}
const http = () => request(app.getHttpServer())

const novoUsuario = async (apelido: string, valores: boolean, carteira: 'todos' | 'minha', modulos: string[]) => {
  const usuario = `kpisapp.${apelido}.${sufixo}`
  const id = (
    await migrate.query<{ id: string }>(
      `INSERT INTO usuarios_gestao (usuario, nome, senha_hash, escopo, grupo_id, valores, carteira, modulos)
       VALUES ($1, 'Comercial', $2, 'grupo', $3, $4, $5, $6::text[]) RETURNING id`,
      [usuario, await hashDeSenha(SENHA), grupoA, valores, carteira, modulos],
    )
  ).rows[0]!.id
  usuarios.push(id)
  const r = await http().post('/v1/carteira/entrar').send({ usuario, senha: SENHA }).expect(200)
  const v = r.headers['set-cookie'] as unknown
  const lista = Array.isArray(v) ? (v as string[]) : typeof v === 'string' ? [v] : []
  cookie[apelido] = lista.map((c) => c.split(';')[0]!).join('; ')
}
const ler = (quem: string) =>
  http().get(`/v1/carteira/clientes/${clienteA}/indicadores-da-clinica`).set('Cookie', cookie[quem]!)
const acessos = async () =>
  Number(
    (
      await migrate.query<{ n: string }>(
        `SELECT count(*) AS n FROM auditoria WHERE clinica_id = $1 AND entidade = 'kpis_na_carteira' AND acao = 'acessou'`,
        [clinicaA],
      )
    ).rows[0]!.n,
  )

beforeAll(async () => {
  migrate = new pg.Client({ connectionString: URL_MIG })
  await migrate.connect()
  await migrate.query("SELECT pg_advisory_lock(hashtext('teste:jobs-da-carteira'))")
  await declararAtorSistema(migrate)
  banco = new BancoService()
  grupoA = (await migrate.query<{ id: string }>(`INSERT INTO grupos (nome) VALUES ($1) RETURNING id`, [`KPIs appsec ${sufixo}`])).rows[0]!.id
  clinicaA = (
    await migrate.query<{ id: string }>(`INSERT INTO clinicas (codigo, nome, fuso) VALUES ($1, 'A', 'America/Bahia') RETURNING id`, [
      `kpis-appsec-${sufixo}`,
    ])
  ).rows[0]!.id
  await participarDoGrupoDeTeste(migrate, clinicaA, grupoA)
  // conta_na_receita = false: o pagador não sai do grupo (PagadorNaoSaiDoGrupo).
  clienteA = (
    await migrate.query<{ id: string }>(
      `INSERT INTO clientes_carteira (grupo_id, clinica_id, nome, produto, status, conta_na_receita)
       VALUES ($1, $2, 'Clínica Sol', 'FIR Clinic', 'ativo', false) RETURNING id`,
      [grupoA, clinicaA],
    )
  ).rows[0]!.id
  const perfil = (
    await migrate.query<{ id: string }>(`INSERT INTO perfis (clinica_id, chave, nome, perms) VALUES ($1, 'pf_adm', 'Adm', '{}') RETURNING id`, [clinicaA])
  ).rows[0]!.id
  const pessoa = (
    await migrate.query<{ id: string }>(
      `INSERT INTO pessoas (clinica_id, nome, usuario, senha_hash, perfil_id, ativo) VALUES ($1, 'Helena', 'helena', 'x', $2, true) RETURNING id`,
      [clinicaA, perfil],
    )
  ).rows[0]!.id
  kpiFin = (
    await migrate.query<{ id: string }>(
      `INSERT INTO kpis (clinica_id, origem, nome, pilar, unidade, direcao, frequencia, dia_de_lancamento, como_medir)
       VALUES ($1, 'manual', $2, 'Financeiro', 'reais', 'maior', 'mensal', 1, 'x') RETURNING id`,
      [clinicaA, NOME_SECRETO],
    )
  ).rows[0]!.id
  await migrate.query(
    `INSERT INTO lancamentos_de_kpi (clinica_id, kpi_id, referencia, valor_centavos, lancado_por) VALUES ($1, $2, '2026-11-01', 8765431, $3)`,
    [clinicaA, kpiFin, pessoa],
  )
  await migrate.query(
    `INSERT INTO metas_de_kpi (clinica_id, kpi_id, tipo, inicio, prazo, alvo_centavos, partida_centavos)
     VALUES ($1, $2, 'mes', '2026-11-01', '2026-11-30', 9988771, 0)`,
    [clinicaA, kpiFin],
  )

  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile()
  app = mod.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
  await registrarCookie(app)
  await app.init()
  await app.getHttpAdapter().getInstance().ready()

  await novoUsuario('comvalores', true, 'todos', ['clientes', 'firclinic'])
  await novoUsuario('semvalores', false, 'todos', ['clientes', 'firclinic'])
  await novoUsuario('semfirclinic', true, 'todos', ['clientes', 'metas'])
  await novoUsuario('minha', true, 'minha', ['clientes', 'firclinic'])
}, 60_000)

afterAll(async () => {
  vi.restoreAllMocks()
  await declararAtorSistema(migrate)
  await migrate.query('DELETE FROM kpis_na_carteira WHERE cliente_carteira_id = $1', [clienteA])
  await migrate.query('DELETE FROM uso_diario_cliente WHERE cliente_carteira_id = $1', [clienteA])
  await migrate.query('DELETE FROM tarefas_internas WHERE cliente_carteira_id = $1', [clienteA])
  await migrate.query('DELETE FROM sessoes_de_carteira WHERE usuario_gestao_id = ANY($1)', [usuarios])
  await migrate.query('DELETE FROM tentativas_de_carteira WHERE identificador LIKE $1', [`kpisapp.%.${sufixo}`])
  await migrate.query('DELETE FROM usuarios_gestao WHERE id = ANY($1)', [usuarios])
  await migrate.query('DELETE FROM clientes_carteira WHERE id = $1', [clienteA])
  await apagarHistoricoGrupoDeTeste(migrate, clinicaA)
  await migrate.query('DELETE FROM grupos WHERE id = $1', [grupoA])
  await apagarClinicaDeTeste(migrate, clinicaA)
  await migrate.end()
  await app.close()
  await banco.onModuleDestroy()
})

describe('T10 appsec: log, tela, registro de acesso', () => {
  it('C29: o job e a leitura não levam nome de KPI nem valor a log nenhum', async () => {
    const capturado: string[] = []
    const cap = (...a: unknown[]) => void capturado.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '))
    const spies = [
      vi.spyOn(console, 'log').mockImplementation(cap),
      vi.spyOn(console, 'error').mockImplementation(cap),
      vi.spyOn(console, 'warn').mockImplementation(cap),
      vi.spyOn(console, 'info').mockImplementation(cap),
      vi.spyOn(console, 'debug').mockImplementation(cap),
    ]
    const r = await executarUsoDiarioCliente(banco, relogio, '2026-11-11', { clienteIds: [clienteA] })
    await ler('comvalores').expect(200)
    await ler('semvalores').expect(200)
    for (const s of spies) s.mockRestore()
    expect(r.falhasDosKpis).toEqual([])
    expect(r.kpisGravados).toBe(1)
    const tudo = capturado.join('\n') + JSON.stringify(r)
    expect(tudo).not.toContain(NOME_SECRETO)
    expect(tudo).not.toMatch(/8765431|9988771|87\.654,31|99\.887,71/)
  })

  it('C28: sem `valores`, nenhum centavo na resposta, em campo nenhum', async () => {
    const r = await ler('semvalores').expect(200)
    expect(JSON.stringify(r.body)).not.toMatch(/8765431|9988771/)
    const k = (r.body as IndicadoresDaClinicaNaCarteiraSaida).kpis[0]!
    expect(k.atual.emDinheiro).toBeNull()
    expect(k.alvo?.emDinheiro ?? null).toBeNull()
  })

  it('tela `firclinic` exigida (403) e "minha carteira" alheia dá 404', async () => {
    await ler('semfirclinic').expect(403)
    await ler('minha').expect(404)
  })

  it('ADR 0013 §7: TODA leitura grava uma linha de acesso', async () => {
    const antes = await acessos()
    for (let i = 0; i < 3; i++) await ler('comvalores').expect(200)
    expect(await acessos()).toBe(antes + 3)
  })

  it('registro de acesso falha fechado: sem a linha, nenhum KPI sai', async () => {
    const b = app.get(BancoService)
    const spy = vi.spyOn(b, 'naClinica').mockRejectedValueOnce(new Error('auditoria indisponível'))
    const r = await ler('comvalores')
    spy.mockRestore()
    expect(r.status).toBe(500)
    expect(JSON.stringify(r.body)).not.toContain(NOME_SECRETO)
    expect(JSON.stringify(r.body)).not.toMatch(/8765431/)
  })
})

describe('T10 appsec: banco', () => {
  it('0110: FORCE RLS, e nenhum papel (além do dono) com DELETE/TRUNCATE; fir_app sem nada', async () => {
    const t = (
      await migrate.query<{ rls: boolean; force: boolean; dono: string }>(
        `SELECT relrowsecurity AS rls, relforcerowsecurity AS force, pg_get_userbyid(relowner) AS dono
           FROM pg_class WHERE relname = 'kpis_na_carteira'`,
      )
    ).rows[0]!
    expect(t).toMatchObject({ rls: true, force: true })
    const comDelete = (
      await migrate.query<{ r: string }>(
        `SELECT rolname AS r FROM pg_roles
          WHERE rolname <> $1 AND NOT rolsuper AND rolname NOT LIKE 'pg\\_%'
            AND (has_table_privilege(oid, 'kpis_na_carteira', 'DELETE') OR has_table_privilege(oid, 'kpis_na_carteira', 'TRUNCATE'))`,
        [t.dono],
      )
    ).rows.map((x) => x.r)
    expect(comDelete).toEqual([])
    const leitores = (
      await migrate.query<{ r: string }>(
        `SELECT rolname AS r FROM pg_roles
          WHERE rolname <> $1 AND NOT rolsuper AND rolname NOT LIKE 'pg\\_%' AND rolcanlogin IS NOT NULL
            AND has_table_privilege(oid, 'kpis_na_carteira', 'SELECT') ORDER BY 1`,
        [t.dono],
      )
    ).rows.map((x) => x.r)
    expect(leitores).toEqual(['fir_carteira'])
  })

  it('ADR emenda §6: resultado_de_campanha recusa valor no banco', async () => {
    await expect(
      migrate.query(
        `INSERT INTO kpis_na_carteira (cliente_carteira_id, grupo_id, kpi_ref, dia, chave_catalogo, nome, pilar, unidade, valor_centavos)
         VALUES ($1, $2, gen_random_uuid(), '2026-11-01', 'resultado_de_campanha', 'x', 'Comercial', 'reais', 100)`,
        [clienteA, grupoA],
      ),
    ).rejects.toMatchObject({ code: '23514', constraint: 'kpis_na_carteira_sem_valor_onde_nao_atravessa' })
  })
})

describe('T10 appsec: desvínculo real (removerGrupoDaClinica)', () => {
  it('as linhas vão ao arquivo com o cliente, o grupo perde a leitura, e o job não grava mais', async () => {
    const op = (await migrate.query<{ id: string }>(`SELECT id FROM operadores WHERE usuario = 'participacao-de-teste'`)).rows[0]!.id
    await app.get(PainelCarteiraService).removerGrupoDaClinica(operadorIdDeFonteConfiavel(op), clinicaA, grupoA, 'fim do contrato')
    const arquivo = (await migrate.query<{ id: string }>('SELECT id FROM grupos WHERE arquivo')).rows[0]!.id
    const grupos = (await migrate.query<{ g: string }>('SELECT DISTINCT grupo_id AS g FROM kpis_na_carteira WHERE cliente_carteira_id = $1', [clienteA])).rows
    expect(grupos).toEqual([{ g: arquivo }])
    await ler('comvalores').expect(404)
    const n = await banco.nasTabelasDaCarteiraComEscopo('grupo', grupoA, async (c) =>
      Number((await c.query<{ n: string }>('SELECT count(*) AS n FROM kpis_na_carteira WHERE cliente_carteira_id = $1', [clienteA])).rows[0]!.n),
    )
    expect(n).toBe(0)
    const antes = Number((await migrate.query<{ n: string }>('SELECT count(*) AS n FROM kpis_na_carteira WHERE cliente_carteira_id = $1', [clienteA])).rows[0]!.n)
    const amanha: Relogio = { agora: () => new Date('2026-11-13T15:00:00.000Z') }
    await executarUsoDiarioCliente(banco, amanha, '2026-11-12', { clienteIds: [clienteA] })
    const depois = Number((await migrate.query<{ n: string }>('SELECT count(*) AS n FROM kpis_na_carteira WHERE cliente_carteira_id = $1', [clienteA])).rows[0]!.n)
    expect(depois).toBe(antes)
  })
})
