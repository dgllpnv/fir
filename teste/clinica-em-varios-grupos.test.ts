import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  apagarClinicaDeTeste,
  apagarOperadorDeTeste,
  declararAtorSistema,
} from '@fir/api/banco/limpeza-de-teste'

/**
 * Migration 0068: a clínica em vários grupos; o Firmare contém todas.
 * Spec docs/specs/clinica-em-varios-grupos.md (gate de appsec, LGPD e números).
 * Postgres real, papéis reais: RLS e gatilhos não se mockam.
 */
const URL_MIG =
  process.env['DATABASE_URL_MIGRATE'] ?? 'postgresql://fir_migrate:fir_local_dev@127.0.0.1:4832/fir'
const URL_CARTEIRA =
  process.env['DATABASE_URL_CARTEIRA'] ?? 'postgresql://fir_carteira:fir_local_dev@127.0.0.1:4832/fir'

const sufixo = `${Date.now()}`
let m: pg.Client
let operador: string
let grupoPadrao: string
let grupoX: string
let grupoY: string
const clinicas: string[] = []
const grupos: string[] = []

const comoOperador = (c: pg.Client) =>
  c.query(`SELECT set_config('app.pessoa_id', $1, false), set_config('app.escopo', 'geral', false)`, [`operador:${operador}`])
const comoGrupo = (c: pg.Client, grupo: string) =>
  c.query(
    `SELECT set_config('app.pessoa_id', 'usuario_gestao:00000000-0000-0000-0000-000000000001', false),
            set_config('app.escopo', 'grupo', false), set_config('app.grupo_id', $1, false)`,
    [grupo],
  )

async function conexaoCarteira(): Promise<pg.Client> {
  const c = new pg.Client({ connectionString: URL_CARTEIRA })
  await c.connect()
  return c
}

async function novaClinica(nome = 'Clínica Teste 0068'): Promise<string> {
  const id = (
    await m.query<{ id: string }>(`INSERT INTO clinicas (codigo, nome) VALUES ($1, $2) RETURNING id`, [
      `vg-${sufixo}-${clinicas.length}`,
      nome,
    ])
  ).rows[0]!.id
  clinicas.push(id)
  return id
}

const clientes = async (clinicaId: string) =>
  (
    await m.query<{ grupo_id: string; conta: boolean; mensalidade: string; nome: string; excluido: boolean }>(
      `SELECT grupo_id, conta_na_receita AS conta, mensalidade_centavos::text AS mensalidade, nome,
              excluido_em IS NOT NULL AS excluido
         FROM clientes_carteira WHERE clinica_id = $1 ORDER BY criado_em`,
      [clinicaId],
    )
  ).rows

const participacoes = async (clinicaId: string) =>
  (
    await m.query<{ grupo_id: string; ativa: boolean }>(
      `SELECT grupo_id, ate IS NULL AS ativa FROM participacao_clinica_grupo WHERE clinica_id = $1 ORDER BY id`,
      [clinicaId],
    )
  ).rows

/** Cria uma clínica COMO operador (o gatilho 0067 a põe no Firmare). */
async function clinicaNoFirmare(): Promise<string> {
  await comoOperador(m)
  const id = await novaClinica()
  await declararAtorSistema(m)
  return id
}

beforeAll(async () => {
  m = new pg.Client({ connectionString: URL_MIG })
  m.on('error', (e) => console.error('[clinica-em-varios-grupos]', e.message))
  await m.connect()
  await declararAtorSistema(m)
  operador = (
    await m.query<{ id: string }>(
      `INSERT INTO operadores (usuario, nome, senha_hash) VALUES ($1, 'Dono Teste', 'x') RETURNING id`,
      [`vg.op.${sufixo}`],
    )
  ).rows[0]!.id
  grupoPadrao = (await m.query<{ id: string }>(`SELECT id FROM grupos WHERE padrao`)).rows[0]!.id
  for (const nome of ['Grupo X 0068', 'Grupo Y 0068']) {
    const id = (await m.query<{ id: string }>(`INSERT INTO grupos (nome) VALUES ($1) RETURNING id`, [nome])).rows[0]!.id
    grupos.push(id)
  }
  grupoX = grupos[0]!
  grupoY = grupos[1]!
})

