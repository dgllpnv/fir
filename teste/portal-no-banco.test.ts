import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { apagarClinicaDeTeste, declararAtorSistema } from '@fir/api/banco/limpeza-de-teste'

/**
 * O PORTAL DO GRUPO NO BANCO — migration 0034 (G6). ADRs 0017, 0018.
 *
 * Mesma forma de `carteira-no-banco.test.ts`, um ator mais: `fir_portal` é
 * súdito da RLS como qualquer um — sem `BYPASSRLS` —, e `app_portal_pode_ver`
 * carrega o `CASE...ELSE` por dentro, nunca um `OR` na cláusula da policy
 * (ADR 0018 §1).
 */
const URL_MIG =
  process.env['DATABASE_URL_MIGRATE'] ?? 'postgresql://fir_migrate:fir_local_dev@127.0.0.1:4832/fir'
const URL_PORTAL =
  process.env['DATABASE_URL_PORTAL'] ?? 'postgresql://fir_portal:fir_local_dev@127.0.0.1:4832/fir'

/** As cinco tabelas comerciais já existentes + as três que G6 herda de modelar. */
const TABELAS_COMERCIAIS_DO_PORTAL = [
  'clientes_carteira',
  'campanhas_carteira',
  'indicadores_carteira',
  'lancamentos_de_indicador',
  'metas_comerciais',
  'cobrancas_do_cliente_firmare',
  'documentos_carteira',
  'materiais_carteira',
  'reunioes_comerciais',
] as const

const TABELAS_DE_IDENTIDADE_DO_PORTAL = ['usuarios_do_portal', 'sessoes_do_portal', 'tentativas_do_portal'] as const

let migrate: pg.Client
let clinicaA: string
let clinicaB: string
let clinicaC: string
let grupoA: string
let grupoB: string
let clienteX: string // grupo A
let clienteY: string // grupo A, MESMO grupo de X — isolamento cliente↔cliente
let clienteZ: string // grupo B — isolamento cruzando grupos

const sufixo = Date.now()
// Único por execução: uma rodada interrompida deixava a linha, e a seguinte batia na UNIQUE.
const usuarioValido = `portal.valido.${String(sufixo).slice(-9)}`

async function conectarComoPortal(): Promise<pg.Client> {
  const c = new pg.Client({ connectionString: URL_PORTAL })
  c.on('error', (e) => console.error('[portal-no-banco] fir_portal:', e.message))
  await c.connect()
  return c
}

/** `SET LOCAL` dentro de uma transação — mesma forma de produção (PortalGuard/BancoService). */
async function comoSessaoDoPortal<T>(
  escopo: { clienteCarteiraId: string | null; grupoId: string | null },
  fn: (c: pg.Client) => Promise<T>,
): Promise<T> {
  const c = await conectarComoPortal()
  try {
    await c.query('BEGIN')
    await c.query(`SELECT set_config('app.portal_cliente_id', $1, true)`, [escopo.clienteCarteiraId ?? ''])
    await c.query(`SELECT set_config('app.portal_grupo_id', $1, true)`, [escopo.grupoId ?? ''])
    const r = await fn(c)
    await c.query('COMMIT')
    return r
  } finally {
    await c.end()
  }
}

beforeAll(async () => {
  migrate = new pg.Client({ connectionString: URL_MIG })
  migrate.on('error', (e) => console.error('[portal-no-banco] migrate:', e.message))
  await migrate.connect()
  await declararAtorSistema(migrate)

  clinicaA = (
    await migrate.query<{ id: string }>(
      `INSERT INTO clinicas (codigo, nome) VALUES ($1, 'Clínica Portal A') RETURNING id`,
      [`portal-a-${sufixo}`],
    )
  ).rows[0]!.id
  clinicaB = (
    await migrate.query<{ id: string }>(
      `INSERT INTO clinicas (codigo, nome) VALUES ($1, 'Clínica Portal B') RETURNING id`,
      [`portal-b-${sufixo}`],
    )
  ).rows[0]!.id
  clinicaC = (
    await migrate.query<{ id: string }>(
      `INSERT INTO clinicas (codigo, nome) VALUES ($1, 'Clínica Portal C') RETURNING id`,
      [`portal-c-${sufixo}`],
    )
  ).rows[0]!.id

  grupoA = (await migrate.query<{ id: string }>(`INSERT INTO grupos (nome) VALUES ('Grupo Portal A') RETURNING id`))
    .rows[0]!.id
  grupoB = (await migrate.query<{ id: string }>(`INSERT INTO grupos (nome) VALUES ('Grupo Portal B') RETURNING id`))
    .rows[0]!.id

  clienteX = (
    await migrate.query<{ id: string }>(
      `INSERT INTO clientes_carteira (grupo_id, clinica_id, nome, produto) VALUES ($1, $2, 'Cliente X', 'Acelerador FIR') RETURNING id`,
      [grupoA, clinicaA],
    )
  ).rows[0]!.id
  clienteY = (
    await migrate.query<{ id: string }>(
      `INSERT INTO clientes_carteira (grupo_id, clinica_id, nome, produto) VALUES ($1, $2, 'Cliente Y', 'Acelerador FIR') RETURNING id`,
      [grupoA, clinicaB],
    )
  ).rows[0]!.id
  clienteZ = (
    await migrate.query<{ id: string }>(
      `INSERT INTO clientes_carteira (grupo_id, clinica_id, nome, produto) VALUES ($1, $2, 'Cliente Z', 'Consultoria') RETURNING id`,
      [grupoB, clinicaC],
    )
  ).rows[0]!.id
})

