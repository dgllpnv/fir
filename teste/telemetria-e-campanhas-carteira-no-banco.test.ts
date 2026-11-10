import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  apagarClinicaDeTeste,
  apagarHistoricoGrupoDeTeste,
  declararAtorSistema,
  participarDoGrupoDeTeste,
} from '@fir/api/banco/limpeza-de-teste'

/**
 * `uso_diario_cliente` e `campanhas_carteira` — migration 0028 (G4). ADRs
 * 0011, 0012, 0013.
 *
 * Nenhuma das duas tem `clinica_id`, de propósito (ver comentário da
 * migration) — por isso ficam FORA de `isolamento-de-clinica.test.ts` e
 * `auditoria-inescapavel.test.ts`, e é este arquivo que prova o isolamento
 * por grupo delas, mesmo padrão de `clientes-carteira-no-banco.test.ts`.
 */
const URL_MIG =
  process.env['DATABASE_URL_MIGRATE'] ?? 'postgresql://fir_migrate:fir_local_dev@127.0.0.1:4832/fir'

const URL_CARTEIRA =
  process.env['DATABASE_URL_CARTEIRA'] ?? 'postgresql://fir_carteira:fir_local_dev@127.0.0.1:4832/fir'

let migrate: pg.Client
let clinicaA: string
let clinicaB: string
let grupoA: string
let grupoB: string
let clienteA: string
let clienteB: string

const codigo = `telcamp-${Date.now()}`

async function conectarCarteira(): Promise<pg.Client> {
  const c = new pg.Client({ connectionString: URL_CARTEIRA })
  c.on('error', (e) => console.error('[telemetria-e-campanhas] fir_carteira:', e.message))
  await c.connect()
  return c
}

beforeAll(async () => {
  migrate = new pg.Client({ connectionString: URL_MIG })
  migrate.on('error', (e) => console.error('[telemetria-e-campanhas] migrate:', e.message))
  await migrate.connect()
  await declararAtorSistema(migrate)

  clinicaA = (
    await migrate.query<{ id: string }>(
      `INSERT INTO clinicas (codigo, nome) VALUES ($1, 'Clínica telemetria A') RETURNING id`,
      [`${codigo}-a`],
    )
  ).rows[0]!.id
  clinicaB = (
    await migrate.query<{ id: string }>(
      `INSERT INTO clinicas (codigo, nome) VALUES ($1, 'Clínica telemetria B') RETURNING id`,
      [`${codigo}-b`],
    )
  ).rows[0]!.id

  grupoA = (
    await migrate.query<{ id: string }>(`INSERT INTO grupos (nome) VALUES ('Grupo Tel A') RETURNING id`)
  ).rows[0]!.id
  grupoB = (
    await migrate.query<{ id: string }>(`INSERT INTO grupos (nome) VALUES ('Grupo Tel B') RETURNING id`)
  ).rows[0]!.id

  await participarDoGrupoDeTeste(migrate, clinicaA, grupoA)
  await participarDoGrupoDeTeste(migrate, clinicaB, grupoB)
  clienteA = (
    await migrate.query<{ id: string }>(
      `INSERT INTO clientes_carteira (grupo_id, clinica_id, nome, produto)
       VALUES ($1, $2, 'Clínica telemetria A', 'Acelerador FIR') RETURNING id`,
      [grupoA, clinicaA],
    )
  ).rows[0]!.id
  clienteB = (
    await migrate.query<{ id: string }>(
      `INSERT INTO clientes_carteira (grupo_id, clinica_id, nome, produto)
       VALUES ($1, $2, 'Clínica telemetria B', 'Consultoria') RETURNING id`,
      [grupoB, clinicaB],
    )
  ).rows[0]!.id

  await migrate.query(
    `INSERT INTO uso_diario_cliente (cliente_carteira_id, grupo_id, dia, usuarios_ativos)
     VALUES ($1, $2, current_date, 3), ($3, $4, current_date, 5)`,
    [clienteA, grupoA, clienteB, grupoB],
  )
  await migrate.query(
    `INSERT INTO campanhas_carteira
       (cliente_carteira_id, grupo_id, origem, nome, periodo_inicio, periodo_fim, metrica, meta)
     VALUES
       ($1, $2, 'manual', 'Campanha A', current_date, current_date, 'receita', 100000),
       ($3, $4, 'manual', 'Campanha B', current_date, current_date, 'receita', 200000)`,
    [clienteA, grupoA, clienteB, grupoB],
  )
})

