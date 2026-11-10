import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  apagarClinicaDeTeste,
  apagarHistoricoGrupoDeTeste,
  apagarOperadorDeTeste,
  declararAtorSistema,
} from '@fir/api/banco/limpeza-de-teste'

/**
 * Isolamento ENTRE GRUPOS na clínica em vários grupos (0068), em Postgres real
 * e com os papéis reais. Spec docs/specs/clinica-em-varios-grupos.md §3 (6) e §5.
 *
 * Quem atua é o papel `fir_carteira` com um ator de gestão do grupo X. A mesma
 * clínica tem um Cliente Firmare no Firmare, no X e no Y; X nunca alcança o do Y
 * nem o do Firmare, nem as filhas, nem a participação deles, e continua sem
 * alcançá-los depois de a clínica ser removida do Y (o cliente vai ao arquivo).
 *
 * Fora daqui, de propósito: o que a 0070 muda (conta_na_receita por ator que não
 * é operador, portal no grupo arquivo, reativação de arquivado, pg_temp, operador
 * inativo).
 */
const URL_MIG =
  process.env['DATABASE_URL_MIGRATE'] ?? 'postgresql://fir_migrate:fir_local_dev@127.0.0.1:4832/fir'
const URL_CARTEIRA =
  process.env['DATABASE_URL_CARTEIRA'] ?? 'postgresql://fir_carteira:fir_local_dev@127.0.0.1:4832/fir'
const URL_APP = process.env['DATABASE_URL_APP'] ?? 'postgresql://fir_app:fir_local_dev@127.0.0.1:4832/fir'

const sufixo = `${Date.now()}`
let m: pg.Client
let operador = ''
let usuarioGestao = ''
let firmare = ''
let arquivo = ''
let grupoX = ''
let grupoY = ''
let clinicaC = ''
const grupos: string[] = []
const clinicas: string[] = []
const clientes: string[] = []

type Alvo = { tabela: string; id: string; escreve: string }
/** Tudo o que é do Y e do Firmare, pelo id: o que X tenta ler e escrever. */
const alvos: Alvo[] = []
let clienteX = ''
let reuniaoX = ''

const um = async (sql: string, p: unknown[]): Promise<string> => String((await m.query(sql, p)).rows[0].id)

const conexao = async (url: string): Promise<pg.Client> => {
  const c = new pg.Client({ connectionString: url })
  await c.connect()
  return c
}
const comoOperador = (c: pg.Client) =>
  c.query(`SELECT set_config('app.pessoa_id', $1, false), set_config('app.escopo', 'geral', false)`, [`operador:${operador}`])
const comoGestaoDoGrupo = (c: pg.Client, grupo: string) =>
  c.query(
    `SELECT set_config('app.pessoa_id', $1, false), set_config('app.escopo', 'grupo', false), set_config('app.grupo_id', $2, false)`,
    [`usuario_gestao:${usuarioGestao}`, grupo],
  )
const comoGestaoGeral = (c: pg.Client) =>
  c.query(`SELECT set_config('app.pessoa_id', $1, false), set_config('app.escopo', 'geral', false)`, [`usuario_gestao:${usuarioGestao}`])

/** Cria a clínica COMO operador: o gatilho 0067 a põe no Firmare, com cliente. */
async function novaClinica(nome: string): Promise<string> {
  await m.query(`SELECT set_config('app.pessoa_id', $1, false)`, [`operador:${operador}`])
  try {
    const id = await um('INSERT INTO clinicas (codigo, nome) VALUES ($1, $2) RETURNING id', [`ig-${sufixo}-${clinicas.length}`, nome])
    clinicas.push(id)
    return id
  } finally {
    await declararAtorSistema(m)
  }
}

async function adicionarAoGrupo(clinica: string, grupo: string): Promise<void> {
  const c = await conexao(URL_CARTEIRA)
  try {
    await comoOperador(c)
    await c.query('SELECT adicionar_clinica_ao_grupo($1, $2, $3)', [clinica, grupo, 'rede de teste'])
  } finally {
    await c.end()
  }
}

const clienteDo = async (clinica: string, grupo: string): Promise<string> =>
  um('SELECT id FROM clientes_carteira WHERE clinica_id = $1 AND grupo_id = $2 AND excluido_em IS NULL', [clinica, grupo])