afterAll(async () => {
  await declararAtorSistema(m)
  for (const id of clinicas) await apagarClinicaDeTeste(m, id)
  for (const g of grupos) await m.query('DELETE FROM grupos WHERE id = $1', [g])
  await apagarOperadorDeTeste(m, operador)
  await m.end()
})

describe('clínica nova: participação e cliente no Firmare', () => {
  it('nasce com 1 participação ativa no Firmare e 1 cliente que conta na receita, mensalidade 0', async () => {
    const id = await clinicaNoFirmare()
    expect(await participacoes(id)).toEqual([{ grupo_id: grupoPadrao, ativa: true }])
    expect(await clientes(id)).toEqual([
      { grupo_id: grupoPadrao, conta: true, mensalidade: '0', nome: 'Clínica Teste 0068', excluido: false },
    ])
  })

  it('sem operador na sessão a clínica nasce sem carteira, e não falha (T10)', async () => {
    const id = await novaClinica()
    expect(await participacoes(id)).toEqual([])
    expect(await clientes(id)).toEqual([])
  })
})

describe('adicionar a clínica a outro grupo', () => {
  it('cria participação, histórico e um Cliente Firmare VAZIO que não conta na receita; o do Firmare não muda', async () => {
    const id = await clinicaNoFirmare()
    await m.query(`UPDATE clientes_carteira SET mensalidade_centavos = 150000, decisor = 'Dra. Fulana' WHERE clinica_id = $1`, [id])
    const c = await conexaoCarteira()
    try {
      await comoOperador(c)
      await c.query('SELECT adicionar_clinica_ao_grupo($1, $2, $3)', [id, grupoX, 'rede parceira'])
    } finally {
      await c.end()
    }
    expect((await participacoes(id)).map((p) => p.grupo_id).sort()).toEqual([grupoPadrao, grupoX].sort())
    const cli = await clientes(id)
    const noX = cli.find((x) => x.grupo_id === grupoX)!
    const noFirmare = cli.find((x) => x.grupo_id === grupoPadrao)!
    expect(noX).toMatchObject({ conta: false, mensalidade: '0', excluido: false })
    expect(noFirmare).toMatchObject({ conta: true, mensalidade: '150000' })
    const vazio = await m.query(`SELECT decisor, telefone, email, observacoes, responsavel_usuario_gestao_id FROM clientes_carteira WHERE clinica_id = $1 AND grupo_id = $2`, [id, grupoX])
    expect(vazio.rows[0]).toEqual({ decisor: null, telefone: null, email: null, observacoes: null, responsavel_usuario_gestao_id: null })
    const h = await m.query(`SELECT motivo FROM historico_grupo_da_clinica WHERE clinica_id = $1 AND grupo_novo_id = $2`, [id, grupoX])
    expect(h.rows[0].motivo).toBe('grupo adicionado: rede parceira')
  })

  it('só UM cliente por clínica conta na receita (índice único)', async () => {
    const id = await clinicaNoFirmare()
    await expect(
      m.query(
        `INSERT INTO clientes_carteira (grupo_id, clinica_id, nome, produto, conta_na_receita) VALUES ($1, $2, 'dup', 'x', true)`,
        [grupoX, id],
      ),
    ).rejects.toThrow()
  })

  it.each([
    ['sem ator', ''],
    ['usuário de gestão', 'usuario_gestao:00000000-0000-0000-0000-000000000001'],
    ['operador inexistente', 'operador:00000000-0000-0000-0000-0000000000ff'],
    ['ator malformado', 'operador:não-é-uuid'],
  ])('ator inválido (%s) falha com 42501, sem exceção de cast (T3)', async (_nome, ator) => {
    const id = await clinicaNoFirmare()
    const c = await conexaoCarteira()
    try {
      await c.query(`SELECT set_config('app.pessoa_id', $1, false), set_config('app.escopo', 'geral', false)`, [ator])
      await expect(c.query('SELECT adicionar_clinica_ao_grupo($1, $2, $3)', [id, grupoX, 'motivo ok'])).rejects.toMatchObject({
        code: '42501',
      })
    } finally {
      await c.end()
    }
  })

  it('o motivo é obrigatório e a clínica não entra duas vezes no mesmo grupo (T7)', async () => {
    const id = await clinicaNoFirmare()
    const c = await conexaoCarteira()
    try {
      await comoOperador(c)
      await expect(c.query('SELECT adicionar_clinica_ao_grupo($1, $2, $3)', [id, grupoX, ' '])).rejects.toMatchObject({
        constraint: 'participacao_motivo_obrigatorio',
      })
      await c.query('SELECT adicionar_clinica_ao_grupo($1, $2, $3)', [id, grupoX, 'primeira vez'])
      await expect(c.query('SELECT adicionar_clinica_ao_grupo($1, $2, $3)', [id, grupoX, 'de novo'])).rejects.toMatchObject({
        code: '23505',
      })
    } finally {
      await c.end()
    }
    expect((await clientes(id)).filter((x) => x.grupo_id === grupoX)).toHaveLength(1)
  })

  it('o grupo de arquivo e o inativo não recebem clínica', async () => {
    const id = await clinicaNoFirmare()
    const arquivo = (await m.query<{ id: string }>(`SELECT id FROM grupos WHERE arquivo`)).rows[0]!.id
    const c = await conexaoCarteira()
    try {
      await comoOperador(c)
      await expect(c.query('SELECT adicionar_clinica_ao_grupo($1, $2, $3)', [id, arquivo, 'não pode'])).rejects.toThrow()
    } finally {
      await c.end()
    }
  })
})

