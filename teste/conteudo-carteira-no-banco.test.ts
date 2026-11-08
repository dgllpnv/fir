import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ENTIDADES_GLOBAIS_DA_CARTEIRA } from './registro'

/**
 * **G8 1B — as tabelas GLOBAIS da Firmare (appsec A-19) e o que a 0048
 * mudou nas tabelas de conteúdo lidas pelo portal.**
 *
 * Tabela global não tem `clinica_id` nem `grupo_id`, então nenhuma varredura
 * de tenant a enxerga (`isolamento-de-clinica.test.ts` busca a coluna). Este
 * arquivo é a varredura delas: lê o catálogo, nunca confia no texto da
 * migration.
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

describe('tabelas globais da carteira (A-19)', () => {
  it('o registro não está vazio — senão a varredura não examina nada', () => {
    expect(ENTIDADES_GLOBAIS_DA_CARTEIRA.length).toBeGreaterThan(0)
  })

  it.each(ENTIDADES_GLOBAIS_DA_CARTEIRA)('%s: RLS habilitada e forçada', async (t) => {
    const r = await migrate.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `SELECT c.relrowsecurity, c.relforcerowsecurity
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = $1`,
      [t],
    )
    expect(r.rows[0], `${t} não existe`).toEqual({ relrowsecurity: true, relforcerowsecurity: true })
  })

  it.each(ENTIDADES_GLOBAIS_DA_CARTEIRA)('%s: toda policy tem TO explícito, e nenhuma vale para PUBLIC', async (t) => {
    const r = await migrate.query<{ policyname: string; roles: string[] }>(
      `SELECT policyname, roles::text[] AS roles FROM pg_policies WHERE schemaname = 'public' AND tablename = $1`,
      [t],
    )
    expect(r.rows.length, `${t} sem policy`).toBeGreaterThan(0)
    for (const p of r.rows) expect(p.roles, `${t}: ${p.policyname}`).not.toContain('public')
  })

  it.each(ENTIDADES_GLOBAIS_DA_CARTEIRA)('%s: toda policy de escrita exige escopo geral, sem OR', async (t) => {
    const r = await migrate.query<{ policyname: string; cmd: string; qual: string | null; with_check: string | null }>(
      `SELECT policyname, cmd, qual, with_check FROM pg_policies WHERE schemaname = 'public' AND tablename = $1`,
      [t],
    )
    for (const p of r.rows.filter((x) => x.cmd !== 'SELECT')) {
      expect(p.with_check, `${t}: ${p.policyname} sem WITH CHECK de escopo`).toContain("app_escopo() = 'geral'")
      expect(p.with_check?.toUpperCase()).not.toMatch(/\bOR\b/)
      if (p.qual !== null) {
        expect(p.qual, `${t}: ${p.policyname}`).toContain("app_escopo() = 'geral'")
        expect(p.qual.toUpperCase()).not.toMatch(/\bOR\b/)
      }
    }
  })

  // G8 3D (0059): o portal passou a LER a biblioteca geral — SELECT por coluna,
  // nunca de tabela, e nenhum verbo de escrita (appsec A-18, caso 58). As
  // demais globais continuam sem nada para `fir_portal`.
  const LIDAS_PELO_PORTAL = new Set(['materiais_da_biblioteca'])

  it.each(ENTIDADES_GLOBAIS_DA_CARTEIRA)('%s: fir_app não alcança, fir_carteira não apaga, fir_portal no máximo LÊ por coluna', async (t) => {
    const p = await migrate.query<{ app: boolean; del: boolean; escreve: boolean; tabela: boolean; colunas: boolean }>(
      `SELECT has_table_privilege('fir_app', $1, 'SELECT,INSERT,UPDATE,DELETE') AS app,
              has_table_privilege('fir_carteira', $1, 'DELETE') AS del,
              has_table_privilege('fir_portal', $1, 'INSERT,UPDATE,DELETE,TRUNCATE') OR has_any_column_privilege('fir_portal', $1, 'INSERT,UPDATE') AS escreve,
              has_table_privilege('fir_portal', $1, 'SELECT') AS tabela,
              has_any_column_privilege('fir_portal', $1, 'SELECT') AS colunas`,
      [t],
    )
    expect(p.rows[0]).toEqual({ app: false, del: false, escreve: false, tabela: false, colunas: LIDAS_PELO_PORTAL.has(t) })
  })

  it.each(ENTIDADES_GLOBAIS_DA_CARTEIRA)('%s: trigger de auditoria em INSERT, UPDATE e DELETE', async (t) => {
    const r = await migrate.query<{ tgtype: number }>(
      `SELECT t.tgtype::int FROM pg_trigger t
        WHERE t.tgrelid = $1::regclass AND NOT t.tgisinternal
          AND t.tgfoid = 'registrar_auditoria_do_painel'::regproc`,
      [`public.${t}`],
    )
    expect(r.rows, `${t} sem o trigger`).toHaveLength(1)
    expect(r.rows[0]!.tgtype & (4 | 8 | 16)).toBe(4 | 8 | 16)
  })
})

describe('0048: as policies do portal sobre documento e material recusam o arquivado, por AND', () => {
  it.each([
    ['documentos_carteira', 'documentos_carteira_portal'],
    ['materiais_carteira', 'materiais_carteira_portal'],
  ])('%s', async (tabela, policy) => {
    const r = await migrate.query<{ qual: string; roles: string[] }>(
      `SELECT qual, roles::text[] AS roles FROM pg_policies WHERE tablename = $1 AND policyname = $2`,
      [tabela, policy],
    )
    expect(r.rows[0]!.roles).toEqual(['fir_portal'])
    expect(r.rows[0]!.qual).toContain('visivel_portal')
    expect(r.rows[0]!.qual).toContain('arquivado_em IS NULL')
    expect(r.rows[0]!.qual.toUpperCase()).not.toMatch(/\bOR\b/)
  })

  it('as policies da carteira nas três tabelas de conteúdo passaram a ter TO fir_carteira (A-7)', async () => {
    const r = await migrate.query<{ tablename: string; roles: string[] }>(
      `SELECT tablename, roles::text[] AS roles FROM pg_policies
        WHERE policyname IN ('documentos_carteira_carteira', 'materiais_carteira_carteira', 'reunioes_comerciais_carteira')
        ORDER BY tablename`,
    )
    expect(r.rows.map((x) => x.roles)).toEqual([['fir_carteira'], ['fir_carteira'], ['fir_carteira']])
  })
})
