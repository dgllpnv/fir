import { createHash, randomBytes } from 'node:crypto'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { hashDeSenha } from '../autenticacao/senha'
import { apagarClinicaDeTeste, declararAtorSistema } from '../banco/limpeza-de-teste'

/**
 * Revisão appsec da 0111 (docs/specs/acesso-por-email-dividas-appsec.md):
 * casos de abuso contra a purga SECURITY DEFINER, a trigger do link
 * encerrado e os GRANTs novos de `fir_painel`. Postgres real.
 */

const URL_MIG =
  process.env['DATABASE_URL_MIGRATE'] ?? 'postgresql://fir_migrate:fir_local_dev@127.0.0.1:4832/fir'
const URL_APP = process.env['DATABASE_URL'] ?? 'postgresql://fir_app:fir_local_dev@127.0.0.1:4832/fir'
const URL_PAINEL =
  process.env['DATABASE_URL_PAINEL'] ?? 'postgresql://fir_painel:fir_local_dev@127.0.0.1:4832/fir'
const DIA = 86_400_000
const sufixo = randomBytes(4).toString('hex')
const hex64 = () => createHash('sha256').update(randomBytes(16)).digest('hex')

let migrate: pg.Client
let clinicaA: string
let clinicaB: string
let pessoaA: string
let pessoaB: string

