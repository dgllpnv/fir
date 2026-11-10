import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  apagarClinicaDeTeste,
  apagarOperadorDeTeste,
  declararAtorSistema,
} from '@fir/api/banco/limpeza-de-teste'

/**
 * Migration 0072: `grupos_que_recebem_a_clinica()` devolve também o motivo.
 * Postgres real, papéis reais (`fir_app` chama a função; a tabela é fechada
 * para ele).
 */
const URL_MIG =
  process.env['DATABASE_URL_MIGRATE'] ?? 'postgresql://fir_migrate:fir_local_dev@127.0.0.1:4832/fir'
const URL_CARTEIRA =
  process.env['DATABASE_URL_CARTEIRA'] ?? 'postgresql://fir_carteira:fir_local_dev@127.0.0.1:4832/fir'
const URL_APP = process.env['DATABASE_URL'] ?? 'postgresql://fir_app:fir_local_dev@127.0.0.1:4832/fir'

const sufixo = `${Date.now()}`
let m: pg.Client
let operador: string
let clinicaA: string
let clinicaB: string
const grupos: string[] = []
let grupoX: string
let grupoY: string

async function comoCarteira<T>(f: (c: pg.Client) => Promise<T>): Promise<T> {
  const c = new pg.Client({ connectionString: URL_CARTEIRA })
  await c.connect()
  try {
    await c.query(`SELECT set_config('app.pessoa_id', $1, false), set_config('app.escopo', 'geral', false)`, [
      `operador:${operador}`,
    ])
    return await f(c)
  } finally {
    await c.end()
  }
}

async function visiveisPara(clinica: string): Promise<{ grupo: string; desde: Date; motivo: string }[]> {
  const c = new pg.Client({ connectionString: URL_APP })
  await c.connect()
  try {
    await c.query(`SELECT set_config('app.clinica_id', $1, false)`, [clinica])
    return (await c.query('SELECT grupo, desde, motivo FROM grupos_que_recebem_a_clinica()')).rows
  } finally {
    await c.end()
  }
}

beforeAll(async () => {
  m = new pg.Client({ connectionString: URL_MIG })
  m.on('error', (e) => console.error('[grupos-da-clinica]', e.message))
  await m.connect()
  await declararAtorSistema(m)
  operador = (
    await m.query<{ id: string }>(
      `INSERT INTO operadores (usuario, nome, senha_hash) VALUES ($1, 'Dono Teste', 'x') RETURNING id`,
      [`gc.op.${sufixo}`],
    )
  ).rows[0]!.id
  const nova = async (i: number) =>
    (
      await m.query<{ id: string }>(`INSERT INTO clinicas (codigo, nome) VALUES ($1, $2) RETURNING id`, [
        `gc-${sufixo}-${i}`,
        `Clínica GC ${i}`,
      ])
    ).rows[0]!.id
  clinicaA = await nova(1)
  clinicaB = await nova(2)
  for (const nome of ['Grupo X 0072', 'Grupo Y 0072']) {
    grupos.push((await m.query<{ id: string }>(`INSERT INTO grupos (nome) VALUES ($1) RETURNING id`, [nome])).rows[0]!.id)
  }
  grupoX = grupos[0]!
  grupoY = grupos[1]!
})

afterAll(async () => {
  await declararAtorSistema(m)
  await apagarClinicaDeTeste(m, clinicaA)
  await apagarClinicaDeTeste(m, clinicaB)
  for (const g of grupos) await m.query('DELETE FROM grupos WHERE id = $1', [g])
  await apagarOperadorDeTeste(m, operador)
  await m.end()
})

describe('grupos_que_recebem_a_clinica (0072)', () => {
  it('devolve nome, desde e o motivo cru, sem o prefixo do histórico', async () => {
    await comoCarteira((c) => c.query('SELECT adicionar_clinica_ao_grupo($1, $2, $3)', [clinicaA, grupoX, 'rede parceira']))
    const r = await visiveisPara(clinicaA)
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ grupo: 'Grupo X 0072', motivo: 'rede parceira' })
    expect(r[0]!.desde).toBeInstanceOf(Date)
  })

  it('a clínica A não vê o grupo da B, e vice-versa', async () => {
    await comoCarteira((c) => c.query('SELECT adicionar_clinica_ao_grupo($1, $2, $3)', [clinicaB, grupoY, 'outra rede']))
    expect((await visiveisPara(clinicaA)).map((x) => x.grupo)).toEqual(['Grupo X 0072'])
    expect((await visiveisPara(clinicaB)).map((x) => x.grupo)).toEqual(['Grupo Y 0072'])
  })

  it('só devolve as três colunas combinadas: nada de cliente, valor ou contato', async () => {
    const c = new pg.Client({ connectionString: URL_APP })
    await c.connect()
    try {
      await c.query(`SELECT set_config('app.clinica_id', $1, false)`, [clinicaA])
      const r = await c.query('SELECT * FROM grupos_que_recebem_a_clinica()')
      expect(r.fields.map((f) => f.name)).toEqual(['grupo', 'desde', 'motivo'])
    } finally {
      await c.end()
    }
  })

  it('sem clínica na sessão não devolve nada', async () => {
    const c = new pg.Client({ connectionString: URL_APP })
    await c.connect()
    try {
      const r = await c.query('SELECT * FROM grupos_que_recebem_a_clinica()')
      expect(r.rows).toEqual([])
    } finally {
      await c.end()
    }
  })

  it('grupo desativado sai da lista', async () => {
    await m.query('UPDATE grupos SET ativo = false WHERE id = $1', [grupoX])
    try {
      expect(await visiveisPara(clinicaA)).toEqual([])
    } finally {
      await m.query('UPDATE grupos SET ativo = true WHERE id = $1', [grupoX])
    }
  })

  it('participação encerrada e grupo de arquivo não aparecem', async () => {
    await comoCarteira((c) => c.query('SELECT encerrar_participacao_da_clinica($1, $2, $3)', [clinicaB, grupoY, 'saiu da rede']))
    expect(await visiveisPara(clinicaB)).toEqual([])

    // Mesmo que uma participação apontasse para o arquivo, a lista a omite.
    const arquivo = (await m.query<{ id: string }>('SELECT id FROM grupos WHERE arquivo')).rows[0]!.id
    const dentro = await comoCarteira((c) =>
      c.query('SELECT adicionar_clinica_ao_grupo($1, $2, $3)', [clinicaB, arquivo, 'tentativa']).then(
        () => true,
        () => false,
      ),
    )
    const nomes = (await visiveisPara(clinicaB)).map((x) => x.grupo)
    expect(nomes).not.toContain('Encerrados')
    if (dentro) expect(nomes).toEqual([])
  })

  it('fir_app executa a função mas não lê a tabela', async () => {
    const c = new pg.Client({ connectionString: URL_APP })
    await c.connect()
    try {
      await expect(c.query('SELECT 1 FROM participacao_clinica_grupo')).rejects.toThrow(/permission denied/)
    } finally {
      await c.end()
    }
  })
})