/** As filhas de um cliente, criadas como dono do banco (sistema), e registradas como alvo. */
async function criarFilhas(cliente: string, grupo: string): Promise<{ reuniao: string }> {
  const reuniao = await um(
    `INSERT INTO reunioes_comerciais (cliente_carteira_id, grupo_id, data, resumo, por_usuario_gestao_id)
     VALUES ($1, $2, '2026-11-10', 'ata do grupo', $3) RETURNING id`,
    [cliente, grupo, usuarioGestao],
  )
  const parceiro = await um(
    `INSERT INTO parceiros_do_cliente (grupo_id, cliente_carteira_id, frente, nome) VALUES ($1, $2, 'trafego', 'Parceiro') RETURNING id`,
    [grupo, cliente],
  )
  const tarefa = await um(
    `INSERT INTO tarefas_internas (titulo, grupo_id, cliente_carteira_id, prazo) VALUES ('ligar', $1, $2, '2026-12-01') RETURNING id`,
    [grupo, cliente],
  )
  alvos.push(
    { tabela: 'clientes_carteira', id: cliente, escreve: 'nome' },
    { tabela: 'reunioes_comerciais', id: reuniao, escreve: 'resumo' },
    { tabela: 'parceiros_do_cliente', id: parceiro, escreve: 'nome' },
    { tabela: 'tarefas_internas', id: tarefa, escreve: 'titulo' },
  )
  return { reuniao }
}

async function alvosDaParticipacao(grupo: string): Promise<void> {
  const id = await um('SELECT id FROM participacao_clinica_grupo WHERE clinica_id = $1 AND grupo_id = $2 AND ate IS NULL', [clinicaC, grupo])
  alvos.push({ tabela: 'participacao_clinica_grupo', id, escreve: 'motivo' })
}

beforeAll(async () => {
  m = new pg.Client({ connectionString: URL_MIG })
  m.on('error', (e) => console.error('[isolamento-0068]', e.message))
  await m.connect()
  await declararAtorSistema(m)
  operador = await um(`INSERT INTO operadores (usuario, nome, senha_hash) VALUES ($1, 'Dono Teste', 'x') RETURNING id`, [`ig.op.${sufixo}`])
  usuarioGestao = await um(
    `INSERT INTO usuarios_gestao (usuario, nome, senha_hash, escopo, grupo_id) VALUES ($1, 'Autora de fixture', 'x', 'geral', NULL) RETURNING id`,
    [`ig.ug.${sufixo}`],
  )
  firmare = await um('SELECT id FROM grupos WHERE padrao', [])
  arquivo = await um('SELECT id FROM grupos WHERE arquivo', [])
  for (const nome of ['Isolamento X', 'Isolamento Y']) {
    grupos.push(await um('INSERT INTO grupos (nome) VALUES ($1) RETURNING id', [`${nome} ${sufixo}`]))
  }
  grupoX = grupos[0]!
  grupoY = grupos[1]!

  clinicaC = await novaClinica(`Clinica C ${sufixo}`)
  await adicionarAoGrupo(clinicaC, grupoX)
  await adicionarAoGrupo(clinicaC, grupoY)
  const cX = await clienteDo(clinicaC, grupoX)
  const cY = await clienteDo(clinicaC, grupoY)
  const cF = await clienteDo(clinicaC, firmare)
  clientes.push(cX, cY, cF)
  clienteX = cX
  ;({ reuniao: reuniaoX } = await criarFilhas(cX, grupoX))
  // Só os alvos do Y e do Firmare entram na lista do que o X tenta alcançar.
  alvos.length = 0
  await criarFilhas(cY, grupoY)
  await criarFilhas(cF, firmare)
  await alvosDaParticipacao(grupoY)
  await alvosDaParticipacao(firmare)
})

afterAll(async () => {
  await declararAtorSistema(m)
  for (const t of ['reunioes_comerciais', 'parceiros_do_cliente', 'tarefas_internas']) {
    await m.query(`DELETE FROM ${t} WHERE cliente_carteira_id = ANY($1)`, [clientes])
  }
  await m.query('DELETE FROM auditoria_da_carteira WHERE grupo_id = ANY($1)', [[...grupos, firmare, arquivo]])
  await m.query('DELETE FROM clientes_carteira WHERE clinica_id = ANY($1)', [clinicas])
  for (const c of clinicas) await apagarHistoricoGrupoDeTeste(m, c)
  await m.query('DELETE FROM grupos WHERE id = ANY($1)', [grupos])
  for (const c of clinicas) await apagarClinicaDeTeste(m, c)
  await m.query('DELETE FROM usuarios_gestao WHERE id = $1', [usuarioGestao])
  await apagarOperadorDeTeste(m, operador)
  await m.end()
})