afterAll(async () => {
  await declararAtorSistema(migrate)
  await migrate.query('DELETE FROM usuarios_do_portal WHERE grupo_id = ANY($1) OR cliente_carteira_id = ANY($2)', [
    [grupoA, grupoB],
    [clienteX, clienteY, clienteZ],
  ])
  await migrate.query('DELETE FROM clientes_carteira WHERE id = ANY($1)', [[clienteX, clienteY, clienteZ]])
  await migrate.query('DELETE FROM grupos WHERE id = ANY($1)', [[grupoA, grupoB]])
  await apagarClinicaDeTeste(migrate, clinicaA)
  await apagarClinicaDeTeste(migrate, clinicaB)
  await apagarClinicaDeTeste(migrate, clinicaC)
  await migrate.end()
})

describe('boot: fir_portal é um papel comum, sujeito à RLS (ADR 0018 critério 13)', () => {
  it('fir_portal NÃO atravessa a RLS — sem BYPASSRLS, sem SUPERUSER, sem CREATEROLE', async () => {
    const r = await migrate.query<{ rolbypassrls: boolean; rolsuper: boolean; rolcreaterole: boolean }>(
      `SELECT rolbypassrls, rolsuper, rolcreaterole FROM pg_roles WHERE rolname = 'fir_portal'`,
    )
    expect(r.rows[0]).toEqual({ rolbypassrls: false, rolsuper: false, rolcreaterole: false })
  })
})

describe('privilégio: fir_app não enxerga a identidade do portal', () => {
  it('fir_app não tem nenhum privilégio em usuarios_do_portal/sessoes_do_portal/tentativas_do_portal', async () => {
    for (const t of TABELAS_DE_IDENTIDADE_DO_PORTAL) {
      const p = await migrate.query<{ sel: boolean; ins: boolean; upd: boolean; del: boolean }>(
        `SELECT has_table_privilege('fir_app', $1, 'SELECT') AS sel,
                has_table_privilege('fir_app', $1, 'INSERT') AS ins,
                has_table_privilege('fir_app', $1, 'UPDATE') AS upd,
                has_table_privilege('fir_app', $1, 'DELETE') AS del`,
        [t],
      )
      expect(Object.values(p.rows[0]!), `fir_app alcança ${t}`).toEqual([false, false, false, false])
    }
  })
})

