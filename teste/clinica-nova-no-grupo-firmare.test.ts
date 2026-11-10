import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  apagarClinicaDeTeste,
  apagarHistoricoGrupoDeTeste,
  apagarOperadorDeTeste,
  declararAtorSistema,
} from '@fir/api/banco/limpeza-de-teste'

/**
 * Migration 0067: clínica nova entra sozinha no Grupo Firmare.
 * Spec docs/specs/clinica-nova-entra-no-grupo-firmare.md, com os pareceres de
 * appsec e LGPD. Contra Postgres real: RLS e gatilhos não se mockam.
 */
const URL_MIG =
  process.env['DATABASE_URL_MIGRATE'] ?? 'postgresql://fir_migrate:fir_local_dev@127.0.0.1:4832/fir'
const URL_CARTEIRA =
  process.env['DATABASE_URL_CARTEIRA'] ?? 'postgresql://fir_carteira:fir_local_dev@127.0.0.1:4832/fir'

const sufixo = `${Date.now()}`
let m: pg.Client
let operador: string
let grupoPadrao: string
let grupoOutro: string
const clinicas: string[] = []
const usuarios: string[] = []

const comoOperador = (c: pg.Client, id: string) =>
  c.query(`SELECT set_config('app.pessoa_id', $1, false)`, [`operador:${id}`])

async function novaClinica(codigo: string, nome = 'Clínica de Teste Firmare'): Promise<string> {
  const id = (
    await m.query<{ id: string }>(
      `INSERT INTO clinicas (codigo, nome) VALUES ($1, $2) RETURNING id`,
      [`fg-${sufixo}-${codigo}`, nome],
    )
  ).rows[0]!.id
  clinicas.push(id)
  return id
}

const clienteDa = async (clinicaId: string) =>
  (
    await m.query<{ grupo_id: string; nome: string; produto: string; status: string; mensalidade: string | null }>(
      `SELECT grupo_id, nome, produto, status, mensalidade_centavos::text AS mensalidade
         FROM clientes_carteira WHERE clinica_id = $1`,
      [clinicaId],
    )
  ).rows

const historicoDa = async (clinicaId: string) =>
  (
    await m.query<{ grupo_anterior_id: string | null; grupo_novo_id: string; mudado_por: string; motivo: string }>(
      `SELECT grupo_anterior_id, grupo_novo_id, mudado_por, motivo
         FROM historico_grupo_da_clinica WHERE clinica_id = $1`,
      [clinicaId],
    )
  ).rows

beforeAll(async () => {
  m = new pg.Client({ connectionString: URL_MIG })
  m.on('error', (e) => console.error('[clinica-nova-no-grupo-firmare]', e.message))
  await m.connect()
  await declararAtorSistema(m)
  operador = (
    await m.query<{ id: string }>(
      `INSERT INTO operadores (usuario, nome, senha_hash) VALUES ($1, 'Dono Teste', 'x') RETURNING id`,
      [`fg.op.${sufixo}`],
    )
  ).rows[0]!.id
  grupoPadrao = (await m.query<{ id: string }>(`SELECT id FROM grupos WHERE padrao`)).rows[0]!.id
  grupoOutro = (
    await m.query<{ id: string }>(`INSERT INTO grupos (nome) VALUES ('Grupo Outro FG') RETURNING id`)
  ).rows[0]!.id
})

afterAll(async () => {
  await declararAtorSistema(m)
  for (const id of usuarios) await m.query('DELETE FROM usuarios_gestao WHERE id = $1', [id])
  for (const id of clinicas) {
    await m.query('DELETE FROM clientes_carteira WHERE clinica_id = $1', [id])
    await apagarHistoricoGrupoDeTeste(m, id)
    await apagarClinicaDeTeste(m, id)
  }
  await m.query('DELETE FROM grupos WHERE id = $1', [grupoOutro])
  await apagarOperadorDeTeste(m, operador)
  await m.end()
})

