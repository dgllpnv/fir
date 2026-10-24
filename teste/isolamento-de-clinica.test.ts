import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ENTIDADES_COM_CLINICA } from './registro'

const URL_MIG =
  process.env['DATABASE_URL_MIGRATE'] ?? 'postgresql://fir_migrate:fir_local_dev@127.0.0.1:4832/fir'

let migrate: pg.Client

beforeAll(async () => {
  migrate = new pg.Client({ connectionString: URL_MIG })
  await migrate.connect()
})

afterAll(async () => {
  await migrate.end()
})

describe('toda tabela de negócio está protegida', () => {
  it('o registro cobre TODAS as tabelas com clinica_id — nenhuma escapa', async () => {
    const r = await migrate.query<{ tablename: string }>(
      `SELECT c.relname AS tablename
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         JOIN pg_attribute a ON a.attrelid = c.oid
        WHERE n.nspname = 'public' AND c.relkind = 'r'
          AND a.attname = 'clinica_id' AND NOT a.attisdropped`,
    )
    const noBanco = r.rows.map((x) => x.tablename).sort()
    // Se esta asserção falhar, alguém criou uma tabela com clinica_id e não a
    // registrou. Acrescente ao registro — e confira que ela tem RLS.
    expect(noBanco).toEqual([...ENTIDADES_COM_CLINICA].sort())
  })

  it('cada tabela registrada tem RLS habilitada E forçada', async () => {
    for (const t of ENTIDADES_COM_CLINICA) {
      const r = await migrate.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
        'SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = $1',
        [t],
      )
      expect(r.rows[0], `tabela ${t} não existe`).toBeDefined()
      expect(r.rows[0]!.relrowsecurity, `${t} sem RLS habilitada`).toBe(true)
      // FORCE para que nem o dono da tabela escape. Sem isto, um job rodando
      // como fir_migrate leria todas as clínicas sem perceber.
      expect(r.rows[0]!.relforcerowsecurity, `${t} sem RLS forçada`).toBe(true)
    }
  })

  it('cada tabela registrada tem policy com USING e WITH CHECK', async () => {
    for (const t of ENTIDADES_COM_CLINICA) {
      const r = await migrate.query<{ qual: string | null; with_check: string | null }>(
        'SELECT qual, with_check FROM pg_policies WHERE tablename = $1',
        [t],
      )
      expect(r.rows.length, `${t} sem policy`).toBeGreaterThan(0)
      const p = r.rows[0]!
      expect(p.qual, `${t}: policy sem USING`).toContain('app_clinica_id')
      // Sem WITH CHECK, a leitura é isolada mas a ESCRITA para outra clínica
      // passa — e é assim que se grava um paciente no tenant errado.
      expect(p.with_check, `${t}: policy sem WITH CHECK`).toContain('app_clinica_id')
    }
  })
})
