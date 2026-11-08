import { programaDoCliente } from '@fir/domain'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { declararAtorSistema } from '@fir/api/banco/limpeza-de-teste'

/**
 * **G8 3D NO BANCO — a biblioteca geral e o resto do que a 0059 abriu ao
 * portal**, conectado como `fir_portal` de verdade (RLS não se mocka).
 *
 * Casos do gate de segurança: 56 (material `uso_interno` e personalizado de
 * outro cliente do mesmo grupo invisíveis ao portal de escopo cliente), 57
 * (a decisão do portal mora numa função com CASE, sem OR, e a policy tem
 * `TO`), 58 (`fir_portal` não escreve em `materiais_da_biblioteca`). Mais:
 * a regra do programa escrita duas vezes (SQL e domínio) diz o mesmo; o
 * portal não lê a equipe da Firmare nem as ações do plano; a meta sem prazo
 * deixou de ser filtrada.
 */
const URL_MIG =
  process.env['DATABASE_URL_MIGRATE'] ?? 'postgresql://fir_migrate:fir_local_dev@127.0.0.1:4832/fir'
const URL_PORTAL =
  process.env['DATABASE_URL_PORTAL'] ?? 'postgresql://fir_portal:fir_local_dev@127.0.0.1:4832/fir'

const sufixo = String(Date.now()).slice(-9)
let migrate: pg.Client
let grupoA: string
let grupoB: string
let clienteFinanceiro: string // grupo A
let clienteComercial: string // grupo A
let clienteGestao: string // grupo B
let autor: string
const materiais: string[] = []

async function comoPortal<T>(escopo: { cliente: string | null; grupo: string | null }, fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const c = new pg.Client({ connectionString: URL_PORTAL })
  await c.connect()
  try {
    await c.query('BEGIN')
    await c.query(`SELECT set_config('app.portal_cliente_id', $1, true)`, [escopo.cliente ?? ''])
    await c.query(`SELECT set_config('app.portal_grupo_id', $1, true)`, [escopo.grupo ?? ''])
    const r = await fn(c)
    await c.query('ROLLBACK')
    return r
  } finally {
    await c.end()
  }
}

const titulosVistos = (escopo: { cliente: string | null; grupo: string | null }) =>
  comoPortal(escopo, async (c) =>
    (
      await c.query<{ titulo: string }>(
        `SELECT titulo FROM materiais_da_biblioteca WHERE titulo LIKE $1 ORDER BY titulo`,
        [`%${sufixo}`],
      )
    ).rows.map((r) => r.titulo.replace(` ${sufixo}`, '')),
  )

beforeAll(async () => {
  migrate = new pg.Client({ connectionString: URL_MIG })
  await migrate.connect()
  await declararAtorSistema(migrate)
  const id = async (sql: string, p: unknown[]) => (await migrate.query<{ id: string }>(sql, p)).rows[0]!.id
  grupoA = await id(`INSERT INTO grupos (nome) VALUES ($1) RETURNING id`, [`Biblioteca A ${sufixo}`])
  grupoB = await id(`INSERT INTO grupos (nome) VALUES ($1) RETURNING id`, [`Biblioteca B ${sufixo}`])
  clienteFinanceiro = await id(
    `INSERT INTO clientes_carteira (grupo_id, nome, produto, area_foco) VALUES ($1, 'Fin', 'Acelerador FIR', 'Financeiro') RETURNING id`,
    [grupoA],
  )
  clienteComercial = await id(
    `INSERT INTO clientes_carteira (grupo_id, nome, produto) VALUES ($1, 'Com', 'Acelerador FIR') RETURNING id`,
    [grupoA],
  )
  clienteGestao = await id(
    `INSERT INTO clientes_carteira (grupo_id, nome, produto) VALUES ($1, 'Ges', 'Gestão FIR') RETURNING id`,
    [grupoB],
  )
  autor = await id(
    `INSERT INTO usuarios_gestao (usuario, nome, senha_hash, escopo) VALUES ($1, 'Autora', 'x', 'geral') RETURNING id`,
    [`bib.autora.${sufixo}`],
  )
  const material = async (titulo: string, programas: string[], usoInterno: boolean, arquivado = false) =>
    materiais.push(
      await id(
        `INSERT INTO materiais_da_biblioteca (titulo, tipo, uso_interno, programas, criado_por, arquivado_em)
         VALUES ($1, 'Planilha', $2, $3, $4, $5) RETURNING id`,
        [`${titulo} ${sufixo}`, usoInterno, programas, autor, arquivado ? new Date() : null],
      ),
    )
  await material('financeiro', ['Financeiro'], false)
  await material('comercial', ['Comercial'], false)
  await material('gestao', ['Gestão'], false)
  await material('todos', ['Todos'], false)
  await material('interno', ['Financeiro', 'Todos'], true)
  await material('arquivado', ['Todos'], false, true)
})

