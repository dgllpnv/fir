import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { declararAtorSistema } from '@fir/api/banco/limpeza-de-teste'

/**
 * A IDENTIDADE DA CARTEIRA SÓ É ESCRITA PELO PAINEL — migration 0041.
 * Gate de appsec G8, achado F-1, ajuste A-1.
 *
 * `usuarios_gestao` e `grupos` não têm RLS. Até a 0041, `fir_carteira` — o
 * papel da sessão do `Usuário de Gestão` — tinha INSERT/UPDATE nelas, e uma
 * injeção em qualquer rota da carteira chegava a `SET escopo = 'geral'` para
 * o próprio atacante.
 *
 * A prova é contra o Postgres real, conectado COMO cada papel, e a recusa
 * tem de ser `permission denied` (42501) — não RLS, não código: é o GRANT
 * que não existe.
 */
const URL_MIG =
  process.env['DATABASE_URL_MIGRATE'] ?? 'postgresql://fir_migrate:fir_local_dev@127.0.0.1:4832/fir'
const URL_CARTEIRA =
  process.env['DATABASE_URL_CARTEIRA'] ?? 'postgresql://fir_carteira:fir_local_dev@127.0.0.1:4832/fir'
const URL_PAINEL =
  process.env['DATABASE_URL_PAINEL'] ?? 'postgresql://fir_painel:fir_local_dev@127.0.0.1:4832/fir'

const PERMISSAO_NEGADA = '42501'

let migrate: pg.Client
let carteira: pg.Client
let painel: pg.Client
let grupo: string
let usuarioGestao: string
const sufixo = Date.now().toString(36)

async function conectar(url: string, nome: string): Promise<pg.Client> {
  const c = new pg.Client({ connectionString: url })
  c.on('error', (e) => console.error(`[identidade-so-pelo-painel] ${nome}:`, e.message))
  await c.connect()
  return c
}

/** Roda numa transação desfeita ao fim — a prova não deixa resto no banco. */
async function eDesfaz<T>(c: pg.Client, fn: () => Promise<T>): Promise<T> {
  await c.query('BEGIN')
  try {
    return await fn()
  } finally {
    await c.query('ROLLBACK')
  }
}

async function codigoDoErro(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p
    return undefined
  } catch (e) {
    return (e as { code?: string }).code
  }
}

beforeAll(async () => {
  migrate = await conectar(URL_MIG, 'migrate')
  await declararAtorSistema(migrate)
  carteira = await conectar(URL_CARTEIRA, 'fir_carteira')
  painel = await conectar(URL_PAINEL, 'fir_painel')

  grupo = (
    await migrate.query<{ id: string }>(`INSERT INTO grupos (nome) VALUES ($1) RETURNING id`, [
      `Grupo identidade ${sufixo}`,
    ])
  ).rows[0]!.id
  usuarioGestao = (
    await migrate.query<{ id: string }>(
      `INSERT INTO usuarios_gestao (usuario, nome, senha_hash, escopo, grupo_id)
       VALUES ($1, 'Atacante', 'hash-antigo', 'grupo', $2) RETURNING id`,
      [`ident.${sufixo}`, grupo],
    )
  ).rows[0]!.id
})

afterAll(async () => {
  await carteira?.end()
  await painel?.end()
  await migrate.query('DELETE FROM usuarios_gestao WHERE grupo_id = $1', [grupo])
  await migrate.query('DELETE FROM grupos WHERE id = $1', [grupo])
  await migrate.end()
})