describe('as regras da tabela de participação (T2, T4, T5)', () => {
  it('DELETE, TRUNCATE, reescrever e reencerrar são recusados; o Firmare não sai', async () => {
    const id = await clinicaNoFirmare()
    const c = await conexaoCarteira()
    try {
      await comoOperador(c)
      await c.query('SELECT adicionar_clinica_ao_grupo($1, $2, $3)', [id, grupoX, 'para testar'])
      // O papel da aplicação nem tem o privilégio; o gatilho vale até para o dono.
      await expect(c.query('DELETE FROM participacao_clinica_grupo WHERE clinica_id = $1', [id])).rejects.toThrow(/permission denied/)
      await expect(m.query('DELETE FROM participacao_clinica_grupo WHERE clinica_id = $1', [id])).rejects.toThrow(/não se apaga/)
      await expect(m.query('TRUNCATE participacao_clinica_grupo')).rejects.toThrow(/não se apaga/)
      await expect(
        c.query('UPDATE participacao_clinica_grupo SET grupo_id = $2 WHERE clinica_id = $1 AND grupo_id = $3', [id, grupoY, grupoX]),
      ).rejects.toThrow(/não se reescreve/)
      await expect(c.query('SELECT encerrar_participacao_da_clinica($1, $2, $3)', [id, grupoPadrao, 'tentar sair'])).rejects.toMatchObject({
        constraint: 'grupo_padrao_fixo',
      })
      await c.query('SELECT encerrar_participacao_da_clinica($1, $2, $3)', [id, grupoX, 'saiu da rede'])
      await expect(c.query('SELECT encerrar_participacao_da_clinica($1, $2, $3)', [id, grupoX, 'de novo'])).rejects.toMatchObject({
        constraint: 'participacao_inexistente',
      })
    } finally {
      await c.end()
    }
    expect(await participacoes(id)).toEqual([
      { grupo_id: grupoPadrao, ativa: true },
      { grupo_id: grupoX, ativa: false },
    ])
  })

  it('usuário de gestão não escreve participação, nem como INSERT direto', async () => {
    const id = await clinicaNoFirmare()
    const c = await conexaoCarteira()
    try {
      await comoGrupo(c, grupoX)
      await expect(
        c.query(`INSERT INTO participacao_clinica_grupo (clinica_id, grupo_id, adicionado_por) VALUES ($1, $2, $3)`, [id, grupoX, operador]),
      ).rejects.toThrow()
      await expect(c.query('SELECT adicionar_clinica_ao_grupo($1, $2, $3)', [id, grupoX, 'invasão'])).rejects.toMatchObject({ code: '42501' })
    } finally {
      await c.end()
    }
  })

  it('cliente com clínica não muda de grupo e não nasce sem participação (T4)', async () => {
    const id = await clinicaNoFirmare()
    await expect(
      m.query(`UPDATE clientes_carteira SET grupo_id = $2 WHERE clinica_id = $1`, [id, grupoX]),
    ).rejects.toThrow(/não mudam/)
    await comoOperador(m)
    await expect(
      m.query(`INSERT INTO clientes_carteira (grupo_id, clinica_id, nome, produto) VALUES ($1, $2, 'sem participação', 'x')`, [grupoY, id]),
    ).rejects.toThrow(/não participa/)
    await declararAtorSistema(m)
  })
})

