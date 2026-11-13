import { situacaoDoFechamento } from '@fir/domain'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { sqlParcial } from './parcial'

/**
 * O SQL e o domínio dão a MESMA resposta para "parcial".
 *
 * `sqlParcial` é o par, em SQL, de `situacaoDoFechamento`. Cada linha abaixo é
 * uma combinação de etapa, oferecido e fechado (inclusive os `NULL` do dado
 * anterior à coluna), e o banco real avalia o fragmento — nada de mock.
 */
const URL_MIG =
  process.env['DATABASE_URL_MIGRATE'] ?? 'postgresql://fir_migrate:fir_local_dev@127.0.0.1:4832/fir'

let cliente: pg.Client
beforeAll(async () => {
  cliente = new pg.Client({ connectionString: URL_MIG })
  await cliente.connect()
})
afterAll(async () => {
  await cliente.end()
})

const CASOS: readonly [string, bigint | null, bigint | null][] = [
  ['fechado', 2_500_000n, 1_500_000n],
  ['fechado', 2_500_000n, 2_500_000n],
  ['fechado', 2_500_000n, 3_000_000n],
  ['fechado', 2_500_000n, 2_499_999n],
  ['fechado', 2_500_000n, null],
  ['fechado', null, 100n],
  ['fechado', null, null],
  ['orcamento', 2_500_000n, null],
  ['perdido', 2_500_000n, 1n],
]

describe('sqlParcial = situacaoDoFechamento', () => {
  it.each(CASOS)('%s, oferecido %s, fechado %s', async (etapa, oferecido, fechado) => {
    const r = await cliente.query<{ parcial: boolean }>(
      `SELECT ${sqlParcial('t')} AS parcial
         FROM (SELECT $1::text AS etapa, $2::bigint AS valor_orcamento, $3::bigint AS valor_fechado) t`,
      [etapa, oferecido?.toString() ?? null, fechado?.toString() ?? null],
    )
    // Só o cartão FECHADO pode ser parcial; a regra de valores é a do domínio.
    const esperado = etapa === 'fechado' && situacaoDoFechamento(oferecido, fechado) === 'parcial'
    expect(r.rows[0]!.parcial).toBe(esperado)
  })
})
