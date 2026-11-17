import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { apagarClinicaDeTeste, declararAtorSistema } from '@fir/api/banco/limpeza-de-teste'
import { CHAVES_DO_CATALOGO } from '@fir/domain'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * O esquema de Indicadores & Insights (0098, 0099), cobrado no BANCO.
 *
 * Postgres real, nunca mock (CLAUDE.md §7): a FK composta, o WITH CHECK, o
 * EXCLUDE e o REVOKE só existem aqui. Um teste de serviço provaria que o
 * serviço filtra, não que o banco recusa a escrita que ele esqueceu de
 * filtrar.
 */
const URL_MIG =
  process.env['DATABASE_URL_MIGRATE'] ?? 'postgresql://fir_migrate:fir_local_dev@127.0.0.1:4832/fir'
const URL_APP = process.env['DATABASE_URL'] ?? 'postgresql://fir_app:fir_local_dev@127.0.0.1:4832/fir'
const SQL_0099 = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'apps', 'api', 'migrations', '0099_permissoes_de_indicadores.sql'),
  'utf8',
)

const TABELAS = [
  'kpis',
  'lancamentos_de_kpi',
  'okrs',
  'resultados_chave',
  'series_de_meta',
  'metas_de_kpi',
  'fotografias_de_kpi',
] as const

let m: pg.Client
let app: pg.Client
const sufixo = `${Date.now()}`
const clinicas: string[] = []
let A: string
let B: string
let pessoaA: string
let pessoaB: string

const umId = async (sql: string, params: unknown[]): Promise<string> =>
  (await m.query<{ id: string }>(sql, params)).rows[0]!.id

const novaClinica = async (cod: string) => {
  const id = await umId(`INSERT INTO clinicas (codigo, nome) VALUES ($1, 'Clínica Indicadores') RETURNING id`, [
    `ind-${sufixo}-${cod}`,
  ])
  clinicas.push(id)
  return id
}
const novaPessoa = (clinica: string, usuario: string) =>
  umId(`INSERT INTO pessoas (clinica_id, nome, usuario, senha_hash, admin) VALUES ($1, 'Ana', $2, 'x', true) RETURNING id`, [
    clinica,
    usuario,
  ])
const kpiDeCatalogo = (clinica: string, chave = 'novos_pacientes', parametros?: object) =>
  parametros === undefined
    ? umId(`INSERT INTO kpis (clinica_id, origem, chave_catalogo, nome, frequencia) VALUES ($1, 'catalogo', $2, 'K', 'mensal') RETURNING id`, [
        clinica,
        chave,
      ])
    : umId(
        `INSERT INTO kpis (clinica_id, origem, chave_catalogo, nome, frequencia, parametros) VALUES ($1, 'catalogo', $2, 'K', 'mensal', $3) RETURNING id`,
        [clinica, chave, JSON.stringify(parametros)],
      )
const kpiManual = (clinica: string) =>
  umId(
    `INSERT INTO kpis (clinica_id, origem, nome, pilar, unidade, direcao, frequencia, dia_de_lancamento)
     VALUES ($1, 'manual', 'NPS', 'Comercial', 'quantidade', 'maior', 'mensal', 5) RETURNING id`,
    [clinica],
  )

/** Roda `fn` como `fir_app`, dentro da clínica, e desfaz no fim. */
async function naClinica<T>(clinica: string, fn: () => Promise<T>): Promise<T> {
  await app.query('BEGIN')
  try {
    await app.query('SELECT set_config($1, $2, true)', ['app.clinica_id', clinica])
    await app.query('SELECT set_config($1, $2, true)', ['app.pessoa_id', 'sistema'])
    return await fn()
  } finally {
    await app.query('ROLLBACK')
  }
}

beforeAll(async () => {
  m = new pg.Client({ connectionString: URL_MIG })
  app = new pg.Client({ connectionString: URL_APP })
  await m.connect()
  await app.connect()
  await declararAtorSistema(m)
  A = await novaClinica('a')
  B = await novaClinica('b')
  pessoaA = await novaPessoa(A, `ana-${sufixo}`)
  pessoaB = await novaPessoa(B, `bia-${sufixo}`)
})

afterAll(async () => {
  for (const c of clinicas) await apagarClinicaDeTeste(m, c)
  await app.end()
  await m.end()
})