afterAll(async () => {
  await declararAtorSistema(migrate)
  await migrate.query('DELETE FROM campanhas_carteira WHERE cliente_carteira_id = ANY($1)', [
    [clienteA, clienteB],
  ])
  await migrate.query('DELETE FROM uso_diario_cliente WHERE cliente_carteira_id = ANY($1)', [
    [clienteA, clienteB],
  ])
  await migrate.query('DELETE FROM clientes_carteira WHERE id = ANY($1)', [[clienteA, clienteB]])
  await apagarHistoricoGrupoDeTeste(migrate, clinicaA)
  await apagarHistoricoGrupoDeTeste(migrate, clinicaB)
  await migrate.query('DELETE FROM grupos WHERE id = ANY($1)', [[grupoA, grupoB]])
  await apagarClinicaDeTeste(migrate, clinicaA)
  await apagarClinicaDeTeste(migrate, clinicaB)
  await migrate.end()
})

describe('fir_app nunca enxerga as duas tabelas', () => {
  it.each(['uso_diario_cliente', 'campanhas_carteira'])('%s: nem SELECT', async (t) => {
    const p = await migrate.query<{ sel: boolean; ins: boolean; upd: boolean; del: boolean }>(
      `SELECT has_table_privilege('fir_app', $1, 'SELECT') AS sel,
              has_table_privilege('fir_app', $1, 'INSERT') AS ins,
              has_table_privilege('fir_app', $1, 'UPDATE') AS upd,
              has_table_privilege('fir_app', $1, 'DELETE') AS del`,
      [t],
    )
    expect(Object.values(p.rows[0]!)).toEqual([false, false, false, false])
  })
})

describe('RLS por grupo é real nas duas tabelas', () => {
  it('uso_diario_cliente: grupo A não vê grupo B', async () => {
    const c = await conectarCarteira()
    try {
      await c.query(`SELECT set_config('app.escopo', 'grupo', false)`)
      await c.query(`SELECT set_config('app.grupo_id', $1, false)`, [grupoA])
      const r = await c.query<{ cliente_carteira_id: string }>(
        'SELECT cliente_carteira_id FROM uso_diario_cliente',
      )
      expect(r.rows.map((x) => x.cliente_carteira_id)).toEqual([clienteA])
    } finally {
      await c.end()
    }
  })

  it('campanhas_carteira: grupo B não vê grupo A', async () => {
    const c = await conectarCarteira()
    try {
      await c.query(`SELECT set_config('app.escopo', 'grupo', false)`)
      await c.query(`SELECT set_config('app.grupo_id', $1, false)`, [grupoB])
      const r = await c.query<{ nome: string }>('SELECT nome FROM campanhas_carteira')
      expect(r.rows.map((x) => x.nome)).toEqual(['Campanha B'])
    } finally {
      await c.end()
    }
  })

  it('escopo=geral vê as duas', async () => {
    const c = await conectarCarteira()
    try {
      await c.query(`SELECT set_config('app.escopo', 'geral', false)`)
      // Só os grupos DESTE arquivo: outros testes gravam campanhas no mesmo banco, e a
      // contagem global dependia de quem rodou antes.
      const r = await c.query<{ n: number }>(
        'SELECT count(*)::int AS n FROM campanhas_carteira WHERE grupo_id = ANY($1)',
        [[grupoA, grupoB]],
      )
      expect(r.rows[0]!.n).toBe(2)
    } finally {
      await c.end()
    }
  })

  it('sem sessão fixada, as duas ficam vazias', async () => {
    const c = await conectarCarteira()
    try {
      const u = await c.query<{ n: number }>('SELECT count(*)::int AS n FROM uso_diario_cliente')
      const cc = await c.query<{ n: number }>('SELECT count(*)::int AS n FROM campanhas_carteira')
      expect(u.rows[0]!.n).toBe(0)
      expect(cc.rows[0]!.n).toBe(0)
    } finally {
      await c.end()
    }
  })
})

describe('invariantes', () => {
  it('uso_diario_cliente é idempotente por (cliente, dia) — UNIQUE', async () => {
    await expect(
      migrate.query(
        `INSERT INTO uso_diario_cliente (cliente_carteira_id, grupo_id, dia)
         VALUES ($1, $2, current_date)`,
        [clienteA, grupoA],
      ),
    ).rejects.toThrow(/uso_diario_cliente_cliente_carteira_id_dia_key|duplicate key/)
  })

  it('campanhas_carteira: origem=sincronizada exige campanha_origem_id, e vice-versa', async () => {
    await expect(
      migrate.query(
        `INSERT INTO campanhas_carteira
           (cliente_carteira_id, grupo_id, origem, nome, periodo_inicio, periodo_fim, metrica, meta)
         VALUES ($1, $2, 'sincronizada', 'Sem origem', current_date, current_date, 'receita', 1000)`,
        [clienteA, grupoA],
      ),
    ).rejects.toThrow(/campanhas_carteira_origem_consistente/)
  })

  it('uso_diario_cliente: contagem negativa é recusada', async () => {
    await expect(
      migrate.query(
        `INSERT INTO uso_diario_cliente (cliente_carteira_id, grupo_id, dia, usuarios_ativos)
         VALUES ($1, $2, current_date + 1, -1)`,
        [clienteA, grupoA],
      ),
    ).rejects.toThrow(/usuarios_ativos_check|check/i)
  })
})