async function link(
  clinica: string,
  pessoa: string,
  o: { criado: Date; expira: Date; usado?: Date | null; invalidado?: Date | null; finalidade?: string },
): Promise<string> {
  const r = await migrate.query<{ id: string }>(
    `INSERT INTO links_de_acesso
       (clinica_id, pessoa_id, finalidade, email_hmac, token_hash, criado_em, expira_em, usado_em, invalidado_em)
     VALUES ($1, $2, $9, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [clinica, pessoa, hex64(), hex64(), o.criado, o.expira, o.usado ?? null, o.invalidado ?? null, o.finalidade ?? 'redefinicao'],
  )
  return r.rows[0]!.id
}

/** Uma transação como `papel`, com a clínica fixada; ROLLBACK no fim. */
async function como<T>(url: string, clinica: string | null, f: (c: pg.Client) => Promise<T>): Promise<T> {
  const c = new pg.Client({ connectionString: url })
  await c.connect()
  try {
    await c.query('BEGIN')
    await c.query("SELECT set_config('app.pessoa_id', 'sistema', true)")
    if (clinica !== null) await c.query("SELECT set_config('app.clinica_id', $1, true)", [clinica])
    return await f(c)
  } finally {
    await c.query('ROLLBACK').catch(() => undefined)
    await c.end()
  }
}

const existe = async (id: string) =>
  (await migrate.query('SELECT 1 FROM links_de_acesso WHERE id = $1', [id])).rowCount === 1

beforeAll(async () => {
  migrate = new pg.Client({ connectionString: URL_MIG })
  await migrate.connect()
  await declararAtorSistema(migrate)
  const hash = await hashDeSenha('senha-de-teste-longa')
  for (const lado of ['a', 'b'] as const) {
    const c = (
      await migrate.query<{ id: string }>('INSERT INTO clinicas (codigo, nome) VALUES ($1, $2) RETURNING id', [
        `as111-${lado}-${sufixo}`,
        `Clínica ${lado}`,
      ])
    ).rows[0]!.id
    const p = (
      await migrate.query<{ id: string }>(
        `INSERT INTO pessoas (clinica_id, nome, usuario, senha_hash, admin) VALUES ($1, 'Ana', 'ana', $2, true) RETURNING id`,
        [c, hash],
      )
    ).rows[0]!.id
    if (lado === 'a') {
      clinicaA = c
      pessoaA = p
    } else {
      clinicaB = c
      pessoaB = p
    }
  }
})

afterAll(async () => {
  await declararAtorSistema(migrate)
  for (const id of [clinicaA, clinicaB]) await apagarClinicaDeTeste(migrate, id)
  await migrate.end()
})

describe('purgar_acesso_vencido: superfície da SECURITY DEFINER', () => {
  it('catálogo: dono fir_migrate, SECURITY DEFINER, search_path fixo, EXECUTE só de fir_app', async () => {
    const r = await migrate.query<{
      dono: string
      definer: boolean
      config: string[] | null
      app: boolean
      painel: boolean
      carteira: boolean
      portal: boolean
      bypass: boolean
    }>(
      `SELECT pg_get_userbyid(p.proowner) AS dono, p.prosecdef AS definer, p.proconfig AS config,
              has_function_privilege('fir_app', p.oid, 'EXECUTE') AS app,
              has_function_privilege('fir_painel', p.oid, 'EXECUTE') AS painel,
              has_function_privilege('fir_carteira', p.oid, 'EXECUTE') AS carteira,
              has_function_privilege('fir_portal', p.oid, 'EXECUTE') AS portal,
              (SELECT rolbypassrls FROM pg_roles WHERE rolname = pg_get_userbyid(p.proowner)) AS bypass
         FROM pg_proc p WHERE p.proname = 'purgar_acesso_vencido'`,
    )
    expect(r.rows).toHaveLength(1)
    expect(r.rows[0]).toMatchObject({
      dono: 'fir_migrate',
      definer: true,
      // A3 (0112): `pg_temp` explícito e por último.
      config: ['search_path=pg_catalog, pg_temp'],
      app: true,
      painel: false,
      carteira: false,
      portal: false,
    })
  })

  it('p_agora no futuro, infinity ou NULL não antecipa nada; lote fora de 1..10000 é recusado', async () => {
    const agora = Date.now()
    const vivo = await link(clinicaA, pessoaA, { criado: new Date(agora - 1000), expira: new Date(agora + DIA) })
    const recente = await link(clinicaA, pessoaA, {
      criado: new Date(agora - 10 * DIA),
      expira: new Date(agora - 9 * DIA),
      finalidade: 'convite',
    })
    for (const p of [new Date(agora + 5000 * DIA).toISOString(), 'infinity', null]) {
      const r = await como(URL_APP, clinicaA, (c) =>
        c.query<{ links: number }>('SELECT links FROM purgar_acesso_vencido($1::timestamptz, 10000)', [p]),
      )
      expect(r.rows[0]!.links).toBe(0)
    }
    for (const lote of [0, -1, 10001, null]) {
      await expect(
        como(URL_APP, clinicaA, (c) => c.query('SELECT * FROM purgar_acesso_vencido(now(), $1::int)', [lote])),
      ).rejects.toThrow(/lote fora/)
    }
    expect(await existe(vivo)).toBe(true)
    expect(await existe(recente)).toBe(true)
  })

  it('a função não alcança outra clínica que não a fixada, nem a auditoria', async () => {
    const velhoB = await link(clinicaB, pessoaB, {
      criado: new Date(Date.now() - 90 * DIA),
      expira: new Date(Date.now() - 89 * DIA),
    })
    const antes = (await migrate.query<{ n: string }>('SELECT count(*) n FROM auditoria')).rows[0]!.n
    await como(URL_APP, clinicaA, (c) => c.query('SELECT * FROM purgar_acesso_vencido(now(), 10000)'))
    expect(await existe(velhoB)).toBe(true)
    // ROLLBACK desfez o que a trilha ganhou; nenhuma linha antiga sumiu.
    const depois = (await migrate.query<{ n: string }>('SELECT count(*) n FROM auditoria')).rows[0]!.n
    expect(BigInt(depois) >= BigInt(antes)).toBe(true)
  })
})

describe('link encerrado é terminal', () => {
  it('fir_app e fir_painel: nem reviver invalidado, nem re-carimbar usado, nem mexer no hash', async () => {
    const agora = Date.now()
    const inval = await link(clinicaA, pessoaA, {
      criado: new Date(agora - 1000),
      expira: new Date(agora + DIA),
      invalidado: new Date(agora - 500),
      finalidade: 'convite',
    })
    const usado = await link(clinicaA, pessoaA, {
      criado: new Date(agora - 1000),
      expira: new Date(agora + DIA),
      usado: new Date(agora - 500),
      finalidade: 'convite',
    })
    for (const url of [URL_APP, URL_PAINEL]) {
      await expect(
        como(url, clinicaA, (c) => c.query('UPDATE links_de_acesso SET invalidado_em = NULL WHERE id = $1', [inval])),
      ).rejects.toThrow(/encerrado não muda/)
    }
    await expect(
      como(URL_APP, clinicaA, (c) => c.query('UPDATE links_de_acesso SET usado_em = now() WHERE id = $1', [usado])),
    ).rejects.toThrow(/encerrado não muda/)
    await expect(
      como(URL_APP, clinicaA, (c) => c.query("UPDATE links_de_acesso SET token_hash = repeat('a', 64) WHERE id = $1", [usado])),
    ).rejects.toThrow(/permission denied|permissão negada/)
    await expect(
      como(URL_PAINEL, clinicaA, (c) => c.query('UPDATE links_de_acesso SET usado_em = NULL WHERE id = $1', [usado])),
    ).rejects.toThrow(/permission denied|permissão negada/)
  })

  it('A1 (corrigido na 0112): fir_app não encerra um link com instante FUTURO, e a purga o alcança', async () => {
    const agora = Date.now()
    const vivo = await link(clinicaA, pessoaA, {
      criado: new Date(agora - 40 * DIA),
      expira: new Date(agora - 39 * DIA),
      finalidade: 'confirmacao_de_email',
    })
    for (const col of ['invalidado_em', 'usado_em']) {
      await expect(
        como(URL_APP, clinicaA, (c) =>
          c.query(`UPDATE links_de_acesso SET ${col} = '2999-01-01' WHERE id = $1`, [vivo]),
        ),
      ).rejects.toThrow(/encerramento no futuro recusado/)
    }
    // O evento também não nasce no futuro.
    await expect(
      como(URL_APP, clinicaA, (c) =>
        c.query(
          `INSERT INTO eventos_de_acesso (clinica_id, pessoa_id, evento, em)
           VALUES ($1, $2, 'email_confirmado', '2999-01-01')`,
          [clinicaA, pessoaA],
        ),
      ),
    ).rejects.toThrow(/instante no futuro recusado/)
    // O link venceu há 39 dias e sai (`como` desfaz no fim: confere dentro).
    const restou = await como(URL_APP, clinicaA, async (c) => {
      await c.query('SELECT links FROM purgar_acesso_vencido(now(), 10000)')
      return (await c.query('SELECT 1 FROM links_de_acesso WHERE id = $1', [vivo])).rowCount
    })
    expect(restou).toBe(0)
  })
})

describe('GRANTs de fir_painel na 0111', () => {
  it('INSERT sim; DELETE/TRUNCATE não; UPDATE só em invalidado_em; RLS segura a outra clínica', async () => {
    const r = await migrate.query<Record<string, boolean>>(
      `SELECT has_table_privilege('fir_painel','links_de_acesso','DELETE') ld,
              has_table_privilege('fir_painel','eventos_de_acesso','DELETE') ed,
              has_table_privilege('fir_painel','links_de_acesso','TRUNCATE') lt,
              has_table_privilege('fir_painel','eventos_de_acesso','UPDATE') eu,
              has_column_privilege('fir_painel','links_de_acesso','usado_em','UPDATE') uu,
              has_column_privilege('fir_painel','links_de_acesso','token_hash','UPDATE') tu,
              has_table_privilege('fir_painel','links_de_acesso','INSERT') li`,
    )
    expect(r.rows[0]).toEqual({ ld: false, ed: false, lt: false, eu: false, uu: false, tu: false, li: true })
    await expect(
      como(URL_PAINEL, clinicaA, (c) =>
        c.query(
          `INSERT INTO links_de_acesso (clinica_id, pessoa_id, finalidade, email_hmac, token_hash, expira_em)
           VALUES ($1, $2, 'redefinicao', $3, $4, now() + interval '1 hour')`,
          [clinicaB, pessoaB, hex64(), hex64()],
        ),
      ),
    ).rejects.toThrow(/row-level security|segurança em nível de linha/)
  })

  it('ACHADO A2: fir_painel (como fir_app) grava evento de acesso em nome de uma pessoa, com evento que ela não fez', async () => {
    const r = await como(URL_PAINEL, clinicaA, (c) =>
      c.query(
        `INSERT INTO eventos_de_acesso (clinica_id, pessoa_id, evento, por_pessoa_id)
         VALUES ($1, $2, 'senha_redefinida_pelo_link', $2) RETURNING id`,
        [clinicaA, pessoaA],
      ),
    )
    expect(r.rowCount).toBe(1)
  })
})