describe('o grupo padrão existe e é um só', () => {
  it('há exatamente um grupo padrão, chamado Firmare, ativo', async () => {
    const r = await m.query<{ nome: string; ativo: boolean }>(`SELECT nome, ativo FROM grupos WHERE padrao`)
    expect(r.rows).toEqual([{ nome: 'Firmare', ativo: true }])
  })

  it('um segundo grupo padrão é recusado pelo índice único', async () => {
    await expect(m.query(`INSERT INTO grupos (nome, padrao) VALUES ('Outro Firmare', true)`)).rejects.toThrow(
      /grupos_um_so_padrao/,
    )
  })

  it('não se desativa, não se apaga e não deixa de ser padrão', async () => {
    await expect(m.query(`UPDATE grupos SET ativo = false WHERE id = $1`, [grupoPadrao])).rejects.toThrow(
      /grupo padrão não se desativa/,
    )
    await expect(m.query(`UPDATE grupos SET padrao = false WHERE id = $1`, [grupoPadrao])).rejects.toThrow(
      /grupo padrão não se desativa/,
    )
    await expect(m.query(`DELETE FROM grupos WHERE id = $1`, [grupoPadrao])).rejects.toThrow(/não se apaga/)
  })

  it('renomear é permitido', async () => {
    await m.query(`UPDATE grupos SET nome = 'Firmare ' WHERE id = $1`, [grupoPadrao])
    await m.query(`UPDATE grupos SET nome = 'Firmare' WHERE id = $1`, [grupoPadrao])
  })
})

describe('clínica criada por um operador entra no grupo Firmare', () => {
  it('gera histórico de grupo e Cliente Firmare, nesta ordem lógica, na mesma criação', async () => {
    await comoOperador(m, operador)
    const id = await novaClinica('a', 'Clínica A do Firmare')
    expect(await historicoDa(id)).toEqual([
      { grupo_anterior_id: null, grupo_novo_id: grupoPadrao, mudado_por: operador, motivo: 'clínica nova' },
    ])
    expect(await clienteDa(id)).toEqual([
      { grupo_id: grupoPadrao, nome: 'Clínica A do Firmare', produto: 'FIR Clinic', status: 'onboarding', mensalidade: '0' },
    ])
  })

  it('duas clínicas seguidas geram dois clientes e continua um só grupo padrão', async () => {
    await comoOperador(m, operador)
    const a = await novaClinica('b1')
    const b = await novaClinica('b2')
    expect((await clienteDa(a)).length).toBe(1)
    expect((await clienteDa(b)).length).toBe(1)
    expect((await m.query(`SELECT 1 FROM grupos WHERE padrao`)).rowCount).toBe(1)
  })

  it('a criação do cliente fica na trilha da própria clínica, com ator operador', async () => {
    await comoOperador(m, operador)
    const id = await novaClinica('c')
    const r = await m.query<{ ator_tipo: string }>(
      `SELECT ator_tipo FROM auditoria WHERE clinica_id = $1 AND entidade = 'clientes_carteira'`,
      [id],
    )
    expect(r.rows.map((x) => x.ator_tipo)).toEqual(['operador'])
  })

  it('código de clínica repetido continua sendo recusado e não deixa cliente a mais', async () => {
    await comoOperador(m, operador)
    await novaClinica('d')
    const antes = (await m.query(`SELECT count(*)::int AS n FROM clientes_carteira`)).rows[0]!.n
    await expect(novaClinica('d')).rejects.toThrow(/clinicas_codigo_key/)
    expect((await m.query(`SELECT count(*)::int AS n FROM clientes_carteira`)).rows[0]!.n).toBe(antes)
  })
})

describe('sem operador válido a clínica nasce normal e fica sem carteira', () => {
  it.each([
    ['ator sistema', 'sistema'],
    ['ator vazio', ''],
    ['operador com uuid mal formado', 'operador:nao-e-um-uuid'],
    ['operador que não existe', `operador:${randomUUID()}`],
    ['pessoa de clínica', `pessoa:${randomUUID()}`],
  ])('%s', async (_nome, ator) => {
    await m.query(`SELECT set_config('app.pessoa_id', $1, false)`, [ator])
    // Um ator que o `registrar_auditoria` (anterior a esta migration) não sabe
    // ler pode recusar a criação por conta própria. O que se prova aqui é que
    // o NOSSO gatilho nunca é a origem do erro, e que, quando a clínica nasce,
    // ela nasce sem carteira.
    let id: string | null = null
    try {
      id = await novaClinica(`s-${ator.length}-${Math.floor(Math.random() * 1e6)}`)
    } catch (e) {
      expect(String((e as { where?: string }).where ?? '')).not.toMatch(/clinica_nova_entra_no_grupo_padrao/)
    }
    if (id !== null) {
      expect(await clienteDa(id)).toEqual([])
      expect(await historicoDa(id)).toEqual([])
    }
    await declararAtorSistema(m)
  })
})

