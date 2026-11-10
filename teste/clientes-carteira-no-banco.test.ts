import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  apagarClinicaDeTeste,
  apagarHistoricoGrupoDeTeste,
  declararAtorSistema,
  participarDoGrupoDeTeste,
} from '@fir/api/banco/limpeza-de-teste'

/**
 * `clientes_carteira` — migration 0026 (G2). ADRs 0011, 0012.
 *
 * Esta é a primeira tabela de negócio que a RLS da carteira protege de
 * verdade, e é aqui que a exigência da pendência P-12 vira prova: **um
 * Usuário de Gestão de um grupo NUNCA lê linha de outro grupo**, e
 * **revogar (desativar) bloqueia a próxima requisição** — não deste
 * arquivo (isso já está provado em `carteira-no-banco.test.ts`), mas o
 * isolamento por `grupo_id`, que só existe a partir desta tabela, é provado
 * aqui.
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

const codigo = `clicarteira-${Date.now()}`

async function conectarCarteira(): Promise<pg.Client> {
  const c = new pg.Client({ connectionString: URL_CARTEIRA })
  c.on('error', (e) => console.error('[clientes-carteira-no-banco] fir_carteira:', e.message))
  await c.connect()
  return c
}

beforeAll(async () => {
  migrate = new pg.Client({ connectionString: URL_MIG })
  migrate.on('error', (e) => console.error('[clientes-carteira-no-banco] migrate:', e.message))
  await migrate.connect()
  await declararAtorSistema(migrate)

  clinicaA = (
    await migrate.query<{ id: string }>(
      `INSERT INTO clinicas (codigo, nome) VALUES ($1, 'Clínica A') RETURNING id`,
      [`${codigo}-a`],
    )
  ).rows[0]!.id
  clinicaB = (
    await migrate.query<{ id: string }>(
      `INSERT INTO clinicas (codigo, nome) VALUES ($1, 'Clínica B') RETURNING id`,
      [`${codigo}-b`],
    )
  ).rows[0]!.id

  grupoA = (
    await migrate.query<{ id: string }>(`INSERT INTO grupos (nome) VALUES ('Grupo A') RETURNING id`)
  ).rows[0]!.id
  grupoB = (
    await migrate.query<{ id: string }>(`INSERT INTO grupos (nome) VALUES ('Grupo B') RETURNING id`)
  ).rows[0]!.id

  await participarDoGrupoDeTeste(migrate, clinicaA, grupoA)
  await participarDoGrupoDeTeste(migrate, clinicaB, grupoB)
  clienteA = (
    await migrate.query<{ id: string }>(
      `INSERT INTO clientes_carteira (grupo_id, clinica_id, nome, produto)
       VALUES ($1, $2, 'Clínica A', 'Acelerador FIR') RETURNING id`,
      [grupoA, clinicaA],
    )
  ).rows[0]!.id
  clienteB = (
    await migrate.query<{ id: string }>(
      `INSERT INTO clientes_carteira (grupo_id, clinica_id, nome, produto)
       VALUES ($1, $2, 'Clínica B', 'Gestão por Assinatura') RETURNING id`,
      [grupoB, clinicaB],
    )
  ).rows[0]!.id
})

afterAll(async () => {
  await declararAtorSistema(migrate)
  await migrate.query('DELETE FROM clientes_carteira WHERE id = ANY($1)', [[clienteA, clienteB]])
  await apagarHistoricoGrupoDeTeste(migrate, clinicaA)
  await apagarHistoricoGrupoDeTeste(migrate, clinicaB)
  await migrate.query('DELETE FROM grupos WHERE id = ANY($1)', [[grupoA, grupoB]])
  await apagarClinicaDeTeste(migrate, clinicaA)
  await apagarClinicaDeTeste(migrate, clinicaB)
  await migrate.end()
})

describe('P-12: isolamento por grupo é real, não só desenhado', () => {
  it('escopo=grupo, fixado em A, NUNCA vê a linha do grupo B', async () => {
    const c = await conectarCarteira()
    try {
      await c.query(`SELECT set_config('app.escopo', 'grupo', false)`)
      await c.query(`SELECT set_config('app.grupo_id', $1, false)`, [grupoA])
      const r = await c.query<{ id: string }>('SELECT id FROM clientes_carteira')
      expect(r.rows.map((x) => x.id)).toEqual([clienteA])
    } finally {
      await c.end()
    }
  })

  it('o mesmo vale pelo lado de B — não é coincidência de ordem', async () => {
    const c = await conectarCarteira()
    try {
      await c.query(`SELECT set_config('app.escopo', 'grupo', false)`)
      await c.query(`SELECT set_config('app.grupo_id', $1, false)`, [grupoB])
      const r = await c.query<{ id: string }>('SELECT id FROM clientes_carteira')
      expect(r.rows.map((x) => x.id)).toEqual([clienteB])
    } finally {
      await c.end()
    }
  })

  it('sem app.grupo_id nem escopo=geral fixados, o banco é VAZIO', async () => {
    const existem = await migrate.query<{ n: number }>('SELECT count(*)::int AS n FROM clientes_carteira')
    expect(existem.rows[0]!.n, 'não há cliente nenhum: o zero abaixo não provaria nada').toBeGreaterThan(0)

    const c = await conectarCarteira()
    try {
      const r = await c.query<{ n: number }>('SELECT count(*)::int AS n FROM clientes_carteira')
      expect(r.rows[0]!.n).toBe(0)
    } finally {
      await c.end()
    }
  })

  it('escopo=geral vê os dois grupos — é o superadmin operando a carteira', async () => {
    // escopo=geral enxerga a tabela INTEIRA, de propósito — inclusive linhas
    // de outros grupos criadas por outro arquivo de teste rodando em
    // paralelo. A prova aqui é que A e B (dois grupos DIFERENTES) aparecem
    // juntos, não que a tabela só tenha estas duas linhas.
    const c = await conectarCarteira()
    try {
      await c.query(`SELECT set_config('app.escopo', 'geral', false)`)
      const r = await c.query<{ id: string }>(
        'SELECT id FROM clientes_carteira WHERE id = ANY($1)',
        [[clienteA, clienteB]],
      )
      expect(r.rows.map((x) => x.id).sort()).toEqual([clienteA, clienteB].sort())
    } finally {
      await c.end()
    }
  })

  it('fixar grupo_id SEM declarar escopo=geral não abre a porta — só a cláusula OR importa', async () => {
    // Um bug clássico seria `app_escopo()` devolver algo truthy por acidente.
    // Aqui confirmamos que app.grupo_id sozinho, de um grupo QUE NÃO é o do
    // cliente, nunca vê nada — mesmo que a sessão nunca tenha fixado escopo.
    const c = await conectarCarteira()
    try {
      const grupoFantasma = '00000000-0000-0000-0000-000000000000'
      await c.query(`SELECT set_config('app.grupo_id', $1, false)`, [grupoFantasma])
      const r = await c.query<{ n: number }>('SELECT count(*)::int AS n FROM clientes_carteira')
      expect(r.rows[0]!.n).toBe(0)
    } finally {
      await c.end()
    }
  })
})

describe('invariantes de `clientes_carteira`', () => {
  it('uma clínica tem no máximo um Cliente Firmare POR GRUPO — UNIQUE (grupo_id, clinica_id)', async () => {
    await expect(
      migrate.query(
        `INSERT INTO clientes_carteira (grupo_id, clinica_id, nome, produto)
         VALUES ($1, $2, 'Duplicata', 'Consultoria')`,
        [grupoA, clinicaA],
      ),
    ).rejects.toThrow(/clientes_carteira_grupo_clinica_unico|duplicate key/)
  })

  it('status fora da lista é recusado', async () => {
    await expect(
      migrate.query(`UPDATE clientes_carteira SET status = 'cancelado' WHERE id = $1`, [clienteA]),
    ).rejects.toThrow(/clientes_carteira_status_check/)
  })

  it('fir_app não enxerga NADA — nem SELECT', async () => {
    const p = await migrate.query<{ sel: boolean; ins: boolean; upd: boolean; del: boolean }>(
      `SELECT has_table_privilege('fir_app', 'clientes_carteira', 'SELECT') AS sel,
              has_table_privilege('fir_app', 'clientes_carteira', 'INSERT') AS ins,
              has_table_privilege('fir_app', 'clientes_carteira', 'UPDATE') AS upd,
              has_table_privilege('fir_app', 'clientes_carteira', 'DELETE') AS del`,
    )
    expect(Object.values(p.rows[0]!)).toEqual([false, false, false, false])
  })
})

describe('a trilha universal alcança `clientes_carteira`', () => {
  it('grava ator_tipo=operador na auditoria DA CLÍNICA ligada', async () => {
    const operador = (
      await migrate.query<{ id: string }>(
        `INSERT INTO operadores (usuario, nome, senha_hash) VALUES ($1, 'Operador de teste', 'x') RETURNING id`,
        [`op.cc.${Date.now()}`.slice(0, 32)],
      )
    ).rows[0]!.id

    await migrate.query(`SELECT set_config('app.pessoa_id', 'operador:' || $1, false)`, [operador])
    await migrate.query(`UPDATE clientes_carteira SET status = 'ativo' WHERE id = $1`, [clienteA])

    const trilha = await migrate.query<{ ator_tipo: string; ator_id: string }>(
      `SELECT ator_tipo, ator_id FROM auditoria
        WHERE clinica_id = $1 ORDER BY em DESC, id DESC LIMIT 1`,
      [clinicaA],
    )
    expect(trilha.rows[0]).toEqual({ ator_tipo: 'operador', ator_id: operador })

    await declararAtorSistema(migrate)
    await migrate.query('DELETE FROM operadores WHERE id = $1', [operador])
  })
})
