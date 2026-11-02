import { randomBytes } from 'node:crypto'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  apagarClinicaDeTeste,
  apagarOperadorDeTeste,
  declararAtorSistema,
} from '@fir/api/banco/limpeza-de-teste'

/**
 * A SESSÃO DE SUPORTE NO BANCO — migration 0022, decisão D-13.
 *
 * O que este arquivo cobra são os cinco invariantes da D-13, no único lugar
 * onde três deles podem ser provados: o Postgres de verdade.
 *
 *  1. O operador NUNCA vira uma `pessoa` da clínica.
 *  2. Toda escrita dele cai na trilha DELA como `ator_tipo = 'operador'`.
 *  3. A RLS continua valendo — uma clínica por sessão, e `fir_painel` é súdito.
 *  4. (tela — não é aqui)
 *  5. Curta e revogável: operador inativo não resolve, e sair do painel mata.
 *
 * `fir_app` é o papel do BALCÃO, e é com ele que as asserções de privilégio
 * rodam: provar que a aplicação consegue criar a sessão com o papel que ela
 * de fato usa é diferente de provar que o dono da tabela consegue.
 */
const URL_MIG =
  process.env['DATABASE_URL_MIGRATE'] ?? 'postgresql://fir_migrate:fir_local_dev@127.0.0.1:4832/fir'
const URL_APP =
  process.env['DATABASE_URL'] ?? 'postgresql://fir_app:fir_local_dev@127.0.0.1:4832/fir'
const URL_PAINEL =
  process.env['DATABASE_URL_PAINEL'] ?? 'postgresql://fir_painel:fir_local_dev@127.0.0.1:4832/fir'

const sufixo = randomBytes(4).toString('hex')

let migrate: pg.Client
let app: pg.Client
let painel: pg.Client

/** Duas clínicas: o isolamento só se mede com um vizinho. */
let clinicaA: string
let clinicaB: string
let pessoaA: string
let operador: string

const hash = () => randomBytes(32).toString('hex')

async function conectar(url: string, nome: string): Promise<pg.Client> {
  const c = new pg.Client({ connectionString: url })
  c.on('error', (e) => console.error(`[sessao-de-operador] ${nome}:`, e.message))
  await c.connect()
  return c
}

/** Abre transação, declara clínica e ator, roda, e desfaz sempre. */
async function emTransacao<T>(
  c: pg.Client,
  clinica: string | null,
  ator: string,
  fn: () => Promise<T>,
): Promise<{ ok: true; valor: T } | { ok: false; erro: pg.DatabaseError }> {
  await c.query('BEGIN')
  try {
    await c.query('SELECT set_config($1, $2, true)', ['app.pessoa_id', ator])
    if (clinica !== null) {
      await c.query('SELECT set_config($1, $2, true)', ['app.clinica_id', clinica])
    }
    const valor = await fn()
    await c.query('ROLLBACK')
    return { ok: true, valor }
  } catch (e) {
    await c.query('ROLLBACK')
    return { ok: false, erro: e as pg.DatabaseError }
  }
}

beforeAll(async () => {
  migrate = await conectar(URL_MIG, 'fir_migrate')
  app = await conectar(URL_APP, 'fir_app')
  painel = await conectar(URL_PAINEL, 'fir_painel')
  await declararAtorSistema(migrate)

  const criarClinica = async (codigo: string): Promise<string> =>
    (
      await migrate.query<{ id: string }>(
        `INSERT INTO clinicas (codigo, nome) VALUES ($1, $2) RETURNING id`,
        [codigo, `Clínica ${codigo}`],
      )
    ).rows[0]!.id

  clinicaA = await criarClinica(`sop${sufixo}a`)
  clinicaB = await criarClinica(`sop${sufixo}b`)

  pessoaA = (
    await migrate.query<{ id: string }>(
      `INSERT INTO pessoas (clinica_id, nome, usuario, senha_hash, admin)
       VALUES ($1, 'Ana Recepção', $2, 'x', true) RETURNING id`,
      [clinicaA, `ana.${sufixo}`],
    )
  ).rows[0]!.id

  operador = (
    await migrate.query<{ id: string }>(
      `INSERT INTO operadores (usuario, nome, senha_hash)
       VALUES ($1, 'Dono do Painel', 'x') RETURNING id`,
      [`dono.${sufixo}`],
    )
  ).rows[0]!.id
})