describe('fir_carteira NÃO escreve identidade (o papel da sessão não reescreve o próprio privilégio)', () => {
  it('UPDATE usuarios_gestao SET escopo = geral é recusado por permissão', async () => {
    const codigo = await codigoDoErro(
      eDesfaz(carteira, () =>
        carteira.query(
          `UPDATE usuarios_gestao SET escopo = 'geral', grupo_id = NULL WHERE id = $1`,
          [usuarioGestao],
        ),
      ),
    )
    expect(codigo).toBe(PERMISSAO_NEGADA)

    const r = await migrate.query<{ escopo: string }>('SELECT escopo FROM usuarios_gestao WHERE id = $1', [
      usuarioGestao,
    ])
    expect(r.rows[0]!.escopo).toBe('grupo')
  })

  it.each([
    ['grupo_id', `UPDATE usuarios_gestao SET grupo_id = grupo_id WHERE id = $1`],
    ['ativo', `UPDATE usuarios_gestao SET ativo = true WHERE id = $1`],
    ['nome', `UPDATE usuarios_gestao SET nome = 'x' WHERE id = $1`],
    ['usuario', `UPDATE usuarios_gestao SET usuario = usuario WHERE id = $1`],
  ])('UPDATE da coluna %s é recusado por permissão', async (_coluna, sql) => {
    expect(await codigoDoErro(eDesfaz(carteira, () => carteira.query(sql, [usuarioGestao])))).toBe(
      PERMISSAO_NEGADA,
    )
  })

  it('INSERT em usuarios_gestao é recusado por permissão', async () => {
    const codigo = await codigoDoErro(
      eDesfaz(carteira, () =>
        carteira.query(
          `INSERT INTO usuarios_gestao (usuario, nome, senha_hash, escopo)
           VALUES ($1, 'Intruso', 'x', 'geral')`,
          [`intruso.${sufixo}`],
        ),
      ),
    )
    expect(codigo).toBe(PERMISSAO_NEGADA)
  })

  it('INSERT e UPDATE em grupos são recusados por permissão', async () => {
    expect(
      await codigoDoErro(
        eDesfaz(carteira, () => carteira.query(`INSERT INTO grupos (nome) VALUES ('Intruso')`)),
      ),
    ).toBe(PERMISSAO_NEGADA)
    expect(
      await codigoDoErro(
        eDesfaz(carteira, () => carteira.query(`UPDATE grupos SET ativo = false WHERE id = $1`, [grupo])),
      ),
    ).toBe(PERMISSAO_NEGADA)
  })

  it('DELETE em usuarios_gestao e grupos é recusado por permissão', async () => {
    for (const sql of ['DELETE FROM usuarios_gestao WHERE id = $1', 'DELETE FROM grupos WHERE id = $1']) {
      const alvo = sql.includes('grupos') ? grupo : usuarioGestao
      expect(await codigoDoErro(eDesfaz(carteira, () => carteira.query(sql, [alvo])))).toBe(
        PERMISSAO_NEGADA,
      )
    }
  })

  it('o catálogo confirma: só as três colunas de senha são graváveis por fir_carteira', async () => {
    const r = await migrate.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'usuarios_gestao'
          AND has_column_privilege('fir_carteira', 'public.usuarios_gestao', column_name, 'UPDATE')
        ORDER BY column_name`,
    )
    expect(r.rows.map((x) => x.column_name)).toEqual([
      'senha_hash',
      'senha_provisoria',
      'senha_provisoria_expira_em',
    ])
    const g = await migrate.query<{ ins: boolean; upd: boolean }>(
      `SELECT has_table_privilege('fir_carteira', 'grupos', 'INSERT') AS ins,
              has_any_column_privilege('fir_carteira', 'grupos', 'UPDATE') AS upd`,
    )
    expect(g.rows[0]).toEqual({ ins: false, upd: false })
  })
})

describe('fir_carteira CONSEGUE o mínimo da própria sessão', () => {
  it('lê usuarios_gestao e grupos (login, guard)', async () => {
    const r = await carteira.query<{ escopo: string; grupo: string }>(
      `SELECT u.escopo, g.nome AS grupo FROM usuarios_gestao u JOIN grupos g ON g.id = u.grupo_id
        WHERE u.id = $1`,
      [usuarioGestao],
    )
    expect(r.rows[0]?.escopo).toBe('grupo')
  })

  it('troca a própria senha — exatamente o UPDATE de CarteiraService.trocarAPropriaSenha', async () => {
    const r = await eDesfaz(carteira, async () => {
      await carteira.query(
        `UPDATE usuarios_gestao
            SET senha_hash = $1, senha_provisoria = false, senha_provisoria_expira_em = NULL
          WHERE id = $2`,
        ['hash-novo', usuarioGestao],
      )
      return carteira.query<{ senha_hash: string }>('SELECT senha_hash FROM usuarios_gestao WHERE id = $1', [
        usuarioGestao,
      ])
    })
    expect(r.rows[0]!.senha_hash).toBe('hash-novo')
  })
})

describe('fir_painel CONSEGUE o que o Operador precisa', () => {
  it('cria e edita grupo', async () => {
    const r = await eDesfaz(painel, async () => {
      const g = await painel.query<{ id: string }>(
        `INSERT INTO grupos (nome) VALUES ('Grupo do Operador') RETURNING id`,
      )
      return painel.query<{ nome: string; ativo: boolean }>(
        `UPDATE grupos SET nome = 'Renomeado', ativo = false WHERE id = $1 RETURNING nome, ativo`,
        [g.rows[0]!.id],
      )
    })
    expect(r.rows[0]).toEqual({ nome: 'Renomeado', ativo: false })
  })

  it('cria e edita usuário de gestão — escopo, grupo, estado', async () => {
    const r = await eDesfaz(painel, async () => {
      const u = await painel.query<{ id: string }>(
        `INSERT INTO usuarios_gestao
           (usuario, nome, senha_hash, escopo, grupo_id, senha_provisoria, senha_provisoria_expira_em)
         VALUES ($1, 'Novo', 'h', 'grupo', $2, true, now() + interval '72 hours')
         RETURNING id`,
        [`novo.${sufixo}`, grupo],
      )
      return painel.query<{ escopo: string; grupo_id: string | null; ativo: boolean }>(
        `UPDATE usuarios_gestao SET nome = 'Editado', escopo = 'geral', grupo_id = NULL, ativo = false
          WHERE id = $1 RETURNING escopo, grupo_id, ativo`,
        [u.rows[0]!.id],
      )
    })
    expect(r.rows[0]).toEqual({ escopo: 'geral', grupo_id: null, ativo: false })
  })

  it('não apaga: desativar é estado (regra 20)', async () => {
    const p = await migrate.query<{ a: boolean; b: boolean }>(
      `SELECT has_table_privilege('fir_painel', 'usuarios_gestao', 'DELETE') AS a,
              has_table_privilege('fir_painel', 'grupos', 'DELETE') AS b`,
    )
    expect(p.rows[0]).toEqual({ a: false, b: false })
  })
})