/** O que o X, autenticado, tenta ler e escrever em cada alvo: nada, nunca. */
async function xNaoAlcancaNada(): Promise<void> {
  const c = await conexao(URL_CARTEIRA)
  try {
    await comoGestaoDoGrupo(c, grupoX)
    for (const a of alvos) {
      const lida = await c.query(`SELECT 1 FROM ${a.tabela} WHERE id = $1`, [a.id])
      expect(lida.rowCount, `SELECT em ${a.tabela}`).toBe(0)
      const escrita = await c.query(`UPDATE ${a.tabela} SET ${a.escreve} = 'invasao' WHERE id = $1`, [a.id])
      expect(escrita.rowCount, `UPDATE em ${a.tabela}`).toBe(0)
    }
    // Nem por varredura: nada da clínica C fora do X.
    const varredura = await c.query('SELECT grupo_id FROM clientes_carteira WHERE clinica_id = $1', [clinicaC])
    expect(varredura.rows.map((r) => r.grupo_id)).toEqual([grupoX])
    const part = await c.query('SELECT grupo_id FROM participacao_clinica_grupo WHERE clinica_id = $1', [clinicaC])
    expect(part.rows.map((r) => r.grupo_id)).toEqual([grupoX])
  } finally {
    await c.end()
  }
  // E a escrita rejeitada não deixou marca: os valores originais continuam.
  for (const a of alvos) {
    const v = await m.query(`SELECT ${a.escreve} AS v FROM ${a.tabela} WHERE id = $1`, [a.id])
    expect(v.rows[0]?.v, `${a.tabela} intacto`).not.toBe('invasao')
  }
}

describe('o grupo X não alcança a mesma clínica no Y, no Firmare nem no arquivo', () => {
  it('controle: o X enxerga o SEU cliente e a SUA filha (a recusa abaixo não é vazio por engano)', async () => {
    const c = await conexao(URL_CARTEIRA)
    try {
      await comoGestaoDoGrupo(c, grupoX)
      expect((await c.query('SELECT 1 FROM clientes_carteira WHERE id = $1', [clienteX])).rowCount).toBe(1)
      expect((await c.query('SELECT 1 FROM reunioes_comerciais WHERE id = $1', [reuniaoX])).rowCount).toBe(1)
    } finally {
      await c.end()
    }
  })

  it('antes da remoção: SELECT e UPDATE por id, em cliente, filhas e participação do Y e do Firmare, não alcançam nada', async () => {
    await xNaoAlcancaNada()
  })

  it('depois de a clínica ser removida do Y (cliente no arquivo): continua sem alcançar nada', async () => {
    const c = await conexao(URL_CARTEIRA)
    try {
      await comoOperador(c)
      await c.query('SELECT encerrar_participacao_da_clinica($1, $2, $3)', [clinicaC, grupoY, 'saiu da rede'])
    } finally {
      await c.end()
    }
    // O cliente do Y vai ao arquivo, como faz o serviço: excluído e no grupo de arquivo.
    await m.query('BEGIN')
    try {
      await m.query(`SELECT set_config('app.pessoa_id', $1, true)`, [`operador:${operador}`])
      await m.query('UPDATE clientes_carteira SET excluido_em = now(), grupo_id = $2 WHERE clinica_id = $1 AND grupo_id = $3', [clinicaC, arquivo, grupoY])
      await m.query('COMMIT')
    } catch (e) {
      await m.query('ROLLBACK')
      throw e
    }
    // As filhas acompanharam o cliente (FK composta): agora estão no arquivo.
    const noArquivo = await m.query('SELECT count(*)::int AS n FROM reunioes_comerciais WHERE grupo_id = $1 AND cliente_carteira_id = ANY($2)', [arquivo, clientes])
    expect(noArquivo.rows[0].n).toBe(1)
    await xNaoAlcancaNada()
  })
})

