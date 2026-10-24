import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * Achado da Task 9: o `ALTER DEFAULT PRIVILEGES` do bootstrap concede
 * SELECT/INSERT/UPDATE/DELETE a `fir_app` em TODA tabela que `fir_migrate`
 * criar — sem exceção. `clinicas` (raiz do tenancy, não pode ter RLS porque
 * escopá-la por app_clinica_id() seria circular) e `migrations_aplicadas`
 * nasceram graváveis pela API por esse caminho, e cada uma precisou de um
 * REVOKE explícito (0001_fundacao.sql e migrar.ts) para corrigir. Nada no
 * schema impede que a PRÓXIMA tabela sem RLS nasça gravável do mesmo jeito —
 * o REVOKE é lembrado por quem escreveu a migration, não garantido pelo
 * sistema. Este teste varre o catálogo em vez de confiar na memória: para
 * toda tabela do esquema `public` que não tem RLS habilitada, `fir_app` não
 * pode ter INSERT, UPDATE nem DELETE. Tabelas COM RLS ficam fora da varredura
 * de propósito — para elas a proteção é a policy, não a ausência de
 * privilégio, e é isso que `isolamento-de-clinica.test.ts` cobre.
 */
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

describe('nenhuma tabela sem RLS nasce gravável por fir_app', () => {
  it('fir_app não tem INSERT, UPDATE nem DELETE em tabela sem RLS', async () => {
    const r = await migrate.query<{ relname: string }>(
      `SELECT c.relname
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity
        ORDER BY c.relname`,
    )
    expect(r.rows.length, 'nenhuma tabela sem RLS encontrada — a varredura não verificou nada').toBeGreaterThan(0)

    for (const { relname } of r.rows) {
      const p = await migrate.query<{ ins: boolean; upd: boolean; del: boolean }>(
        `SELECT has_table_privilege('fir_app', $1, 'INSERT') AS ins,
                has_table_privilege('fir_app', $1, 'UPDATE') AS upd,
                has_table_privilege('fir_app', $1, 'DELETE') AS del`,
        [relname],
      )
      const priv = p.rows[0]!
      // Se isto falhar, a tabela nasceu gravável pelo ALTER DEFAULT PRIVILEGES
      // do bootstrap e ninguém fez o REVOKE que `clinicas` e
      // `migrations_aplicadas` precisaram. Ou a tabela ganha RLS, ou ganha o
      // REVOKE — nunca fica sem os dois.
      expect(priv.ins, `${relname} sem RLS: fir_app tem INSERT`).toBe(false)
      expect(priv.upd, `${relname} sem RLS: fir_app tem UPDATE`).toBe(false)
      expect(priv.del, `${relname} sem RLS: fir_app tem DELETE`).toBe(false)
    }
  })
})