describe('isolamento entre grupos (T1)', () => {
  it('o grupo X só vê a SUA participação e o SEU cliente; nada de Y nem do Firmare', async () => {
    const id = await clinicaNoFirmare()
    const c = await conexaoCarteira()
    try {
      await comoOperador(c)
      await c.query('SELECT adicionar_clinica_ao_grupo($1, $2, $3)', [id, grupoX, 'rede X'])
      await c.query('SELECT adicionar_clinica_ao_grupo($1, $2, $3)', [id, grupoY, 'rede Y'])
      await comoGrupo(c, grupoX)
      const p = await c.query('SELECT grupo_id FROM participacao_clinica_grupo WHERE clinica_id = $1', [id])
      expect(p.rows.map((r) => r.grupo_id)).toEqual([grupoX])
      const cli = await c.query('SELECT grupo_id FROM clientes_carteira WHERE clinica_id = $1', [id])
      expect(cli.rows.map((r) => r.grupo_id)).toEqual([grupoX])
      const upd = await c.query(`UPDATE clientes_carteira SET status = 'ativo' WHERE clinica_id = $1 AND grupo_id <> $2`, [id, grupoX])
      expect(upd.rowCount).toBe(0)
    } finally {
      await c.end()
    }
  })

  it('o escopo geral vê todas as participações ativas', async () => {
    const id = await clinicaNoFirmare()
    const c = await conexaoCarteira()
    try {
      await comoOperador(c)
      await c.query('SELECT adicionar_clinica_ao_grupo($1, $2, $3)', [id, grupoX, 'rede X'])
      const p = await c.query('SELECT grupo_id FROM participacao_clinica_grupo WHERE clinica_id = $1', [id])
      expect(p.rows).toHaveLength(2)
    } finally {
      await c.end()
    }
  })

  it('a clínica vê só os NOMES dos grupos que a recebem, e `fir_app` não lê a tabela', async () => {
    const id = await clinicaNoFirmare()
    const op = await conexaoCarteira()
    try {
      await comoOperador(op)
      await op.query('SELECT adicionar_clinica_ao_grupo($1, $2, $3)', [id, grupoX, 'rede X'])
    } finally {
      await op.end()
    }
    const app = new pg.Client({ connectionString: 'postgresql://fir_app:fir_local_dev@127.0.0.1:4832/fir' })
    await app.connect()
    try {
      await app.query(`SELECT set_config('app.clinica_id', $1, false)`, [id])
      const r = await app.query('SELECT grupo FROM grupos_que_recebem_a_clinica()')
      expect(r.rows.map((x) => x.grupo).sort()).toEqual(['Firmare', 'Grupo X 0068'])
      await expect(app.query('SELECT 1 FROM participacao_clinica_grupo')).rejects.toThrow(/permission denied/)
    } finally {
      await app.end()
    }
  })

  it('usuário de gestão de escopo grupo não pode ser do grupo de arquivo', async () => {
    const arquivo = (await m.query<{ id: string }>(`SELECT id FROM grupos WHERE arquivo`)).rows[0]!.id
    await expect(
      m.query(
        `INSERT INTO usuarios_gestao (usuario, nome, senha_hash, escopo, grupo_id) VALUES ($1, 'x', 'x', 'grupo', $2)`,
        [`vg.arq.${sufixo}`, arquivo],
      ),
    ).rejects.toThrow(/grupo padrão nem do de arquivo/)
  })
})