describe('usuário de gestão não escreve participação', () => {
  it.each([
    ['escopo grupo', (c: pg.Client) => comoGestaoDoGrupo(c, grupoX)],
    ['escopo geral', (c: pg.Client) => comoGestaoGeral(c)],
  ])('(%s) adicionar, encerrar, INSERT e UPDATE direto: 42501', async (_n, entrar) => {
    const clinica = await novaClinica(`Clinica D ${sufixo}`)
    const c = await conexao(URL_CARTEIRA)
    try {
      await entrar(c)
      await expect(c.query('SELECT adicionar_clinica_ao_grupo($1, $2, $3)', [clinica, grupoX, 'invasão'])).rejects.toMatchObject({ code: '42501' })
      await expect(c.query('SELECT encerrar_participacao_da_clinica($1, $2, $3)', [clinica, firmare, 'invasão'])).rejects.toMatchObject({ code: '42501' })
      await expect(
        c.query(`INSERT INTO participacao_clinica_grupo (clinica_id, grupo_id, adicionado_por) VALUES ($1, $2, $3)`, [clinica, grupoX, operador]),
      ).rejects.toMatchObject({ code: '42501' })
      // O Firmare é visível ao `geral`; ao do grupo X, a participação do X existe após o operador designá-la.
      const op = await conexao(URL_CARTEIRA)
      try {
        await comoOperador(op)
        await op.query('SELECT adicionar_clinica_ao_grupo($1, $2, $3)', [clinica, grupoX, 'rede de teste'])
      } finally {
        await op.end()
      }
      const visivel = await c.query('SELECT id FROM participacao_clinica_grupo WHERE clinica_id = $1 AND grupo_id = $2', [clinica, grupoX])
      expect(visivel.rowCount).toBe(1)
      await expect(
        c.query('UPDATE participacao_clinica_grupo SET ate = now(), removido_por = $2 WHERE id = $1', [visivel.rows[0].id, operador]),
      ).rejects.toMatchObject({ code: '42501' })
    } finally {
      await c.end()
    }
    const ainda = await m.query('SELECT ate FROM participacao_clinica_grupo WHERE clinica_id = $1 AND grupo_id = $2', [clinica, grupoX])
    expect(ainda.rows[0].ate).toBeNull()
  })
})

describe('ator forjado: operador_da_sessao() devolve NULL', () => {
  const comAtor = async (ator: string): Promise<string | null> => {
    await m.query(`SELECT set_config('app.pessoa_id', $1, false)`, [ator])
    try {
      return (await m.query('SELECT operador_da_sessao() AS id')).rows[0].id
    } finally {
      await declararAtorSistema(m)
    }
  }

  it('controle: o id minúsculo de um operador existente é reconhecido', async () => {
    expect(await comAtor(`operador:${operador}`)).toBe(operador)
  })

  it.each([
    ['UUID em maiúsculas', () => `operador:${operador.toUpperCase()}`],
    ['operador inexistente', () => 'operador:00000000-0000-0000-0000-0000000000ff'],
    ['com espaço no fim', () => `operador:${operador} `],
    ['com quebra de linha no fim', () => `operador:${operador}\n`],
    ['sem o prefixo', () => operador],
    ['prefixo de outro ator', () => `usuario_gestao:${operador}`],
    ['injeção no lugar do UUID', () => `operador:' OR '1'='1`],
    ['vazio', () => ''],
  ])('%s: NULL, sem exceção de cast', async (_nome, ator) => {
    expect(await comAtor(ator())).toBeNull()
  })
})

describe('a clínica só vê os grupos que a recebem', () => {
  it('como fir_app da clínica A, não lista o grupo da clínica B (e vice-versa)', async () => {
    const a = await novaClinica(`Clinica A ${sufixo}`)
    const b = await novaClinica(`Clinica B ${sufixo}`)
    await adicionarAoGrupo(a, grupoX)
    await adicionarAoGrupo(b, grupoY)
    const nomeX = `Isolamento X ${sufixo}`
    const nomeY = `Isolamento Y ${sufixo}`
    const doApp = async (clinica: string): Promise<string[]> => {
      const c = await conexao(URL_APP)
      try {
        await c.query(`SELECT set_config('app.clinica_id', $1, false)`, [clinica])
        return (await c.query<{ grupo: string }>('SELECT grupo FROM grupos_que_recebem_a_clinica()')).rows.map((r) => r.grupo)
      } finally {
        await c.end()
      }
    }
    const daA = await doApp(a)
    expect(daA).toContain(nomeX)
    expect(daA).not.toContain(nomeY)
    const daB = await doApp(b)
    expect(daB).toContain(nomeY)
    expect(daB).not.toContain(nomeX)
  })
})