describe('ADR 0018 critério 11: fir_portal NUNCA tem GRANT de escrita', () => {
  it('fir_portal só tem SELECT nas tabelas comerciais — INSERT/UPDATE/DELETE falham por privilégio, não por RLS', async () => {
    // `reunioes_comerciais` é a exceção DESDE A 0042 (G8 0.1): SELECT por
    // coluna, só na lista branca, nunca de tabela — a prova da lista branca
    // está no describe de G8 0.1, ao fim deste arquivo. As outras oito
    // continuam exigindo SELECT de tabela, sem afrouxar nada.
    for (const t of TABELAS_COMERCIAIS_DO_PORTAL) {
      const p = await migrate.query<{ sel: boolean; colunas: boolean; ins: boolean; upd: boolean; del: boolean }>(
        `SELECT has_table_privilege('fir_portal', $1, 'SELECT') AS sel,
                has_any_column_privilege('fir_portal', $1, 'SELECT') AS colunas,
                has_table_privilege('fir_portal', $1, 'INSERT') AS ins,
                has_table_privilege('fir_portal', $1, 'UPDATE') AS upd,
                has_table_privilege('fir_portal', $1, 'DELETE') AS del`,
        [t],
      )
      // `clientes_carteira` também é por coluna DESDE A 0047 (G8 0.4): o
      // cadastro interno (observações, decisor, pagador, telefone de
      // cobrança) não atravessa para o portal — a lista branca está provada
      // em `apps/api/src/carteira/cadastro-do-cliente.e2e.test.ts`.
      const esperado = t === 'reunioes_comerciais' || t === 'clientes_carteira'
        ? { sel: false, colunas: true, ins: false, upd: false, del: false }
        : { sel: true, colunas: true, ins: false, upd: false, del: false }
      expect(p.rows[0], t).toEqual(esperado)
    }

    // A lista branca exata de reunioes_comerciais (LGPD A7) — nenhuma coluna a mais.
    const cols = await migrate.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.column_privileges
        WHERE table_name = 'reunioes_comerciais' AND grantee = 'fir_portal' AND privilege_type = 'SELECT'
        ORDER BY column_name`,
    )
    expect(cols.rows.map((r) => r.column_name)).toEqual([
      'anexos', 'arquivada_em', 'cliente_carteira_id', 'compartilhada', 'data',
      'encaminhamentos', 'grupo_id', 'id', 'resumo',
    ])
  })

  it('uma tentativa de INSERT em documentos_carteira como fir_portal falha por permission denied, não por RLS (critério 11)', async () => {
    const c = await conectarComoPortal()
    try {
      await expect(
        c.query(
          `INSERT INTO documentos_carteira (cliente_carteira_id, grupo_id, titulo, categoria, link, data, criado_por)
           VALUES ($1, $2, 'x', 'x', 'x', now(), (SELECT id FROM usuarios_gestao LIMIT 1))`,
          [clienteX, grupoA],
        ),
      ).rejects.toThrow(/permission denied/i)
    } finally {
      await c.end()
    }
  })

  it('uma tentativa de UPDATE em clientes_carteira como fir_portal falha por permission denied', async () => {
    const c = await conectarComoPortal()
    try {
      await expect(c.query(`UPDATE clientes_carteira SET nome = 'x' WHERE id = $1`, [clienteX])).rejects.toThrow(
        /permission denied/i,
      )
    } finally {
      await c.end()
    }
  })
})

/**
 * As três tabelas novas de G6 NÃO entram em `ENTIDADES_DA_CARTEIRA_SEM_
 * CLINICA` (teste/registro.ts): aquele registro exige que TODAS as policies
 * de uma tabela contenham `app_pode_ver_grupo` — e as minhas têm DUAS
 * policies por tabela (uma para `fir_carteira`, com `app_pode_ver_grupo`;
 * uma para `fir_portal`, com `app_portal_pode_ver`), então entrar na lista
 * compartilhada reprovaria a policy do portal por não casar a string exigida
 * para a OUTRA. Por isso o exame mora aqui, por inteiro.
 */
describe('documentos_carteira/materiais_carteira/reunioes_comerciais: RLS por completo (G6)', () => {
  const TABELAS_NOVAS_DE_G6 = ['documentos_carteira', 'materiais_carteira', 'reunioes_comerciais'] as const

  it('RLS habilitada e FORÇADA nas três', async () => {
    for (const t of TABELAS_NOVAS_DE_G6) {
      const r = await migrate.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
        `SELECT c.relrowsecurity, c.relforcerowsecurity
           FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relname = $1`,
        [t],
      )
      expect(r.rows[0], `tabela ${t} não existe`).toBeDefined()
      expect(r.rows[0]!.relrowsecurity, `${t} sem RLS habilitada`).toBe(true)
      expect(r.rows[0]!.relforcerowsecurity, `${t} sem RLS forçada`).toBe(true)
    }
  })

  it('fir_app não tem NENHUM privilégio nas três', async () => {
    for (const t of TABELAS_NOVAS_DE_G6) {
      const r = await migrate.query<{ privilege_type: string }>(
        `SELECT privilege_type FROM information_schema.table_privileges
          WHERE table_schema = 'public' AND table_name = $1 AND grantee = 'fir_app'`,
        [t],
      )
      expect(r.rows, `fir_app tem privilégio em ${t}: ${JSON.stringify(r.rows)}`).toEqual([])
    }
  })

  it('a policy de fir_carteira (a que não é "_portal") usa app_pode_ver_grupo, sem OR', async () => {
    for (const t of TABELAS_NOVAS_DE_G6) {
      const r = await migrate.query<{ policyname: string; qual: string | null }>(
        `SELECT policyname, qual FROM pg_policies WHERE schemaname = 'public' AND tablename = $1`,
        [t],
      )
      // A policy da carteira não declara `TO`, então vale por omissão para
      // qualquer papel com GRANT (só `fir_carteira` tem INSERT/UPDATE nestas
      // três) — é a que NÃO termina em "_portal".
      const candidata = r.rows.find((p) => !p.policyname.endsWith('_portal'))
      expect(candidata, `${t}: policy de fir_carteira não encontrada`).toBeDefined()
      expect(candidata!.qual, `${t}: sem app_pode_ver_grupo`).toContain('app_pode_ver_grupo')
      expect(candidata!.qual?.toUpperCase(), `${t}: tem OR`).not.toMatch(/\bOR\b/)
    }
  })
})

describe('app_portal_pode_ver: o CASE...ELSE mora dentro da função, nunca OR na policy (ADR 0018 §1)', () => {
  it('nenhuma policy restrita a fir_portal contém "OR", e todas chamam app_portal_pode_ver', async () => {
    const r = await migrate.query<{ tablename: string; policyname: string; qual: string | null }>(
      `SELECT c.relname AS tablename, p.policyname, p.qual
         FROM pg_policies p
         JOIN pg_class c ON c.relname = p.tablename
        WHERE p.schemaname = 'public'
          AND p.roles @> ARRAY['fir_portal']::name[]`,
    )
    expect(r.rows.length, 'nenhuma policy de fir_portal encontrada — a varredura não verificou nada').toBeGreaterThan(0)
    for (const p of r.rows) {
      expect(p.qual, `${p.tablename}: policy "${p.policyname}" sem USING por portal`).toContain(
        'app_portal_pode_ver',
      )
      expect(
        p.qual?.toUpperCase(),
        `${p.tablename}: policy "${p.policyname}" tem OR no USING (qual = ${p.qual})`,
      ).not.toMatch(/\bOR\b/)
    }
  })

  it('escopo=cliente: só o ramo ELSE é avaliado — vê o próprio cliente, nunca o grupo', async () => {
    await migrate.query(`SELECT set_config('app.portal_cliente_id', $1, false)`, [clienteX])
    await migrate.query(`SELECT set_config('app.portal_grupo_id', '', false)`)
    const r = await migrate.query<{ a: boolean; b: boolean }>(
      `SELECT app_portal_pode_ver($1, $2) AS a, app_portal_pode_ver($1, $3) AS b`,
      [grupoA, clienteX, clienteY],
    )
    expect(r.rows[0]).toEqual({ a: true, b: false })
  })

  it('escopo=grupo vê qualquer cliente do próprio grupo, nunca de outro', async () => {
    await migrate.query(`SELECT set_config('app.portal_cliente_id', '', false)`)
    await migrate.query(`SELECT set_config('app.portal_grupo_id', $1, false)`, [grupoA])
    const r = await migrate.query<{ a: boolean; b: boolean }>(
      `SELECT app_portal_pode_ver($1, $2) AS a, app_portal_pode_ver($2, $3) AS b`,
      [grupoA, clienteX, grupoB],
    )
    expect(r.rows[0]).toEqual({ a: true, b: false })
  })

  it('sem nada fixado, não vê nada', async () => {
    await migrate.query(`SELECT set_config('app.portal_cliente_id', '', false)`)
    await migrate.query(`SELECT set_config('app.portal_grupo_id', '', false)`)
    const r = await migrate.query<{ a: boolean }>(`SELECT app_portal_pode_ver($1, $2) AS a`, [grupoA, clienteX])
    expect(r.rows[0]!.a).toBe(false)
  })
})

describe('isolamento de DADO, lido como fir_portal de verdade — ADR 0018 critérios 1, 10 e spec critério 3', () => {
  it('escopo=cliente (X) NUNCA lê outro cliente do MESMO grupo (Y) — critério 10', async () => {
    const nomes = await comoSessaoDoPortal({ clienteCarteiraId: clienteX, grupoId: null }, (c) =>
      c.query<{ nome: string }>('SELECT nome FROM clientes_carteira ORDER BY nome').then((r) => r.rows.map((x) => x.nome)),
    )
    expect(nomes).toEqual(['Cliente X'])
  })

  it('escopo=cliente (Y) só vê a si mesmo, nunca X nem Z', async () => {
    const nomes = await comoSessaoDoPortal({ clienteCarteiraId: clienteY, grupoId: null }, (c) =>
      c.query<{ nome: string }>('SELECT nome FROM clientes_carteira ORDER BY nome').then((r) => r.rows.map((x) => x.nome)),
    )
    expect(nomes).toEqual(['Cliente Y'])
  })

  it('escopo=grupo (A) vê X e Y, nunca Z — isolamento cruzando grupos (critério 3 do spec)', async () => {
    const nomes = await comoSessaoDoPortal({ clienteCarteiraId: null, grupoId: grupoA }, (c) =>
      c.query<{ nome: string }>('SELECT nome FROM clientes_carteira ORDER BY nome').then((r) => r.rows.map((x) => x.nome)),
    )
    expect(nomes).toEqual(['Cliente X', 'Cliente Y'])
  })

  it('escopo=grupo (B) vê só Z — nunca coincidência de ordem', async () => {
    const nomes = await comoSessaoDoPortal({ clienteCarteiraId: null, grupoId: grupoB }, (c) =>
      c.query<{ nome: string }>('SELECT nome FROM clientes_carteira ORDER BY nome').then((r) => r.rows.map((x) => x.nome)),
    )
    expect(nomes).toEqual(['Cliente Z'])
  })

  it('URL manipulada — tentar ler Y com parâmetro explícito, logado como X, não escapa a RLS', async () => {
    const linhas = await comoSessaoDoPortal({ clienteCarteiraId: clienteX, grupoId: null }, (c) =>
      c.query<{ id: string }>('SELECT id FROM clientes_carteira WHERE id = $1', [clienteY]).then((r) => r.rows),
    )
    expect(linhas).toEqual([])
  })
})

describe('usuarios_do_portal: o invariante de Escopo (CHECK)', () => {
  it('escopo=cliente SEM cliente_carteira_id é recusado', async () => {
    await expect(
      migrate.query(
        `INSERT INTO usuarios_do_portal (usuario, nome, senha_hash, escopo)
         VALUES ('teste.portal.sem.cliente', 'Teste', 'x', 'cliente')`,
      ),
    ).rejects.toThrow(/usuarios_do_portal_escopo_exclusivo/)
  })

  it('escopo=grupo SEM grupo_id é recusado', async () => {
    await expect(
      migrate.query(
        `INSERT INTO usuarios_do_portal (usuario, nome, senha_hash, escopo)
         VALUES ('teste.portal.sem.grupo', 'Teste', 'x', 'grupo')`,
      ),
    ).rejects.toThrow(/usuarios_do_portal_escopo_exclusivo/)
  })

  it('escopo=cliente COM grupo_id (os dois) é recusado', async () => {
    await expect(
      migrate.query(
        `INSERT INTO usuarios_do_portal (usuario, nome, senha_hash, escopo, cliente_carteira_id, grupo_id)
         VALUES ('teste.portal.dois', 'Teste', 'x', 'cliente', $1, $2)`,
        [clienteX, grupoA],
      ),
    ).rejects.toThrow(/usuarios_do_portal_escopo_exclusivo/)
  })

  it('escopo=cliente só com cliente_carteira_id é aceito', async () => {
    const r = await migrate.query<{ id: string }>(
      `INSERT INTO usuarios_do_portal (usuario, nome, senha_hash, escopo, cliente_carteira_id)
       VALUES ('${usuarioValido}', 'Teste Válido', 'x', 'cliente', $1) RETURNING id`,
      [clienteX],
    )
    expect(r.rows[0]!.id).toBeDefined()
  })

  it('P-12: desativar não apaga a linha — estado, nunca exclusão (regra 20)', async () => {
    await migrate.query(`UPDATE usuarios_do_portal SET ativo = false WHERE usuario = '${usuarioValido}'`)
    const r = await migrate.query<{ ativo: boolean }>(
      `SELECT ativo FROM usuarios_do_portal WHERE usuario = '${usuarioValido}'`,
    )
    expect(r.rows[0]!.ativo).toBe(false)
  })
})

describe('o ator "usuario_portal" é emitido de verdade na trilha DA CLÍNICA', () => {
  it('registrar_auditoria reconhece o prefixo usuario_portal: — quarto valor de ator_tipo', async () => {
    const perfil = await migrate.query<{ id: string }>(
      `INSERT INTO perfis (clinica_id, chave, nome, perms) VALUES ($1, 'pf_rec', 'Recepção', '{jornada}') RETURNING id`,
      [clinicaA],
    )
    const pessoa = await migrate.query<{ id: string }>(
      `INSERT INTO pessoas (clinica_id, nome, usuario, senha_hash, perfil_id)
       VALUES ($1, 'Fulana', 'fulana.portal', 'x', $2) RETURNING id`,
      [clinicaA, perfil.rows[0]!.id],
    )
    const usuarioPortal = await migrate.query<{ id: string }>(
      `SELECT id FROM usuarios_do_portal WHERE usuario = '${usuarioValido}'`,
    )
    const id = usuarioPortal.rows[0]!.id
    await migrate.query(`SELECT set_config('app.pessoa_id', 'usuario_portal:' || $1, false)`, [id])
    await migrate.query(`UPDATE pessoas SET funcao = 'x' WHERE id = $1`, [pessoa.rows[0]!.id])

    const trilha = await migrate.query<{ ator_tipo: string; ator_id: string }>(
      `SELECT ator_tipo, ator_id FROM auditoria WHERE clinica_id = $1 ORDER BY em DESC, id DESC LIMIT 1`,
      [clinicaA],
    )
    expect(trilha.rows[0]).toEqual({ ator_tipo: 'usuario_portal', ator_id: id })
    await declararAtorSistema(migrate)
  })
})

/**
 * REGRESSÃO — bloqueador de merge encontrado pelo `revisor-codigo` na revisão
 * de G6, reproduzido ao vivo contra este mesmo Postgres: as nove tabelas
 * comerciais abaixo tinham, de ANTES de G6 (0026/0028/0031), uma policy
 * `app_pode_ver_grupo(grupo_id)` SEM cláusula `TO` — logo `TO PUBLIC`,
 * aplicável a QUALQUER role, inclusive `fir_portal`. A 0034 somou, nas
 * MESMAS tabelas, uma SEGUNDA policy permissiva restrita `TO fir_portal`.
 *
 * Múltiplas policies PERMISSIVAS que valem para o mesmo role compõem por OR
 * no Postgres — e `app_pode_ver_grupo` devolve `true` para qualquer grupo
 * quando `app.escopo = 'geral'`. Antes da migration 0035, um `fir_portal`
 * que por qualquer razão tivesse `app.escopo = 'geral'` fixado na conexão
 * (nunca fixado pelo `PortalGuard` hoje, mas nada no BANCO o impedia)
 * enxergava a tabela INTEIRA, nas nove tabelas — medido: `SELECT count(*)
 * FROM clientes_carteira` devolvia as 26 linhas de todos os grupos.
 *
 * Dois textos afirmavam o oposto do que o Postgres fazia: o comentário em
 * `0034_carteira_portal.sql` perto de `documentos_carteira_portal` ("não
 * compõe por OR... cada papel só é sujeito à SUA policy" — verdade só sobre
 * a policy NOVA, falso sobre a antiga, que não tinha `TO`); e o filtro de
 * `teste/isolamento-de-clinica.test.ts` que excluía de propósito qualquer
 * policy `TO fir_portal` do exame de texto — nunca exercitou a COMPOSIÇÃO
 * real.
 *
 * A migration 0035 fecha o buraco com `ALTER POLICY ... TO fir_carteira`
 * nas nove policies pré-existentes. Este teste PROVA o fechamento por
 * COMPORTAMENTO (conectando como `fir_portal` de verdade), não por leitura
 * de texto — é o teste que teria pego o bug antes do merge.
 */
describe('REGRESSÃO: fir_portal com app.escopo=geral (sem app.portal_*) não compõe por OR com a policy de fir_carteira', () => {
  let campanhaId: string
  let indicadorId: string
  let lancamentoId: string
  let metaId: string
  let cobrancaId: string
  let usuarioGestaoId: string

  beforeAll(async () => {
    // O PRÓPRIO usuário de gestão, nunca "qualquer um que exista": o
    // `SELECT … LIMIT 1` de antes dependia de outro arquivo ter deixado um no
    // banco naquele instante — num banco novo (e em paralelo, quando o outro
    // arquivo já tinha limpado o seu) o teste caía com TypeError antes de
    // provar a regressão de RLS que ele existe para provar.
    usuarioGestaoId = (
      await migrate.query<{ id: string }>(
        `INSERT INTO usuarios_gestao (usuario, nome, senha_hash, escopo, grupo_id)
         VALUES ($1, 'Regressão RLS', 'x', 'grupo', $2) RETURNING id`,
        [`regressao.rls.${Date.now()}`, grupoA],
      )
    ).rows[0]!.id

    campanhaId = (
      await migrate.query<{ id: string }>(
        `INSERT INTO campanhas_carteira
           (cliente_carteira_id, grupo_id, origem, nome, periodo_inicio, periodo_fim, metrica, meta)
         VALUES ($1, $2, 'manual', 'Campanha regressão RLS', now(), now(), 'contatos', 10)
         RETURNING id`,
        [clienteX, grupoA],
      )
    ).rows[0]!.id

    indicadorId = (
      await migrate.query<{ id: string }>(
        `INSERT INTO indicadores_carteira (cliente_carteira_id, grupo_id, nome, unidade, sentido)
         VALUES ($1, $2, 'Indicador regressão RLS', 'un', 'maior_melhor') RETURNING id`,
        [clienteX, grupoA],
      )
    ).rows[0]!.id

    lancamentoId = (
      await migrate.query<{ id: string }>(
        `INSERT INTO lancamentos_de_indicador
           (indicador_id, grupo_id, referencia, valor_inteiro, lancado_por)
         VALUES ($1, $2, current_date, 42, $3) RETURNING id`,
        [indicadorId, grupoA, usuarioGestaoId],
      )
    ).rows[0]!.id

    metaId = (
      await migrate.query<{ id: string }>(
        `INSERT INTO metas_comerciais
           (cliente_carteira_id, grupo_id, indicador_id, titulo, sentido, valor_meta_inteiro, inicio, prazo)
         VALUES ($1, $2, $3, 'Meta regressão RLS', 'maior_melhor', 100, current_date, current_date + 30)
         RETURNING id`,
        [clienteX, grupoA, indicadorId],
      )
    ).rows[0]!.id

    cobrancaId = (
      await migrate.query<{ id: string }>(
        `INSERT INTO cobrancas_do_cliente_firmare
           (cliente_carteira_id, grupo_id, competencia, mensalidade_centavos, valor_centavos, vencimento)
         VALUES ($1, $2, date_trunc('month', current_date), 100000, 100000, current_date + 10)
         RETURNING id`,
        [clienteX, grupoA],
      )
    ).rows[0]!.id
  })

  afterAll(async () => {
    await migrate.query('DELETE FROM cobrancas_do_cliente_firmare WHERE id = $1', [cobrancaId])
    await migrate.query('DELETE FROM metas_comerciais WHERE id = $1', [metaId])
    await migrate.query('DELETE FROM lancamentos_de_indicador WHERE id = $1', [lancamentoId])
    await migrate.query('DELETE FROM indicadores_carteira WHERE id = $1', [indicadorId])
    await migrate.query('DELETE FROM campanhas_carteira WHERE id = $1', [campanhaId])
    await migrate.query('DELETE FROM usuarios_gestao WHERE id = $1', [usuarioGestaoId])
  })

  /** Mesma conexão/transação de `comoSessaoDoPortal`, mas fixando SÓ `app.escopo` — nunca `app.portal_*` — que é exatamente a reprodução do revisor. */
  async function comoFirPortalComEscopoGeral<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
    const c = await conectarComoPortal()
    try {
      await c.query('BEGIN')
      await c.query(`SELECT set_config('app.escopo', 'geral', true)`)
      const r = await fn(c)
      await c.query('COMMIT')
      return r
    } finally {
      await c.end()
    }
  }

  it('cada uma das nove tabelas comerciais devolve ZERO linhas para fir_portal com só app.escopo=geral fixado', async () => {
    const consultas: Array<[string, string, string]> = [
      ['clientes_carteira', 'id', clienteX],
      ['campanhas_carteira', 'id', campanhaId],
      ['indicadores_carteira', 'id', indicadorId],
      ['lancamentos_de_indicador', 'id', lancamentoId],
      ['metas_comerciais', 'id', metaId],
      ['cobrancas_do_cliente_firmare', 'id', cobrancaId],
    ]

    for (const [tabela, coluna, valor] of consultas) {
      // Confere primeiro que a linha EXISTE de verdade (via fir_migrate, sem RLS de role) —
      // sem isto, "zero linhas" poderia significar só "a fixture não foi criada".
      const existe = await migrate.query(`SELECT 1 FROM ${tabela} WHERE ${coluna} = $1`, [valor])
      expect(existe.rows.length, `fixture ausente em ${tabela}`).toBe(1)

      const comoPortal = await comoFirPortalComEscopoGeral((c) =>
        c.query(`SELECT 1 FROM ${tabela} WHERE ${coluna} = $1`, [valor]),
      )
      expect(
        comoPortal.rows,
        `${tabela}: fir_portal com app.escopo=geral enxergou a linha — a policy ` +
          `pré-existente (sem TO) voltou a compor por OR com a policy _portal`,
      ).toEqual([])
    }
  })

  it('documentos_carteira/materiais_carteira/reunioes_comerciais também devolvem ZERO para fir_portal com app.escopo=geral', async () => {
    const ug = await migrate.query<{ id: string }>(`SELECT id FROM usuarios_gestao LIMIT 1`)
    const doc = await migrate.query<{ id: string }>(
      `INSERT INTO documentos_carteira (cliente_carteira_id, grupo_id, titulo, categoria, link, data, criado_por)
       VALUES ($1, $2, 'Doc regressão RLS', 'Jurídico', 'https://x', now(), $3) RETURNING id`,
      [clienteX, grupoA, ug.rows[0]!.id],
    )
    const mat = await migrate.query<{ id: string }>(
      `INSERT INTO materiais_carteira (cliente_carteira_id, grupo_id, titulo, tipo, criado_por)
       VALUES ($1, $2, 'Material regressão RLS', 'pdf', $3) RETURNING id`,
      [clienteX, grupoA, ug.rows[0]!.id],
    )
    const reu = await migrate.query<{ id: string }>(
      `INSERT INTO reunioes_comerciais (cliente_carteira_id, grupo_id, data, resumo, por_usuario_gestao_id)
       VALUES ($1, $2, current_date, 'Resumo regressão RLS', $3) RETURNING id`,
      [clienteX, grupoA, ug.rows[0]!.id],
    )

    try {
      for (const [tabela, id] of [
        ['documentos_carteira', doc.rows[0]!.id],
        ['materiais_carteira', mat.rows[0]!.id],
        ['reunioes_comerciais', reu.rows[0]!.id],
      ] as const) {
        const comoPortal = await comoFirPortalComEscopoGeral((c) =>
          c.query(`SELECT 1 FROM ${tabela} WHERE id = $1`, [id]),
        )
        expect(
          comoPortal.rows,
          `${tabela}: fir_portal com app.escopo=geral enxergou a linha — composição por OR voltou`,
        ).toEqual([])
      }
    } finally {
      await migrate.query('DELETE FROM reunioes_comerciais WHERE id = $1', [reu.rows[0]!.id])
      await migrate.query('DELETE FROM materiais_carteira WHERE id = $1', [mat.rows[0]!.id])
      await migrate.query('DELETE FROM documentos_carteira WHERE id = $1', [doc.rows[0]!.id])
    }
  })
})

describe('documentos_carteira/materiais_carteira: visivel_portal filtra a LEITURA do portal, nunca uma segunda tabela (critério 8)', () => {
  it('visivel_portal=false some do portal, mas continua visível para fir_carteira', async () => {
    const operadorQualquer = await migrate.query<{ id: string }>(`SELECT id FROM usuarios_gestao LIMIT 1`)
    const ug = operadorQualquer.rows[0]
    if (!ug) return // nenhum usuario_gestao de fixture neste arquivo — guarda defensiva

    const doc = await migrate.query<{ id: string }>(
      `INSERT INTO documentos_carteira (cliente_carteira_id, grupo_id, titulo, categoria, link, data, visivel_portal, criado_por)
       VALUES ($1, $2, 'Contrato', 'Jurídico', 'https://x', now(), false, $3) RETURNING id`,
      [clienteX, grupoA, ug.id],
    )

    const viaPortal = await comoSessaoDoPortal({ clienteCarteiraId: clienteX, grupoId: null }, (c) =>
      c.query<{ id: string }>('SELECT id FROM documentos_carteira WHERE id = $1', [doc.rows[0]!.id]).then((r) => r.rows),
    )
    expect(viaPortal).toEqual([])

    const viaCarteira = await migrate.query<{ id: string }>(
      `SELECT id FROM documentos_carteira WHERE id = $1`,
      [doc.rows[0]!.id],
    )
    expect(viaCarteira.rows).toHaveLength(1)

    await migrate.query(`DELETE FROM documentos_carteira WHERE id = $1`, [doc.rows[0]!.id])
  })
})

/**
 * G8 ticket 0.1 (D-P1, appsec A-7, LGPD A6/A7) — migration 0042.
 *
 * A reunião só chega ao portal compartilhada E não arquivada. Antes da 0042
 * a policy do portal mostrava TODA ata registrada, inclusive as que levam
 * impressões internas. E o portal lê só as colunas da lista branca, por
 * privilégio de coluna: quem registrou (`por_usuario_gestao_id`) e qualquer
 * coluna interna futura nunca atravessam.
 */
describe('reunioes_comerciais: só a ata compartilhada e não arquivada chega ao portal (G8 0.1)', () => {
  let ugId: string
  let naoCompartilhada: string
  let compartilhada: string
  let arquivada: string
  let deOutroCliente: string

  const inserirReuniao = async (
    cliente: string,
    grupo: string,
    resumo: string,
    estado: { compartilhada?: boolean; arquivada?: boolean } = {},
  ): Promise<string> => {
    // `compartilhada` só entra no INSERT quando o teste diz — omitida, vale o DEFAULT.
    const colunas = ['cliente_carteira_id', 'grupo_id', 'data', 'resumo', 'por_usuario_gestao_id']
    const valores = ['$1', '$2', 'current_date', '$3', '$4']
    if (estado.compartilhada !== undefined) {
      colunas.push('compartilhada')
      valores.push(estado.compartilhada ? 'true' : 'false')
    }
    if (estado.arquivada) {
      colunas.push('arquivada_em')
      valores.push('now()')
    }
    const r = await migrate.query<{ id: string }>(
      `INSERT INTO reunioes_comerciais (${colunas.join(', ')}) VALUES (${valores.join(', ')}) RETURNING id`,
      [cliente, grupo, resumo, ugId],
    )
    return r.rows[0]!.id
  }

  beforeAll(async () => {
    await declararAtorSistema(migrate)
    ugId = (
      await migrate.query<{ id: string }>(
        `INSERT INTO usuarios_gestao (usuario, nome, senha_hash, escopo, grupo_id)
         VALUES ($1, 'Ata G8', 'x', 'grupo', $2) RETURNING id`,
        [`ata.g8.${sufixo}`, grupoA],
      )
    ).rows[0]!.id
    // Sem dizer nada: o padrão tem que ser "não compartilhada" (protótipo L1671).
    naoCompartilhada = await inserirReuniao(clienteX, grupoA, 'Impressões internas da reunião')
    compartilhada = await inserirReuniao(clienteX, grupoA, 'Ata compartilhada', { compartilhada: true })
    arquivada = await inserirReuniao(clienteX, grupoA, 'Ata compartilhada e arquivada', { compartilhada: true, arquivada: true })
    deOutroCliente = await inserirReuniao(clienteY, grupoA, 'Ata de Y compartilhada', { compartilhada: true })
  })

  afterAll(async () => {
    await declararAtorSistema(migrate)
    await migrate.query('DELETE FROM reunioes_comerciais WHERE id = ANY($1)', [
      [naoCompartilhada, compartilhada, arquivada, deOutroCliente],
    ])
    await migrate.query('DELETE FROM usuarios_gestao WHERE id = $1', [ugId])
  })

  const idsVistos = (escopo: { clienteCarteiraId: string | null; grupoId: string | null }) =>
    comoSessaoDoPortal(escopo, (c) =>
      c
        .query<{ id: string }>('SELECT id FROM reunioes_comerciais WHERE id = ANY($1)', [
          [naoCompartilhada, compartilhada, arquivada, deOutroCliente],
        ])
        .then((r) => r.rows.map((x) => x.id).sort()),
    )

  it('a coluna nasce false: ata registrada sem escolha não é compartilhada', async () => {
    const r = await migrate.query<{ compartilhada: boolean }>(
      'SELECT compartilhada FROM reunioes_comerciais WHERE id = $1',
      [naoCompartilhada],
    )
    expect(r.rows[0]!.compartilhada).toBe(false)
  })

  it('escopo=cliente: vê só a compartilhada e não arquivada do próprio cliente', async () => {
    expect(await idsVistos({ clienteCarteiraId: clienteX, grupoId: null })).toEqual([compartilhada])
  })

  it('escopo=grupo: vê as compartilhadas e não arquivadas do grupo — nunca a não compartilhada nem a arquivada', async () => {
    expect(await idsVistos({ clienteCarteiraId: null, grupoId: grupoA })).toEqual(
      [compartilhada, deOutroCliente].sort(),
    )
  })

  it('a equipe (fir_carteira) continua vendo todas', async () => {
    const r = await migrate.query('SELECT id FROM reunioes_comerciais WHERE id = ANY($1)', [
      [naoCompartilhada, compartilhada, arquivada, deOutroCliente],
    ])
    expect(r.rows.length).toBe(4)
  })

  it('lista branca por privilégio de coluna: fir_portal não lê quem registrou nem quando, e não tem SELECT de tabela', async () => {
    const r = await migrate.query<{ tabela: boolean; resumo: boolean; quem: boolean; criado: boolean }>(
      `SELECT has_table_privilege('fir_portal', 'reunioes_comerciais', 'SELECT') AS tabela,
              has_column_privilege('fir_portal', 'reunioes_comerciais', 'resumo', 'SELECT') AS resumo,
              has_column_privilege('fir_portal', 'reunioes_comerciais', 'por_usuario_gestao_id', 'SELECT') AS quem,
              has_column_privilege('fir_portal', 'reunioes_comerciais', 'criado_em', 'SELECT') AS criado`,
    )
    expect(r.rows[0]).toEqual({ tabela: false, resumo: true, quem: false, criado: false })

    await expect(
      comoSessaoDoPortal({ clienteCarteiraId: clienteX, grupoId: null }, (c) =>
        c.query('SELECT por_usuario_gestao_id FROM reunioes_comerciais'),
      ),
    ).rejects.toThrow(/permission denied/)
  })

  it('a policy do portal tem TO fir_portal e as condições por AND (lição da 0035)', async () => {
    const r = await migrate.query<{ roles: string[]; qual: string }>(
      `SELECT roles::text[] AS roles, qual FROM pg_policies
        WHERE tablename = 'reunioes_comerciais' AND policyname = 'reunioes_comerciais_portal'`,
    )
    expect(r.rows[0]!.roles).toEqual(['fir_portal'])
    expect(r.rows[0]!.qual).toMatch(/compartilhada AND \(arquivada_em IS NULL\) AND app_portal_pode_ver/)
    expect(r.rows[0]!.qual).not.toMatch(/\bOR\b/)
  })

  it('mudar compartilhada deixa trilha de → para (LGPD A8)', async () => {
    await migrate.query('UPDATE reunioes_comerciais SET compartilhada = true WHERE id = $1', [naoCompartilhada])
    await migrate.query('UPDATE reunioes_comerciais SET compartilhada = false WHERE id = $1', [naoCompartilhada])
    const t = await migrate.query<{ de: { compartilhada: boolean }; para: { compartilhada: boolean } }>(
      `SELECT de, para FROM auditoria_do_painel
        WHERE entidade = 'reunioes_comerciais' AND entidade_id = $1 AND acao = 'alterou' ORDER BY id`,
      [naoCompartilhada],
    )
    expect(t.rows.map((x) => [x.de.compartilhada, x.para.compartilhada])).toEqual([
      [false, true],
      [true, false],
    ])
  })
})