describe('o backfill: todas as clínicas no Firmare (T8)', () => {
  it('acrescenta o Firmare sem tocar o grupo atual, é idempotente e não copia dado pessoal', async () => {
    const id = await novaClinica('Clínica Antiga 0068')
    // Estado "de antes": a clínica tem Cliente num grupo e ainda NÃO está no Firmare.
    await m.query(`SELECT set_config('app.pessoa_id', $1, false)`, [`operador:${operador}`])
    await m.query(`INSERT INTO participacao_clinica_grupo (clinica_id, grupo_id, adicionado_por) VALUES ($1, $2, $3)`, [id, grupoX, operador])
    await m.query(
      `INSERT INTO clientes_carteira (grupo_id, clinica_id, nome, produto, mensalidade_centavos, decisor, telefone, observacoes)
       VALUES ($1, $2, 'Antigo', 'Consultoria', 99900, 'Dr. Fulano', '71999990000', 'obs')`,
      [grupoX, id],
    )
    await declararAtorSistema(m)
    const antes = await m.query(`SELECT id, grupo_id FROM clientes_carteira WHERE clinica_id = $1`, [id])

    const r1 = await m.query(`SELECT * FROM preencher_grupo_firmare($1, ARRAY[$2]::uuid[])`, [operador, id])
    expect(r1.rows[0]).toMatchObject({ clinicas: 1, participacoes: 1, clientes: 1 })
    const r2 = await m.query(`SELECT * FROM preencher_grupo_firmare($1, ARRAY[$2]::uuid[])`, [operador, id])
    expect(r2.rows[0]).toMatchObject({ participacoes: 0, clientes: 0 })

    const depois = await m.query(`SELECT id, grupo_id FROM clientes_carteira WHERE clinica_id = $1 AND grupo_id = $2`, [id, grupoX])
    expect(depois.rows).toEqual(antes.rows)
    const cli = await clientes(id)
    expect(cli).toHaveLength(2)
    expect(cli.find((x) => x.grupo_id === grupoX)).toMatchObject({ conta: true, mensalidade: '99900' })
    expect(cli.find((x) => x.grupo_id === grupoPadrao)).toMatchObject({ conta: false, mensalidade: '0' })
    const novo = await m.query(
      `SELECT decisor, telefone, observacoes, responsavel_usuario_gestao_id FROM clientes_carteira WHERE clinica_id = $1 AND grupo_id = $2`,
      [id, grupoPadrao],
    )
    expect(novo.rows[0]).toEqual({ decisor: null, telefone: null, observacoes: null, responsavel_usuario_gestao_id: null })
  })

  it('a função do backfill não é chamável pelos papéis da aplicação', async () => {
    const c = await conexaoCarteira()
    try {
      await expect(c.query(`SELECT * FROM preencher_grupo_firmare($1)`, [operador])).rejects.toThrow(/permission denied/)
    } finally {
      await c.end()
    }
  })
})
