import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { apagarClinicaDeTeste, declararAtorSistema } from '@fir/api/banco/limpeza-de-teste'

/**
 * Migration 0075 — perfil "Gestão de pessoas" nas clínicas existentes (P-2).
 * Idempotente, não recria o que a clínica excluiu, não colide com nome igual,
 * e não atribui a ninguém. Postgres real: a trigger de auditoria e o índice de
 * nome único participam.
 */
const URL_MIG =
  process.env['DATABASE_URL_MIGRATE'] ?? 'postgresql://fir_migrate:fir_local_dev@127.0.0.1:4832/fir'
const SQL = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'apps', 'api', 'migrations', '0075_perfil_gestao_de_pessoas.sql'),
  'utf8',
)

let m: pg.Client
const sufixo = `${Date.now()}`
const clinicas: string[] = []

const nova = async (cod: string) => {
  const id = (
    await m.query<{ id: string }>(`INSERT INTO clinicas (codigo, nome) VALUES ($1,'Clínica 0075') RETURNING id`, [
      `p75-${sufixo}-${cod}`,
    ])
  ).rows[0]!.id
  clinicas.push(id)
  return id
}
const rodar = async () => {
  await m.query('BEGIN')
  await m.query(SQL)
  await m.query('COMMIT')
}
const perfisDe = async (c: string) =>
  (
    await m.query<{ chave: string; nome: string; perms: string[]; excluido_em: Date | null }>(
      `SELECT chave, nome, perms, excluido_em FROM perfis WHERE clinica_id = $1 ORDER BY chave`,
      [c],
    )
  ).rows

beforeAll(async () => {
  m = new pg.Client({ connectionString: URL_MIG })
  await m.connect()
  await declararAtorSistema(m)
})
afterAll(async () => {
  for (const c of clinicas) await apagarClinicaDeTeste(m, c)
  await m.end()
})

describe('0075', () => {
  it('cria o perfil com só pessoas.gerir, e rodar de novo não duplica', async () => {
    const a = await nova('a')
    await rodar()
    await rodar()
    const p = await perfisDe(a)
    expect(p).toHaveLength(1)
    expect(p[0]).toMatchObject({ chave: 'pf_ges', nome: 'Gestão de pessoas', perms: ['pessoas.gerir'] })
  })

  it('não recria o que a clínica EXCLUIU', async () => {
    const b = await nova('b')
    await m.query(
      `INSERT INTO perfis (clinica_id, chave, nome, perms, excluido_em) VALUES ($1,'pf_ges','Gestão de pessoas','{pessoas.gerir}', now())`,
      [b],
    )
    await rodar()
    const p = await perfisDe(b)
    expect(p).toHaveLength(1)
    expect(p[0]!.excluido_em).not.toBeNull()
  })

  it('não colide com perfil de nome igual (ativo ou excluído, outra chave)', async () => {
    const c = await nova('c')
    const d = await nova('d')
    await m.query(`INSERT INTO perfis (clinica_id, chave, nome, perms) VALUES ($1,'pf_x','gestao de PESSOAS','{estoque}')`, [c])
    await m.query(
      `INSERT INTO perfis (clinica_id, chave, nome, perms, excluido_em) VALUES ($1,'pf_y','Gestão de pessoas','{estoque}', now())`,
      [d],
    )
    await rodar()
    expect(await perfisDe(c)).toHaveLength(1)
    expect(await perfisDe(d)).toHaveLength(1)
  })

  it('não atribui a ninguém', async () => {
    const e = await nova('e')
    await m.query(
      `INSERT INTO pessoas (clinica_id, nome, usuario, senha_hash, admin) VALUES ($1,'Eva','eva','x',true)`,
      [e],
    )
    await rodar()
    const r = await m.query(`SELECT count(*)::int AS n FROM pessoas WHERE clinica_id = $1 AND perfil_id IS NOT NULL`, [e])
    expect(r.rows[0].n).toBe(0)
  })
})