afterAll(async () => {
  await declararAtorSistema(migrate)
  await apagarClinicaDeTeste(migrate, clinicaA)
  await apagarClinicaDeTeste(migrate, clinicaB)
  await apagarOperadorDeTeste(migrate, operador)
  await Promise.all([migrate.end(), app.end(), painel.end()])
})

// ---------------------------------------------------------------------------

describe('a sessão carrega UM sujeito, e exatamente um', () => {
  it('aceita a sessão de OPERADOR, sem pessoa', async () => {
    const r = await emTransacao(painel, clinicaA, `operador:${operador}`, () =>
      painel.query(
        `INSERT INTO sessoes (clinica_id, operador_id, token_hash, expira_em)
         VALUES ($1, $2, $3, now() + interval '30 minutes')`,
        [clinicaA, operador, hash()],
      ),
    )
    expect(r.ok, r.ok ? '' : r.erro.message).toBe(true)
  })

  it('aceita a sessão de PESSOA, sem operador — o caminho de hoje não muda', async () => {
    const r = await emTransacao(app, clinicaA, pessoaA, () =>
      app.query(
        `INSERT INTO sessoes (clinica_id, pessoa_id, token_hash, expira_em)
         VALUES ($1, $2, $3, now() + interval '30 days')`,
        [clinicaA, pessoaA, hash()],
      ),
    )
    expect(r.ok, r.ok ? '' : r.erro.message).toBe(true)
  })

  it('RECUSA os dois juntos — "quem está agindo" não tem duas respostas', async () => {
    const r = await emTransacao(painel, clinicaA, `operador:${operador}`, () =>
      painel.query(
        `INSERT INTO sessoes (clinica_id, pessoa_id, operador_id, token_hash, expira_em)
         VALUES ($1, $2, $3, $4, now() + interval '30 minutes')`,
        [clinicaA, pessoaA, operador, hash()],
      ),
    )
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.erro.constraint).toBe('sessao_tem_um_sujeito')
  })

  it('RECUSA nenhum dos dois — sessão órfã é sessão sem ator, e a trigger recusaria toda escrita dela', async () => {
    const r = await emTransacao(painel, clinicaA, `operador:${operador}`, () =>
      painel.query(
        `INSERT INTO sessoes (clinica_id, token_hash, expira_em)
         VALUES ($1, $2, now() + interval '30 minutes')`,
        [clinicaA, hash()],
      ),
    )
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.erro.constraint).toBe('sessao_tem_um_sujeito')
  })

  it('RECUSA um operador que não existe — credencial sem dono', async () => {
    const r = await emTransacao(painel, clinicaA, `operador:${operador}`, () =>
      painel.query(
        `INSERT INTO sessoes (clinica_id, operador_id, token_hash, expira_em)
         VALUES ($1, '00000000-0000-4000-8000-000000000000', $2,
                 now() + interval '30 minutes')`,
        [clinicaA, hash()],
      ),
    )
    expect(r.ok).toBe(false)
  })
})

// ---------------------------------------------------------------------------

describe('INVARIANTE 1 — o operador nunca vira uma pessoa da clínica', () => {
  it('abrir a sessão de suporte não cria nenhuma linha em `pessoas`', async () => {
    const quantas = async (): Promise<number> =>
      Number(
        (
          await migrate.query<{ n: string }>(
            'SELECT count(*)::text AS n FROM pessoas WHERE clinica_id = $1',
            [clinicaA],
          )
        ).rows[0]!.n,
      )

    const antes = await quantas()
    await painel.query('BEGIN')
    await painel.query('SELECT set_config($1, $2, true)', [
      'app.pessoa_id',
      `operador:${operador}`,
    ])
    await painel.query('SELECT set_config($1, $2, true)', ['app.clinica_id', clinicaA])
    await painel.query(
      `INSERT INTO sessoes (clinica_id, operador_id, token_hash, expira_em)
       VALUES ($1, $2, $3, now() + interval '30 minutes')`,
      [clinicaA, operador, hash()],
    )
    await painel.query('COMMIT')

    expect(await quantas()).toBe(antes)
  })

  it('o id do operador não aparece em `pessoas` — nem como id, nem como usuário', async () => {
    const r = await migrate.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pessoas
        WHERE id = $1 OR usuario = (SELECT usuario FROM operadores WHERE id = $1)`,
      [operador],
    )
    expect(r.rows[0]!.n).toBe('0')
  })

  it('`pessoas` não tem coluna que aponte para operador — o booleano da D-5 não voltou', async () => {
    const r = await migrate.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = 'pessoas'
          AND (column_name LIKE '%operador%' OR column_name LIKE '%superadmin%')`,
    )
    expect(r.rows.map((x) => x.column_name)).toEqual([])
  })
})

