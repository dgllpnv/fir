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
 * toda relação do esquema `public` que não tem RLS habilitada, `fir_app` não
 * pode ter INSERT, UPDATE nem DELETE. Tabelas COM RLS ficam fora da varredura
 * de propósito — para elas a proteção é a policy, não a ausência de
 * privilégio, e é isso que `isolamento-de-clinica.test.ts` cobre.
 */
const URL_MIG =
  process.env['DATABASE_URL_MIGRATE'] ?? 'postgresql://fir_migrate:fir_local_dev@127.0.0.1:4832/fir'

/**
 * Correção final da branch, achado 4: a varredura filtrava `relkind = 'r'`, e
 * `'r'` é só a tabela comum. Escapavam:
 *
 *  - `'p'` TABELA PARTICIONADA. `movimentos` de estoque é candidata a
 *    particionamento no Plano 3 (movimento é append-only e cresce sem parar).
 *    Uma tabela particionada sem RLS e gravável pela API não aparecia aqui.
 *  - `'v'` VIEW, e esta é pior. View roda com os privilégios do DONO, e o
 *    dono é `fir_migrate`, que tem BYPASSRLS. Uma view de relatório com
 *    SELECT concedido a `fir_app` lê TODAS as clínicas, em silêncio —
 *    nenhuma policy é consultada, porque quem consulta é o dono.
 *  - `'m'` MATERIALIZED VIEW, pela mesma razão e pior ainda: é um SNAPSHOT
 *    gravado em disco, e RLS não filtra snapshot nenhum.
 *
 * `'f'` (foreign table) e `'t'` (TOAST) ficam fora: não há foreign table
 * neste produto, e TOAST não é acessível por DML.
 */
const RELKIND_DE_DADO = ['r', 'p', 'v', 'm'] as const

const NOME_DO_RELKIND: Readonly<Record<string, string>> = {
  r: 'tabela',
  p: 'tabela particionada',
  v: 'view',
  m: 'materialized view',
}

let migrate: pg.Client

/**
 * Re-revisão, achado 5: os dois `it` de `describe('toda view de public é
 * security_invoker')` executavam ZERO `expect` — não há view nem
 * materialized view em `public` hoje, então os laços abaixo não rodavam
 * nenhuma vez. Provado por mutação pelo revisor: trocar `relkind = 'v'` por
 * `'V'` na primeira query, com uma view de verdade vazando no schema (sem
 * `security_invoker`, mas com as escritas revogadas para não cair no OUTRO
 * teste), e os três `it` deste arquivo passavam 3/3 — o typo apaga a view do
 * resultado, o laço continua vazio, e vazio passa com ou sem o erro.
 *
 * O conserto não é relaxar para `toBeGreaterThan(0)` sobre um estado que
 * hoje é zero — zero É o estado correto, e inventar um piso positivo sobre
 * ele seria o mesmo teste falso que a regra 2 do validador-de-números recusa
 * em dinheiro. O conserto é fazer o estado deixar de ser zero: um canário
 * CRIADO por este arquivo, SEMPRE presente, correto por construção (senão
 * os próprios `it` abaixo reprovariam a si mesmos). A partir daí "a view não
 * foi vista" só acontece se a varredura quebrou — exatamente o que o piso
 * de contagem teria sido inútil para provar com zero real.
 */
const CANARIO_VIEW = '_canario_rls_view'
const CANARIO_MATVIEW = '_canario_rls_matview'

async function criarCanarios(cliente: pg.Client): Promise<void> {
  await cliente.query(`DROP VIEW IF EXISTS public.${CANARIO_VIEW}`)
  await cliente.query(
    `CREATE VIEW public.${CANARIO_VIEW} WITH (security_invoker = true) AS SELECT 1 AS x`,
  )
  // Mesmo canário, correto por construção: sem este REVOKE, o
  // `ALTER DEFAULT PRIVILEGES` do bootstrap concederia INSERT/UPDATE/DELETE
  // a `fir_app` na view nova (achado 4 da revisão final) e o OUTRO describe
  // deste arquivo reprovaria por causa do canário, não de um defeito real.
  await cliente.query(`REVOKE ALL ON public.${CANARIO_VIEW} FROM fir_app`)

  await cliente.query(`DROP MATERIALIZED VIEW IF EXISTS public.${CANARIO_MATVIEW}`)
  await cliente.query(`CREATE MATERIALIZED VIEW public.${CANARIO_MATVIEW} AS SELECT 1 AS x`)
  await cliente.query(`REVOKE ALL ON public.${CANARIO_MATVIEW} FROM fir_app`)
}

async function removerCanarios(cliente: pg.Client): Promise<void> {
  await cliente.query(`DROP VIEW IF EXISTS public.${CANARIO_VIEW}`)
  await cliente.query(`DROP MATERIALIZED VIEW IF EXISTS public.${CANARIO_MATVIEW}`)
}