describe('Usuário de Gestão de escopo grupo nunca é do grupo padrão', () => {
  it('criar com escopo grupo apontando para o padrão é recusado pelo banco', async () => {
    await expect(
      m.query(
        `INSERT INTO usuarios_gestao (usuario, nome, senha_hash, escopo, grupo_id)
         VALUES ($1, 'Teste', 'x', 'grupo', $2)`,
        [`fg.u1.${sufixo}`, grupoPadrao],
      ),
    ).rejects.toThrow(/não pode ser do grupo padrão/)
  })

  it('mover um usuário de grupo para o padrão (UPDATE) também é recusado', async () => {
    const id = (
      await m.query<{ id: string }>(
        `INSERT INTO usuarios_gestao (usuario, nome, senha_hash, escopo, grupo_id)
         VALUES ($1, 'Teste', 'x', 'grupo', $2) RETURNING id`,
        [`fg.u2.${sufixo}`, grupoOutro],
      )
    ).rows[0]!.id
    usuarios.push(id)
    await expect(m.query(`UPDATE usuarios_gestao SET grupo_id = $2 WHERE id = $1`, [id, grupoPadrao])).rejects.toThrow(
      /não pode ser do grupo padrão/,
    )
  })

  it('escopo geral continua permitido (sem grupo)', async () => {
    const id = (
      await m.query<{ id: string }>(
        `INSERT INTO usuarios_gestao (usuario, nome, senha_hash, escopo)
         VALUES ($1, 'Teste', 'x', 'geral') RETURNING id`,
        [`fg.u3.${sufixo}`],
      )
    ).rows[0]!.id
    usuarios.push(id)
  })
})

describe('isolamento: quem é de outro grupo não vê a clínica nova', () => {
  async function conectarCarteira(): Promise<pg.Client> {
    const c = new pg.Client({ connectionString: URL_CARTEIRA })
    c.on('error', () => undefined)
    await c.connect()
    return c
  }

  it('escopo grupo (outro grupo) não vê; escopo geral vê', async () => {
    await comoOperador(m, operador)
    const id = await novaClinica('iso')
    const cliente = (await m.query<{ id: string }>(`SELECT id FROM clientes_carteira WHERE clinica_id = $1`, [id])).rows[0]!.id

    const outro = await conectarCarteira()
    try {
      await outro.query(`SELECT set_config('app.escopo', 'grupo', false)`)
      await outro.query(`SELECT set_config('app.grupo_id', $1, false)`, [grupoOutro])
      expect((await outro.query(`SELECT 1 FROM clientes_carteira WHERE id = $1`, [cliente])).rowCount).toBe(0)
    } finally {
      await outro.end()
    }

    const geral = await conectarCarteira()
    try {
      await geral.query(`SELECT set_config('app.escopo', 'geral', false)`)
      expect((await geral.query(`SELECT 1 FROM clientes_carteira WHERE id = $1`, [cliente])).rowCount).toBe(1)
    } finally {
      await geral.end()
    }
  })
})

describe('as funções dos gatilhos não são chamáveis pela aplicação', () => {
  it.each(['clinica_nova_entra_no_grupo_padrao()', 'grupos_padrao_fixo()', 'usuario_de_gestao_nao_e_do_grupo_padrao()'])(
    '%s',
    async (f) => {
      const r = await m.query<{ painel: boolean; carteira: boolean; app: boolean }>(
        `SELECT has_function_privilege('fir_painel', $1, 'EXECUTE') AS painel,
                has_function_privilege('fir_carteira', $1, 'EXECUTE') AS carteira,
                has_function_privilege('fir_app', $1, 'EXECUTE') AS app`,
        [f],
      )
      expect(r.rows[0]).toEqual({ painel: false, carteira: false, app: false })
    },
  )
})