// ---------------------------------------------------------------------------

describe('INVARIANTE 2 — a escrita dele cai na trilha DELA como operador', () => {
  let linha: {
    ator_tipo: string
    ator_id: string | null
    acao: string
    entidade: string
    clinica_id: string
    para: Record<string, unknown>
  }

  beforeAll(async () => {
    const antes = (
      await migrate.query<{ max: string | null }>(
        'SELECT max(id)::text AS max FROM auditoria WHERE clinica_id = $1',
        [clinicaA],
      )
    ).rows[0]!.max

    await painel.query('BEGIN')
    await painel.query('SELECT set_config($1, $2, true)', [
      'app.pessoa_id',
      `operador:${operador}`,
    ])
    await painel.query('SELECT set_config($1, $2, true)', ['app.clinica_id', clinicaA])
    await painel.query(
      `INSERT INTO sessoes (clinica_id, operador_id, token_hash, expira_em)
       VALUES ($1, $2, $3, now() + interval '30 minutes')`,
      [clinicaA, operador, 'trilha-do-operador'],
    )
    await painel.query('COMMIT')

    const r = await migrate.query<typeof linha>(
      `SELECT ator_tipo, ator_id, acao, entidade, clinica_id, para
         FROM auditoria
        WHERE clinica_id = $1 AND entidade = 'sessoes'
          AND ($2::text IS NULL OR id > $2::bigint)
        ORDER BY id DESC LIMIT 1`,
      [clinicaA, antes],
    )
    linha = r.rows[0]!
  })

  it('existe a linha, e ela é `operador` com o ID dele — nunca uma pessoa', () => {
    expect(linha).toBeDefined()
    expect(linha.ator_tipo).toBe('operador')
    expect(linha.ator_id).toBe(operador)
  })

  it('ela está na trilha DA CLÍNICA em que ele agiu — é a que ela enxerga', () => {
    expect(linha.clinica_id).toBe(clinicaA)
    expect(linha.acao).toBe('criou')
    expect(linha.entidade).toBe('sessoes')
  })

  it('o token não atravessa a trilha', () => {
    expect(linha.para['token_hash']).toBe('[oculto]')
    expect(linha.para['operador_id']).toBe(operador)
  })

  it('nenhuma linha de operador ficou com ator_tipo = pessoa', async () => {
    const r = await migrate.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM auditoria
        WHERE clinica_id = $1 AND ator_id = $2 AND ator_tipo <> 'operador'`,
      [clinicaA, operador],
    )
    expect(r.rows[0]!.n).toBe('0')
  })
})

// ---------------------------------------------------------------------------

describe('INVARIANTE 3 — a RLS continua valendo, e é uma clínica por vez', () => {
  let token: string

  beforeAll(async () => {
    token = hash()
    await painel.query('BEGIN')
    await painel.query('SELECT set_config($1, $2, true)', [
      'app.pessoa_id',
      `operador:${operador}`,
    ])
    await painel.query('SELECT set_config($1, $2, true)', ['app.clinica_id', clinicaA])
    await painel.query(
      `INSERT INTO sessoes (clinica_id, operador_id, token_hash, expira_em)
       VALUES ($1, $2, $3, now() + interval '30 minutes')`,
      [clinicaA, operador, token],
    )
    await painel.query('COMMIT')
  })

  it('`fir_painel` NÃO cria sessão de suporte numa clínica que não fixou', async () => {
    const r = await emTransacao(painel, clinicaB, `operador:${operador}`, () =>
      painel.query(
        `INSERT INTO sessoes (clinica_id, operador_id, token_hash, expira_em)
         VALUES ($1, $2, $3, now() + interval '30 minutes')`,
        [clinicaA, operador, hash()],
      ),
    )
    expect(r.ok, 'a RLS deixou o painel escrever numa clínica que ele não fixou').toBe(false)
  })

  it('a sessão de suporte da clínica A é invisível de dentro da clínica B', async () => {
    const r = await emTransacao(painel, clinicaB, `operador:${operador}`, async () => {
      const q = await painel.query<{ n: string }>(
        'SELECT count(*)::text AS n FROM sessoes WHERE token_hash = $1',
        [token],
      )
      return q.rows[0]!.n
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.valor).toBe('0')
  })

  it('`fir_painel` não tem BYPASSRLS nem SUPERUSER — a 0013 já cobrava, e continua valendo', async () => {
    const r = await migrate.query<{ escapa: boolean }>(
      `SELECT (rolbypassrls OR rolsuper) AS escapa FROM pg_roles WHERE rolname = 'fir_painel'`,
    )
    expect(r.rows[0]!.escapa).toBe(false)
  })

  it('`resolver_sessao` devolve UMA clínica, e é a da linha', async () => {
    const r = await app.query<{
      clinica_id: string
      pessoa_id: string | null
      operador_id: string | null
      operador_usuario: string | null
      operador_nome: string | null
    }>('SELECT * FROM resolver_sessao($1)', [token])
    expect(r.rows).toHaveLength(1)
    const s = r.rows[0]!
    expect(s.clinica_id).toBe(clinicaA)
    expect(s.pessoa_id).toBeNull()
    expect(s.operador_id).toBe(operador)
    expect(s.operador_usuario).toBe(`dono.${sufixo}`)
    expect(s.operador_nome).toBe('Dono do Painel')
  })

  it('`fir_app` continua sem alcançar `operadores` — o nome vem pela ponte, não por GRANT', async () => {
    const r = await emTransacao(app, clinicaA, pessoaA, () =>
      app.query('SELECT usuario FROM operadores LIMIT 1'),
    )
    expect(r.ok, 'fir_app ganhou acesso a `operadores`').toBe(false)
  })
})

// ---------------------------------------------------------------------------

describe('INVARIANTE 5 — curta e revogável', () => {
  it('a sessão de suporte de um operador DESATIVADO não resolve', async () => {
    const token = hash()
    await painel.query('BEGIN')
    await painel.query('SELECT set_config($1, $2, true)', [
      'app.pessoa_id',
      `operador:${operador}`,
    ])
    await painel.query('SELECT set_config($1, $2, true)', ['app.clinica_id', clinicaA])
    await painel.query(
      `INSERT INTO sessoes (clinica_id, operador_id, token_hash, expira_em)
       VALUES ($1, $2, $3, now() + interval '30 minutes')`,
      [clinicaA, operador, token],
    )
    await painel.query('COMMIT')

    expect((await app.query('SELECT * FROM resolver_sessao($1)', [token])).rows).toHaveLength(1)

    await migrate.query('UPDATE operadores SET ativo = false WHERE id = $1', [operador])
    try {
      expect(
        (await app.query('SELECT * FROM resolver_sessao($1)', [token])).rows,
        'operador desativado continuou com sessão viva dentro da clínica',
      ).toHaveLength(0)
    } finally {
      await migrate.query('UPDATE operadores SET ativo = true WHERE id = $1', [operador])
    }
  })

  it('desativar o operador NÃO derruba a sessão de uma pessoa', async () => {
    const token = hash()
    await app.query('BEGIN')
    await app.query('SELECT set_config($1, $2, true)', ['app.pessoa_id', pessoaA])
    await app.query('SELECT set_config($1, $2, true)', ['app.clinica_id', clinicaA])
    await app.query(
      `INSERT INTO sessoes (clinica_id, pessoa_id, token_hash, expira_em)
       VALUES ($1, $2, $3, now() + interval '30 days')`,
      [clinicaA, pessoaA, token],
    )
    await app.query('COMMIT')

    await migrate.query('UPDATE operadores SET ativo = false WHERE id = $1', [operador])
    try {
      const r = await app.query<{ pessoa_id: string | null }>(
        'SELECT pessoa_id FROM resolver_sessao($1)',
        [token],
      )
      expect(r.rows).toHaveLength(1)
      expect(r.rows[0]!.pessoa_id).toBe(pessoaA)
    } finally {
      await migrate.query('UPDATE operadores SET ativo = true WHERE id = $1', [operador])
    }
  })

  it('sair do painel revoga as sessões de suporte em TODAS as clínicas, e só as dele', async () => {
    const abrir = async (clinica: string): Promise<string> => {
      const token = hash()
      await painel.query('BEGIN')
      await painel.query('SELECT set_config($1, $2, true)', [
        'app.pessoa_id',
        `operador:${operador}`,
      ])
      await painel.query('SELECT set_config($1, $2, true)', ['app.clinica_id', clinica])
      await painel.query(
        `INSERT INTO sessoes (clinica_id, operador_id, token_hash, expira_em)
         VALUES ($1, $2, $3, now() + interval '30 minutes')`,
        [clinica, operador, token],
      )
      await painel.query('COMMIT')
      return token
    }

    const emA = await abrir(clinicaA)
    const emB = await abrir(clinicaB)

    // E uma sessão de PESSOA, que não pode ser tocada.
    const dePessoa = hash()
    await app.query('BEGIN')
    await app.query('SELECT set_config($1, $2, true)', ['app.pessoa_id', pessoaA])
    await app.query('SELECT set_config($1, $2, true)', ['app.clinica_id', clinicaA])
    await app.query(
      `INSERT INTO sessoes (clinica_id, pessoa_id, token_hash, expira_em)
       VALUES ($1, $2, $3, now() + interval '30 days')`,
      [clinicaA, pessoaA, dePessoa],
    )
    await app.query('COMMIT')

    // O painel revoga SEM fixar clínica nenhuma — é o ponto da função.
    await painel.query('BEGIN')
    await painel.query('SELECT set_config($1, $2, true)', [
      'app.pessoa_id',
      `operador:${operador}`,
    ])
    const quantas = await painel.query<{ revogar_sessoes_de_operador: number }>(
      'SELECT revogar_sessoes_de_operador($1)',
      [operador],
    )
    await painel.query('COMMIT')
    expect(quantas.rows[0]!.revogar_sessoes_de_operador).toBeGreaterThanOrEqual(2)

    expect((await app.query('SELECT * FROM resolver_sessao($1)', [emA])).rows).toHaveLength(0)
    expect((await app.query('SELECT * FROM resolver_sessao($1)', [emB])).rows).toHaveLength(0)
    expect(
      (await app.query('SELECT * FROM resolver_sessao($1)', [dePessoa])).rows,
      'a revogação do painel alcançou a sessão de uma PESSOA',
    ).toHaveLength(1)
  })

  it('a revogação em massa também cai na trilha de cada clínica, como operador', async () => {
    const r = await migrate.query<{ ator_tipo: string; clinica_id: string }>(
      `SELECT ator_tipo, clinica_id FROM auditoria
        WHERE entidade = 'sessoes' AND acao = 'alterou' AND ator_id = $1
          AND clinica_id IN ($2, $3)`,
      [operador, clinicaA, clinicaB],
    )
    expect(r.rows.length).toBeGreaterThanOrEqual(2)
    expect(new Set(r.rows.map((x) => x.ator_tipo))).toEqual(new Set(['operador']))
    expect(new Set(r.rows.map((x) => x.clinica_id))).toEqual(new Set([clinicaA, clinicaB]))
  })

  it('`fir_app` NÃO pode chamar a revogação em massa — ela é do painel', async () => {
    const r = await emTransacao(app, clinicaA, pessoaA, () =>
      app.query('SELECT revogar_sessoes_de_operador($1)', [operador]),
    )
    expect(r.ok, 'fir_app alcançou uma função que cruza clínicas').toBe(false)
  })
})
