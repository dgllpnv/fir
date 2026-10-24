import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { apagarClinicaDeTeste, declararAtorSistema } from './limpeza-de-teste'

/**
 * Testes de RLS vão contra Postgres real, nunca contra mock.
 *
 * Um mock que filtra por clínica prova que alguém escreveu um filtro — não que
 * o banco recusa a consulta que esqueceu de filtrar. É exatamente a consulta
 * esquecida que vaza o paciente de outra clínica.
 */
const URL_APP = process.env['DATABASE_URL'] ?? 'postgresql://fir_app:fir_local_dev@127.0.0.1:4832/fir'
const URL_MIG =
  process.env['DATABASE_URL_MIGRATE'] ?? 'postgresql://fir_migrate:fir_local_dev@127.0.0.1:4832/fir'

let migrate: pg.Client
let app: pg.Client
let clinicaA: string
let clinicaB: string

beforeAll(async () => {
  migrate = new pg.Client({ connectionString: URL_MIG })
  app = new pg.Client({ connectionString: URL_APP })
  // Sem isto, um `pg.Client` cru que recebe `'error'` do servidor (Postgres
  // reiniciando, outro teste encerrando backends) derruba o worker do
  // Vitest com um "Unhandled 'error' event" sem apontar a causa — o mesmo
  // defeito que a Rodada de correção 2 eliminou no `BancoService`, só que
  // aqui.
  migrate.on('error', (erro) => console.error('[banco.test] cliente migrate:', erro.message))
  app.on('error', (erro) => console.error('[banco.test] cliente app:', erro.message))
  await migrate.connect()
  await app.connect()
  // A trigger `registrar_auditoria` recusa escrita sem ator declarado, e
  // fixture não tem pessoa autenticada por trás: é o sistema criando dado.
  await declararAtorSistema(migrate)

  const sufixo = Date.now()
  const a = await migrate.query<{ id: string }>(
    `INSERT INTO clinicas (codigo, nome) VALUES ($1, 'Clínica A') RETURNING id`,
    [`teste-a-${sufixo}`],
  )
  const b = await migrate.query<{ id: string }>(
    `INSERT INTO clinicas (codigo, nome) VALUES ($1, 'Clínica B') RETURNING id`,
    [`teste-b-${sufixo}`],
  )
  clinicaA = a.rows[0]!.id
  clinicaB = b.rows[0]!.id

  for (const [clinica, chave] of [
    [clinicaA, 'pf_a'],
    [clinicaB, 'pf_b'],
  ] as const) {
    await migrate.query(
      `INSERT INTO perfis (clinica_id, chave, nome, perms) VALUES ($1, $2, 'Recepção', '{jornada}')`,
      [clinica, chave],
    )
    await migrate.query(
      `INSERT INTO pessoas (clinica_id, nome, email, senha_hash, perfil_id)
       SELECT $1, 'Fulana', $2, 'x', id FROM perfis WHERE clinica_id = $1`,
      [clinica, `fulana@${chave}.local`],
    )
  }
})

afterAll(async () => {
  for (const c of [clinicaA, clinicaB]) await apagarClinicaDeTeste(migrate, c)
  await migrate.end()
  await app.end()
})

async function comClinica<T>(clinica: string, fn: () => Promise<T>): Promise<T> {
  await app.query('BEGIN')
  await app.query('SELECT set_config($1, $2, true)', ['app.clinica_id', clinica])
  try {
    return await fn()
  } finally {
    await app.query('COMMIT')
  }
}

describe('RLS — a clínica é a fronteira', () => {
  it('cada clínica enxerga só as próprias pessoas', async () => {
    const naA = await comClinica(clinicaA, () => app.query('SELECT email FROM pessoas'))
    expect(naA.rows.map((r) => r.email)).toEqual(['fulana@pf_a.local'])

    const naB = await comClinica(clinicaB, () => app.query('SELECT email FROM pessoas'))
    expect(naB.rows.map((r) => r.email)).toEqual(['fulana@pf_b.local'])
  })

  it('buscar o id da outra clínica devolve vazio — não erro, vazio', async () => {
    const r = await comClinica(clinicaA, () =>
      app.query('SELECT email FROM pessoas WHERE clinica_id = $1', [clinicaB]),
    )
    expect(r.rows).toHaveLength(0)
  })

  it('sem fixar a clínica, o banco não entrega nada', async () => {
    await app.query('BEGIN')
    const r = await app.query('SELECT count(*)::int AS n FROM pessoas')
    await app.query('COMMIT')
    expect(r.rows[0]!.n).toBe(0)
  })

  it('não é possível gravar para outra clínica', async () => {
    await expect(
      comClinica(clinicaA, () =>
        app.query(
          `INSERT INTO perfis (clinica_id, chave, nome) VALUES ($1, 'invasor', 'Invasor')`,
          [clinicaB],
        ),
      ),
    ).rejects.toThrow(/row-level security/i)
  })
})