afterAll(async () => {
  await declararAtorSistema(migrate)
  await migrate.query('DELETE FROM materiais_da_biblioteca WHERE id = ANY($1)', [materiais])
  await migrate.query('DELETE FROM clientes_carteira WHERE id = ANY($1)', [[clienteFinanceiro, clienteComercial, clienteGestao]])
  await migrate.query('DELETE FROM usuarios_gestao WHERE id = $1', [autor])
  await migrate.query('DELETE FROM grupos WHERE id = ANY($1)', [[grupoA, grupoB]])
  await migrate.end()
})

describe('materiais_da_biblioteca lida por fir_portal (caso 56)', () => {
  it('escopo=cliente (Financeiro): o do programa e o de "Todos" — nunca uso interno, arquivado ou de outro programa', async () => {
    expect(await titulosVistos({ cliente: clienteFinanceiro, grupo: null })).toEqual(['financeiro', 'todos'])
  })

  it('escopo=cliente (Comercial, mesmo grupo): não herda o programa do vizinho', async () => {
    expect(await titulosVistos({ cliente: clienteComercial, grupo: null })).toEqual(['comercial', 'todos'])
  })

  it('escopo=grupo (A): a união dos programas do PRÓPRIO grupo — nunca o de Gestão, que só o grupo B tem', async () => {
    expect(await titulosVistos({ cliente: null, grupo: grupoA })).toEqual(['comercial', 'financeiro', 'todos'])
  })

  it('escopo=grupo (B): só Gestão e "Todos"', async () => {
    expect(await titulosVistos({ cliente: null, grupo: grupoB })).toEqual(['gestao', 'todos'])
  })

  it('sem sessão de portal fixada, nada — nem o de "Todos"', async () => {
    expect(await titulosVistos({ cliente: null, grupo: null })).toEqual([])
  })

  it('fir_portal não lê quem cadastrou nem quando (SELECT por coluna)', async () => {
    await expect(
      comoPortal({ cliente: clienteFinanceiro, grupo: null }, (c) => c.query('SELECT criado_por FROM materiais_da_biblioteca')),
    ).rejects.toThrow(/permission denied/i)
  })
})

describe('a policy e a função (caso 57)', () => {
  it('a policy do portal tem TO fir_portal, NOT uso_interno e arquivado por AND, e nenhum OR', async () => {
    const r = await migrate.query<{ roles: string[]; qual: string; cmd: string }>(
      `SELECT roles::text[] AS roles, qual, cmd FROM pg_policies
        WHERE tablename = 'materiais_da_biblioteca' AND policyname = 'materiais_da_biblioteca_portal'`,
    )
    expect(r.rows[0]).toMatchObject({ roles: ['fir_portal'], cmd: 'SELECT' })
    expect(r.rows[0]!.qual).toContain('NOT uso_interno')
    expect(r.rows[0]!.qual).toContain('arquivado_em IS NULL')
    expect(r.rows[0]!.qual).toContain('app_portal_pode_ver_material')
    expect(r.rows[0]!.qual.toUpperCase()).not.toMatch(/\bOR\b/)
  })

  it('app_portal_pode_ver_material decide por CASE, sem OR, e repete app_portal_pode_ver', async () => {
    const r = await migrate.query<{ src: string; definer: boolean }>(
      `SELECT prosrc AS src, prosecdef AS definer FROM pg_proc WHERE proname = 'app_portal_pode_ver_material'`,
    )
    expect(r.rows[0]!.definer).toBe(false)
    expect(r.rows[0]!.src.toUpperCase()).toMatch(/\bCASE\b/)
    expect(r.rows[0]!.src.toUpperCase()).not.toMatch(/\bOR\b/)
    expect(r.rows[0]!.src).toContain('app_portal_pode_ver(c.grupo_id, c.id)')
  })

  it('a escrita na biblioteca exige escopo geral E carteira.administrar, por AND', async () => {
    const r = await migrate.query<{ policyname: string; with_check: string }>(
      `SELECT policyname, with_check FROM pg_policies
        WHERE tablename = 'materiais_da_biblioteca' AND cmd IN ('INSERT', 'UPDATE')`,
    )
    expect(r.rows).toHaveLength(2)
    for (const p of r.rows) {
      expect(p.with_check, p.policyname).toContain("app_escopo() = 'geral'")
      expect(p.with_check, p.policyname).toContain('app_carteira_pode_administrar()')
      expect(p.with_check.toUpperCase()).not.toMatch(/\bOR\b/)
    }
  })
})

describe('fir_portal não escreve na biblioteca (caso 58)', () => {
  it.each([
    ['INSERT', `INSERT INTO materiais_da_biblioteca (titulo, tipo, uso_interno, criado_por) VALUES ('x', 'Planilha', false, gen_random_uuid())`],
    ['UPDATE', `UPDATE materiais_da_biblioteca SET titulo = 'x'`],
    ['DELETE', `DELETE FROM materiais_da_biblioteca`],
  ])('%s: permission denied, por privilégio e não por RLS', async (_verbo, sql) => {
    await expect(comoPortal({ cliente: clienteFinanceiro, grupo: null }, (c) => c.query(sql))).rejects.toThrow(/permission denied/i)
  })
})