beforeAll(async () => {
  migrate = new pg.Client({ connectionString: URL_MIG })
  await migrate.connect()
  await criarCanarios(migrate)
})

afterAll(async () => {
  await removerCanarios(migrate)
  await migrate.end()
})

describe('nenhuma relação sem RLS nasce gravável por fir_app', () => {
  it('fir_app não tem INSERT, UPDATE nem DELETE em relação sem RLS', async () => {
    const r = await migrate.query<{ relname: string; relkind: string }>(
      `SELECT c.relname, c.relkind
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = ANY($1) AND NOT c.relrowsecurity
        ORDER BY c.relname`,
      [RELKIND_DE_DADO],
    )
    expect(
      r.rows.length,
      'nenhuma relação sem RLS encontrada — a varredura não verificou nada',
    ).toBeGreaterThan(0)

    for (const { relname, relkind } of r.rows) {
      const p = await migrate.query<{ ins: boolean; upd: boolean; del: boolean }>(
        `SELECT has_table_privilege('fir_app', $1, 'INSERT') AS ins,
                has_table_privilege('fir_app', $1, 'UPDATE') AS upd,
                has_table_privilege('fir_app', $1, 'DELETE') AS del`,
        [relname],
      )
      const priv = p.rows[0]!
      const que = NOME_DO_RELKIND[relkind] ?? relkind
      // Se isto falhar, a relação nasceu gravável pelo ALTER DEFAULT
      // PRIVILEGES do bootstrap e ninguém fez o REVOKE que `clinicas` e
      // `migrations_aplicadas` precisaram. Ou ela ganha RLS, ou ganha o
      // REVOKE — nunca fica sem os dois.
      expect(priv.ins, `${que} ${relname} sem RLS: fir_app tem INSERT`).toBe(false)
      expect(priv.upd, `${que} ${relname} sem RLS: fir_app tem UPDATE`).toBe(false)
      expect(priv.del, `${que} ${relname} sem RLS: fir_app tem DELETE`).toBe(false)
    }
  })
})

describe('toda view de public é security_invoker', () => {
  it('nenhuma view roda com os privilégios do dono (que tem BYPASSRLS)', async () => {
    const r = await migrate.query<{ relname: string; reloptions: string[] | null }>(
      `SELECT c.relname, c.reloptions
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'v'
        ORDER BY c.relname`,
    )

    // O piso não pode ser 0 (hoje não há view de negócio nenhuma) — é 1,
    // porque `criarCanarios` garante que ao menos `_canario_rls_view` está
    // sempre presente. Abaixo de 1 aqui significa que a consulta parou de
    // achar a view que este mesmo arquivo acabou de criar.
    expect(
      r.rows.length,
      'nenhuma view encontrada em public — nem o canário deste arquivo apareceu; ' +
        'a varredura de relkind não está funcionando',
    ).toBeGreaterThanOrEqual(1)

    for (const { relname, reloptions } of r.rows) {
      // `security_invoker = true` (Postgres 15+) faz a view ser avaliada com
      // os privilégios e o `current_user` de QUEM CONSULTA, não do dono. Sem
      // ele, a view é avaliada como `fir_migrate` — que tem BYPASSRLS — e as
      // policies de clínica simplesmente não rodam. O sintoma não é erro: é
      // um relatório correto com as linhas de todas as clínicas.
      expect(
        (reloptions ?? []).includes('security_invoker=true'),
        `view ${relname} sem security_invoker=true. Ela roda como fir_migrate, ` +
          'que tem BYPASSRLS, e lê TODAS as clínicas em silêncio. ' +
          'Escreva: CREATE VIEW ... WITH (security_invoker = true) AS ...',
      ).toBe(true)
    }
  })

  it('nenhuma materialized view é legível por fir_app', async () => {
    // Materialized view é um snapshot em disco: não há policy a aplicar, e
    // `security_invoker` não existe para ela. Se um dia um relatório pedir
    // uma, ela precisa de `clinica_id` no corpo E de uma view comum
    // security_invoker na frente, filtrando por `app_clinica_id()` — ou de
    // SELECT concedido só a um papel de relatório que não é o da API.
    const r = await migrate.query<{ relname: string }>(
      `SELECT c.relname
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'm'`,
    )

    // Mesmo piso, mesma razão: 1, não 0, porque `_canario_rls_matview`
    // garante o piso. Hoje não há materialized view de negócio nenhuma.
    expect(
      r.rows.length,
      'nenhuma materialized view encontrada em public — nem o canário deste arquivo ' +
        'apareceu; a varredura de relkind não está funcionando',
    ).toBeGreaterThanOrEqual(1)

    for (const { relname } of r.rows) {
      const p = await migrate.query<{ sel: boolean }>(
        `SELECT has_table_privilege('fir_app', $1, 'SELECT') AS sel`,
        [relname],
      )
      expect(
        p.rows[0]!.sel,
        `materialized view ${relname}: fir_app tem SELECT. Snapshot não tem RLS.`,
      ).toBe(false)
    }
  })
})