describe('0098 — FK composta (appsec C24)', () => {
  it('fk-composta-entre-clinicas: toda FK das tabelas novas (e tarefas.kpi_id) leva clinica_id junto', async () => {
    const r = await m.query<{ tabela: string; nome: string; colunas: string[] }>(
      `SELECT c.conrelid::regclass::text AS tabela, c.conname AS nome,
              array_agg(a.attname::text ORDER BY k.ord) AS colunas
         FROM pg_constraint c
         CROSS JOIN LATERAL unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord)
         JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
        WHERE c.contype = 'f'
          AND (c.conrelid::regclass::text = ANY ($1) OR c.conname = 'tarefa_kpi_da_clinica')
        GROUP BY 1, 2`,
      [[...TABELAS]],
    )
    const fks = r.rows.filter((f) => !(f.colunas.length === 1 && f.colunas[0] === 'clinica_id'))
    // 2 (kpis) + 2 (lançamento) + 2 (okr) + 2 (KR) + 4 (série) + 5 (meta) + 1 (fotografia) + tarefas.
    expect(fks.length).toBe(19)
    for (const f of fks) {
      expect(f.colunas, `${f.tabela}.${f.nome} é FK simples`).toContain('clinica_id')
      expect(f.colunas.length, `${f.tabela}.${f.nome}`).toBe(2)
    }
  })

  it('kpi_id da clínica B gravado sob a clínica A dá erro de FK, mesmo invisível pela RLS', async () => {
    const kpiB = await kpiManual(B)
    await naClinica(A, async () => {
      await expect(
        app.query(
          `INSERT INTO lancamentos_de_kpi (clinica_id, kpi_id, referencia, valor_numero, lancado_por) VALUES ($1, $2, '2026-11-01', 1, $3)`,
          [A, kpiB, pessoaA],
        ),
      ).rejects.toThrow(/foreign key|chave estrangeira/i)
    })
    // E o dono do esquema, que atravessa a RLS, também é recusado: é a FK, não a policy.
    await expect(
      m.query(`INSERT INTO metas_de_kpi (clinica_id, kpi_id, tipo, inicio, prazo, alvo_numero) VALUES ($1, $2, 'ate_data', '2026-11-01', '2026-11-30', 10)`, [A, kpiB]),
    ).rejects.toThrow(/foreign key|chave estrangeira/i)
    // Responsável de outra clínica também.
    await expect(
      m.query(`INSERT INTO okrs (clinica_id, objetivo, inicio, fim, responsavel_id) VALUES ($1, 'X', '2026-10-01', '2026-12-31', $2)`, [A, pessoaB]),
    ).rejects.toThrow(/foreign key|chave estrangeira/i)
  })
})

describe('0098 — RLS (appsec C24)', () => {
  it('rls-with-check-tabelas-novas: ENABLE + FORCE e policy com USING e WITH CHECK por clínica', async () => {
    for (const t of TABELAS) {
      const rls = await m.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
        `SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = $1::regclass`,
        [t],
      )
      expect(rls.rows[0], t).toEqual({ relrowsecurity: true, relforcerowsecurity: true })
      const p = await m.query<{ qual: string | null; with_check: string | null }>(
        `SELECT qual, with_check FROM pg_policies WHERE schemaname = 'public' AND tablename = $1`,
        [t],
      )
      expect(p.rows.length, t).toBe(1)
      expect(p.rows[0]!.qual, `${t} USING`).toContain('app_clinica_id()')
      expect(p.rows[0]!.with_check, `${t} WITH CHECK`).toContain('app_clinica_id()')
    }
  })

  it('fir_app não vê o KPI de outra clínica, e não grava KPI em nome dela', async () => {
    const kpiB = await kpiManual(B)
    await naClinica(A, async () => {
      expect((await app.query('SELECT id FROM kpis WHERE id = $1', [kpiB])).rowCount).toBe(0)
      await expect(
        app.query(
          `INSERT INTO kpis (clinica_id, origem, chave_catalogo, nome, frequencia) VALUES ($1, 'catalogo', 'ticket_medio', 'K', 'mensal')`,
          [B],
        ),
      ).rejects.toThrow(/row-level security|política|policy/i)
    })
  })
})