describe('o programa do cliente: a regra escrita duas vezes diz o mesmo', () => {
  it('app_portal_programa_do_cliente = programaDoCliente, em toda área de foco do cadastro e nos produtos que mudam a resposta', async () => {
    const areas = [null, 'Comercial', 'Financeiro', 'Pessoas', 'Processos', 'Estratégia', 'Gestão', 'Operações']
    const produtos = ['Acelerador FIR', 'Gestão FIR', 'Programa Gestão FIR Avançado', 'Consultoria', 'A definir no onboarding']
    for (const area of areas) {
      for (const produto of produtos) {
        const r = await migrate.query<{ p: string }>('SELECT app_portal_programa_do_cliente($1, $2) AS p', [area, produto])
        expect(r.rows[0]!.p, `${area} × ${produto}`).toBe(programaDoCliente({ areaFoco: area, produto }))
      }
    }
  })
})

describe('o que a 0059 NÃO abriu ao portal', () => {
  it('a equipe da Firmare: nenhum SELECT em usuarios_gestao — só o nome, pela função, de quem está ativo', async () => {
    const p = await migrate.query<{ sel: boolean }>(`SELECT has_any_column_privilege('fir_portal', 'usuarios_gestao', 'SELECT') AS sel`)
    expect(p.rows[0]!.sel).toBe(false)
    const nome = await comoPortal({ cliente: clienteFinanceiro, grupo: null }, async (c) =>
      (await c.query<{ n: string | null }>('SELECT app_portal_nome_da_consultora($1) AS n', [autor])).rows[0]!.n,
    )
    expect(nome).toBe('Autora')
    await migrate.query('UPDATE usuarios_gestao SET ativo = false WHERE id = $1', [autor])
    try {
      const inativa = await comoPortal({ cliente: clienteFinanceiro, grupo: null }, async (c) =>
        (await c.query<{ n: string | null }>('SELECT app_portal_nome_da_consultora($1) AS n', [autor])).rows[0]!.n,
      )
      expect(inativa).toBeNull()
    } finally {
      await migrate.query('UPDATE usuarios_gestao SET ativo = true WHERE id = $1', [autor])
    }
  })

  it('as ações do plano: privilégio só nas três colunas da contagem, e nenhuma linha atravessa (sem policy para fir_portal)', async () => {
    const cols = await migrate.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.column_privileges
        WHERE table_name = 'acoes_do_plano' AND grantee = 'fir_portal' AND privilege_type = 'SELECT' ORDER BY column_name`,
    )
    expect(cols.rows.map((r) => r.column_name)).toEqual(['arquivada_em', 'meta_comercial_id', 'status'])
    const pol = await migrate.query(`SELECT 1 FROM pg_policies WHERE tablename = 'acoes_do_plano' AND 'fir_portal' = ANY(roles)`)
    expect(pol.rows).toHaveLength(0)
  })

  it('a planilha: só o resultado interpretado — nunca o link, o id do Google nem o erro', async () => {
    const r = await migrate.query<{ link: boolean; sid: boolean; erro: boolean; res: boolean }>(
      `SELECT has_column_privilege('fir_portal', 'planilhas_do_cliente', 'link', 'SELECT') AS link,
              has_column_privilege('fir_portal', 'planilhas_do_cliente', 'spreadsheet_id', 'SELECT') AS sid,
              has_column_privilege('fir_portal', 'planilhas_do_cliente', 'erro', 'SELECT') AS erro,
              has_column_privilege('fir_portal', 'planilhas_do_cliente', 'resultado', 'SELECT') AS res`,
    )
    expect(r.rows[0]).toEqual({ link: false, sid: false, erro: false, res: true })
  })

  it('o cadastro interno do cliente continua fora; entram só as colunas do cabeçalho, do ciclo e da consultora', async () => {
    const r = await migrate.query<{ col: string; pode: boolean }>(
      `SELECT c AS col, has_column_privilege('fir_portal', 'clientes_carteira', c, 'SELECT') AS pode
         FROM unnest(ARRAY['decisor','data_inicio','data_fim','area_foco','reuniao_dia_semana','reuniao_hora',
                           'responsavel_usuario_gestao_id','observacoes','pagador','telefone','email','cnpj',
                           'telefone_cobranca','dia_vencimento','aniversario_decisor_dia']) AS c`,
    )
    const pode = Object.fromEntries(r.rows.map((x) => [x.col, x.pode]))
    expect(pode).toEqual({
      decisor: true, data_inicio: true, data_fim: true, area_foco: true, reuniao_dia_semana: true, reuniao_hora: true,
      responsavel_usuario_gestao_id: true,
      observacoes: false, pagador: false, telefone: false, email: false, cnpj: false, telefone_cobranca: false,
      dia_vencimento: false, aniversario_decisor_dia: false,
    })
  })

  it('a meta sem prazo deixou de ser filtrada pela policy do portal; a cancelada continua fora', async () => {
    const r = await migrate.query<{ qual: string }>(
      `SELECT qual FROM pg_policies WHERE tablename = 'metas_comerciais' AND policyname = 'metas_comerciais_portal'`,
    )
    expect(r.rows[0]!.qual).not.toContain('prazo')
    expect(r.rows[0]!.qual).toContain("<> 'cancelada'")
  })
})
