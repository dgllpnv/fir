import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { apagarClinicaDeTeste, apagarHistoricoGrupoDeTeste, apagarOperadorDeTeste, declararAtorSistema } from '@fir/api/banco/limpeza-de-teste'

/**
 * Migration 0071: `trocar_pagador_da_clinica`, direto no banco. Postgres real.
 * Seam: repositórios sobre Postgres real (a função é a barreira; a API é a 2a).
 */
const URL_MIG = process.env['DATABASE_URL_MIGRATE'] ?? 'postgresql://fir_migrate:fir_local_dev@127.0.0.1:4832/fir'
const sufixo = `${Date.now()}`
let m: pg.Client
let operador: string
let clinica: string
let cliente: string
const ator = (a: string) => m.query(`SELECT set_config('app.pessoa_id', $1, false)`, [a])
const trocar = (c: string, cl: string, motivo: string) => m.query('SELECT trocar_pagador_da_clinica($1, $2, $3)', [c, cl, motivo])

beforeAll(async () => {
  m = new pg.Client({ connectionString: URL_MIG })
  await m.connect()
  await declararAtorSistema(m)
  operador = (await m.query<{ id: string }>(`INSERT INTO operadores (usuario, nome, senha_hash) VALUES ($1, 'Dono 0071', 'x') RETURNING id`, [`e71.${sufixo}`])).rows[0]!.id
  await ator(`operador:${operador}`)
  clinica = (await m.query<{ id: string }>(`INSERT INTO clinicas (codigo, nome) VALUES ($1, 'Clinica 0071') RETURNING id`, [`e71-${sufixo}`])).rows[0]!.id
  await declararAtorSistema(m)
  cliente = (await m.query<{ id: string }>(`SELECT id FROM clientes_carteira WHERE clinica_id = $1`, [clinica])).rows[0]!.id
})

afterAll(async () => {
  await declararAtorSistema(m)
  await m.query('DELETE FROM clientes_carteira WHERE clinica_id = $1', [clinica])
  await apagarHistoricoGrupoDeTeste(m, clinica)
  await apagarClinicaDeTeste(m, clinica)
  await apagarOperadorDeTeste(m, operador)
  await m.end()
})

describe('0071: trocar_pagador_da_clinica', () => {
  it.each([
    ['sistema', 'sistema'],
    ['sem ator', ''],
    ['usuário de gestão', 'usuario_gestao:00000000-0000-0000-0000-000000000001'],
    ['operador inexistente', 'operador:00000000-0000-0000-0000-0000000000ff'],
  ])('ator %s falha com 42501', async (_n, a) => {
    await ator(a)
    await expect(trocar(clinica, cliente, 'motivo valido')).rejects.toMatchObject({ code: '42501' })
  })

  it.each(['', 'ab', 'x'.repeat(301)])('motivo inválido (%#) falha com 23514', async (motivo) => {
    await ator(`operador:${operador}`)
    await expect(trocar(clinica, cliente, motivo)).rejects.toMatchObject({ code: '23514', constraint: 'pagador_motivo_obrigatorio' })
  })

  it('só o fir_carteira executa; fir_app e fir_painel não', async () => {
    const r = await m.query<{ c: boolean; a: boolean; p: boolean }>(
      `SELECT has_function_privilege('fir_carteira', 'trocar_pagador_da_clinica(uuid, uuid, text)', 'EXECUTE') AS c,
              has_function_privilege('fir_app', 'trocar_pagador_da_clinica(uuid, uuid, text)', 'EXECUTE') AS a,
              has_function_privilege('fir_painel', 'trocar_pagador_da_clinica(uuid, uuid, text)', 'EXECUTE') AS p`,
    )
    expect(r.rows[0]).toEqual({ c: true, a: false, p: false })
  })

  it('search_path fixo com pg_temp por último', async () => {
    const r = await m.query<{ cfg: string[] }>(`SELECT proconfig AS cfg FROM pg_proc WHERE proname = 'trocar_pagador_da_clinica'`)
    expect(r.rows[0]!.cfg).toContain('search_path=pg_catalog, public, pg_temp')
  })

  it('o operador da sessão, com o mesmo cliente que já paga, não muda nada', async () => {
    await ator(`operador:${operador}`)
    await trocar(clinica, cliente, 'ja paga e fica')
    const n = await m.query(`SELECT 1 FROM clientes_carteira WHERE clinica_id = $1 AND conta_na_receita`, [clinica])
    expect(n.rowCount).toBe(1)
  })
})