describe('0098 — privilégios (appsec C25)', () => {
  it('nenhuma tabela nova dá DELETE nem TRUNCATE a fir_app', async () => {
    for (const t of TABELAS) {
      const r = await m.query<{ d: boolean; tr: boolean }>(
        `SELECT has_table_privilege('fir_app', $1, 'DELETE') AS d, has_table_privilege('fir_app', $1, 'TRUNCATE') AS tr`,
        [t],
      )
      expect(r.rows[0], t).toEqual({ d: false, tr: false })
    }
  })

  it('fotografias-so-insert: INSERT e ON CONFLICT DO NOTHING passam; UPDATE e DELETE são recusados', async () => {
    const kpi = await kpiDeCatalogo(A, 'itens_abaixo_do_minimo')
    await naClinica(A, async () => {
      await app.query(`INSERT INTO fotografias_de_kpi (clinica_id, kpi_id, dia, valor_numero) VALUES ($1, $2, '2026-11-16', 300)`, [A, kpi])
      // Recompor dia perdido: a segunda gravação do mesmo dia não muda nada.
      const denovo = await app.query(
        `INSERT INTO fotografias_de_kpi (clinica_id, kpi_id, dia, valor_numero) VALUES ($1, $2, '2026-11-16', 999) ON CONFLICT (kpi_id, dia) DO NOTHING`,
        [A, kpi],
      )
      expect(denovo.rowCount).toBe(0)
      const v = await app.query<{ valor_numero: string }>(`SELECT valor_numero FROM fotografias_de_kpi WHERE kpi_id = $1`, [kpi])
      expect(v.rows.map((x) => x.valor_numero)).toEqual(['300'])
      await app.query('SAVEPOINT s')
      await expect(app.query(`UPDATE fotografias_de_kpi SET valor_numero = 1 WHERE kpi_id = $1`, [kpi])).rejects.toThrow(
        /permission denied|permissão negada/i,
      )
      await app.query('ROLLBACK TO SAVEPOINT s')
      await expect(app.query(`DELETE FROM fotografias_de_kpi WHERE kpi_id = $1`, [kpi])).rejects.toThrow(
        /permission denied|permissão negada/i,
      )
    })
    // Nem o dono: a trigger alcança quem o REVOKE não alcança.
    await m.query(`INSERT INTO fotografias_de_kpi (clinica_id, kpi_id, dia, valor_numero) VALUES ($1, $2, '2026-11-15', 7)`, [A, kpi])
    await expect(m.query(`UPDATE fotografias_de_kpi SET valor_numero = 8 WHERE kpi_id = $1`, [kpi])).rejects.toThrow(/append-only/)
  })
})

describe('0098 — unicidade e EXCLUDE', () => {
  it('catalogo-parametros-default-unico: parametros nasce {} e o UNIQUE recusa o segundo vivo (números c.13)', async () => {
    const c = await novaClinica('c13')
    const k1 = await kpiDeCatalogo(c, 'faturamento_conferido')
    const p = await m.query<{ parametros: unknown }>(`SELECT parametros FROM kpis WHERE id = $1`, [k1])
    expect(p.rows[0]!.parametros).toEqual({})
    await expect(kpiDeCatalogo(c, 'faturamento_conferido')).rejects.toThrow(/duplicate key|duplicada/i)
    // NULL não é escapatória: a coluna é NOT NULL.
    await expect(
      m.query(`INSERT INTO kpis (clinica_id, origem, chave_catalogo, nome, frequencia, parametros) VALUES ($1, 'catalogo', 'faturamento_conferido', 'K', 'mensal', NULL)`, [c]),
    ).rejects.toThrow(/null/i)
    // Parâmetros diferentes são outro KPI; arquivado não ocupa o lugar.
    await kpiDeCatalogo(c, 'novos_pacientes', { origem: 'Instagram' })
    await kpiDeCatalogo(c, 'novos_pacientes')
    await m.query(`UPDATE kpis SET arquivado_em = now() WHERE id = $1`, [k1])
    await kpiDeCatalogo(c, 'faturamento_conferido')
  })

  it('o CHECK de chave_catalogo aceita exatamente as 20 chaves do domínio', async () => {
    const c = await novaClinica('chaves')
    for (const chave of CHAVES_DO_CATALOGO) await kpiDeCatalogo(c, chave)
    await expect(kpiDeCatalogo(c, 'faturamento')).rejects.toThrow(/chave_catalogo/)
  })

  it('o KPI de catálogo não carrega pilar/unidade; o manual carrega os três e parametros {}', async () => {
    await expect(
      m.query(`INSERT INTO kpis (clinica_id, origem, chave_catalogo, nome, frequencia, unidade) VALUES ($1, 'catalogo', 'ticket_medio', 'K', 'mensal', 'reais')`, [A]),
    ).rejects.toThrow(/kpi_origem_coerente/)
    await expect(
      m.query(`INSERT INTO kpis (clinica_id, origem, nome, frequencia, dia_de_lancamento) VALUES ($1, 'manual', 'X', 'mensal', 3)`, [A]),
    ).rejects.toThrow(/kpi_origem_coerente/)
    await expect(
      m.query(
        `INSERT INTO kpis (clinica_id, origem, nome, pilar, unidade, direcao, frequencia, dia_de_lancamento) VALUES ($1, 'manual', 'X', 'Comercial', 'nota', 'maior', 'semanal', 8)`,
        [A],
      ),
    ).rejects.toThrow(/kpi_dia_de_lancamento_da_semana/)
  })

  it('uma meta viva por KPI e contexto: o EXCLUDE recusa a sobreposição; outro KR, arquivada e vizinha passam', async () => {
    const kpi = await kpiManual(A)
    const okr = await umId(`INSERT INTO okrs (clinica_id, objetivo, inicio, fim) VALUES ($1, 'Agenda previsível', '2026-10-01', '2026-12-31') RETURNING id`, [A])
    const kr = await umId(`INSERT INTO resultados_chave (clinica_id, okr_id, kpi_id, ordem) VALUES ($1, $2, $3, 1) RETURNING id`, [A, okr, kpi])
    const meta = (inicio: string, prazo: string, krId: string | null = null) =>
      umId(
        `INSERT INTO metas_de_kpi (clinica_id, kpi_id, resultado_chave_id, tipo, inicio, prazo, alvo_numero, partida_numero)
         VALUES ($1, $2, $3, 'ate_data', $4, $5, 7000, 6000) RETURNING id`,
        [A, kpi, krId, inicio, prazo],
      )
    const primeira = await meta('2026-11-01', '2026-11-30')
    await expect(meta('2026-11-30', '2026-12-15')).rejects.toThrow(/uma_meta_viva_por_kpi_e_contexto/)
    await meta('2026-12-01', '2026-12-31') // vizinha: o prazo é inclusivo, e 01/12 não sobrepõe 30/11
    await meta('2026-11-01', '2026-11-30', kr) // mesmo KPI no KR: outro contexto
    await m.query(`UPDATE metas_de_kpi SET arquivada_em = now() WHERE id = $1`, [primeira])
    await meta('2026-11-10', '2026-11-20')
  })

  it('valor em XOR de coluna e meta do mês só com mês inteiro', async () => {
    const kpi = await kpiManual(A)
    await expect(
      m.query(`INSERT INTO lancamentos_de_kpi (clinica_id, kpi_id, referencia, valor_centavos, valor_numero, lancado_por) VALUES ($1, $2, '2026-11-01', 1, 1, $3)`, [A, kpi, pessoaA]),
    ).rejects.toThrow(/lancamento_valor_em_uma_coluna/)
    await expect(
      m.query(`INSERT INTO metas_de_kpi (clinica_id, kpi_id, tipo, inicio, prazo, alvo_numero) VALUES ($1, $2, 'mes', '2026-11-01', '2026-11-15', 1)`, [A, kpi]),
    ).rejects.toThrow(/meta_do_mes_e_mes_inteiro/)
    await expect(
      m.query(`INSERT INTO metas_de_kpi (clinica_id, kpi_id, tipo, inicio, prazo, alvo_numero, partida_centavos) VALUES ($1, $2, 'ate_data', '2026-11-01', '2026-11-15', 1, 0)`, [A, kpi]),
    ).rejects.toThrow(/meta_partida_na_coluna_do_alvo/)
  })

  it('tarefas.kpi_id nasce nula e não muda nenhuma tarefa existente', async () => {
    const r = await m.query<{ is_nullable: string; column_default: string | null }>(
      `SELECT is_nullable, column_default FROM information_schema.columns WHERE table_name = 'tarefas' AND column_name = 'kpi_id'`,
    )
    expect(r.rows[0]).toEqual({ is_nullable: 'YES', column_default: null })
  })
})

describe('0099 — as chaves nos perfis com painel (I-33)', () => {
  it('idempotente: só quem tem painel ganha, só a chave que falta, e o perfil excluído fica como está', async () => {
    const c = await novaClinica('p99')
    const perfil = (chave: string, perms: string[], excluido = false) =>
      umId(
        `INSERT INTO perfis (clinica_id, chave, nome, perms, excluido_em) VALUES ($1, $2, $2, $3, ${excluido ? 'now()' : 'NULL'}) RETURNING id`,
        [c, chave, perms],
      )
    const sup = await perfil('pf_sup', ['painel', 'valores'])
    const meio = await perfil('pf_x', ['painel', 'indicadores'])
    const rec = await perfil('pf_rec', ['jornada'])
    const apagado = await perfil('pf_y', ['painel'], true)
    const rodar = async () => {
      await m.query('BEGIN')
      await m.query(SQL_0099)
      await m.query('COMMIT')
    }
    await rodar()
    await rodar()
    await rodar()
    const perms = async (id: string) => (await m.query<{ perms: string[] }>(`SELECT perms FROM perfis WHERE id = $1`, [id])).rows[0]!.perms
    expect(await perms(sup)).toEqual(['painel', 'valores', 'indicadores', 'indicadores.gerir'])
    expect(await perms(meio)).toEqual(['painel', 'indicadores', 'indicadores.gerir'])
    expect(await perms(rec)).toEqual(['jornada'])
    expect(await perms(apagado)).toEqual(['painel'])
  })
})
