import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { apagarClinicaDeTeste, declararAtorSistema } from '@fir/api/banco/limpeza-de-teste'

/**
 * O PAINEL NO BANCO — migration 0013.
 *
 * As quatro tabelas do superadmin **não têm `clinica_id`**, e isso é o
 * desenho, não um esquecimento: o superadmin não é uma `pessoa` e não
 * pertence a clínica nenhuma (D-5, restrição 1; D-10). Por não terem
 * `clinica_id`, elas ficam fora da varredura de
 * `teste/auditoria-inescapavel.test.ts` — quem as protege é `escrita-sem-rls`
 * (todo relação sem RLS precisa de REVOKE) e os testes deste arquivo.
 *
 * A invariante que mais importa aqui: **`fir_painel` é súdito da RLS como
 * qualquer um.** Se o teste do "banco vazio" passar a devolver linhas, o
 * isolamento do produto inteiro acabou.
 */
const URL_MIG =
  process.env['DATABASE_URL_MIGRATE'] ?? 'postgresql://fir_migrate:fir_local_dev@127.0.0.1:4832/fir'

const URL_PAINEL =
  process.env['DATABASE_URL_PAINEL'] ?? 'postgresql://fir_painel:fir_local_dev@127.0.0.1:4832/fir'

const TABELAS_DO_PAINEL = [
  'operadores',
  'sessoes_de_operador',
  'tentativas_de_operador',
  'auditoria_do_painel',
] as const

let migrate: pg.Client
let clinica: string
let pessoa: string
let operador: string

const codigo = `painel-${Date.now()}`

/** Um cliente autenticado como o papel pedido. Fecha por conta de quem chama. */
async function conectarComo(papel: 'fir_painel' | 'fir_app'): Promise<pg.Client> {
  const url =
    papel === 'fir_painel'
      ? URL_PAINEL
      : (process.env['DATABASE_URL'] ?? 'postgresql://fir_app:fir_local_dev@127.0.0.1:4832/fir')
  const c = new pg.Client({ connectionString: url })
  c.on('error', (e) => console.error(`[painel-no-banco] ${papel}:`, e.message))
  await c.connect()
  return c
}

/**
 * Tenta criar clínica como o papel, e desfaz sempre.
 *
 * Dentro de transação com ROLLBACK de propósito: o que se mede é o
 * PRIVILÉGIO, e o teste não pode deixar clínica órfã atrás de si.
 */
async function podeInserirClinica(papel: 'fir_painel' | 'fir_app'): Promise<boolean> {
  const c = await conectarComo(papel)
  try {
    await c.query('BEGIN')
    // Declarar o ator é obrigatório mesmo aqui: `clinicas` tem triggers
    // `SECURITY DEFINER` que semeiam motivos de perda e procedimentos na
    // clínica nova, e essas escritas passam por `registrar_auditoria`. É a
    // razão pela qual a criação de clínica pelo painel (Task 11) fixa
    // `app.pessoa_id` ANTES do `INSERT`, e não depois.
    await c.query(`SELECT set_config('app.pessoa_id', 'sistema', true)`)
    await c.query(`INSERT INTO clinicas (codigo, nome) VALUES ($1, 'Teste de privilégio')`, [
      `${codigo}-priv-${papel}`,
    ])
    await c.query('ROLLBACK')
    return true
  } catch {
    try {
      await c.query('ROLLBACK')
    } catch {
      // a transação já estava abortada; nada a fazer
    }
    return false
  } finally {
    await c.end()
  }
}

const ultimaLinhaDaTrilha = async () =>
  (
    await migrate.query<{ ator_tipo: string; ator_id: string | null }>(
      `SELECT ator_tipo, ator_id FROM auditoria
        WHERE clinica_id = $1 ORDER BY em DESC, id DESC LIMIT 1`,
      [clinica],
    )
  ).rows[0]!

beforeAll(async () => {
  migrate = new pg.Client({ connectionString: URL_MIG })
  migrate.on('error', (e) => console.error('[painel-no-banco] migrate:', e.message))
  await migrate.connect()
  await declararAtorSistema(migrate)

  clinica = (
    await migrate.query<{ id: string }>(
      `INSERT INTO clinicas (codigo, nome) VALUES ($1, 'Clínica do painel') RETURNING id`,
      [codigo],
    )
  ).rows[0]!.id

  const perfil = await migrate.query<{ id: string }>(
    `INSERT INTO perfis (clinica_id, chave, nome, perms)
     VALUES ($1, 'pf_rec', 'Recepção', '{jornada}') RETURNING id`,
    [clinica],
  )
  pessoa = (
    await migrate.query<{ id: string }>(
      `INSERT INTO pessoas (clinica_id, nome, usuario, senha_hash, perfil_id)
       VALUES ($1, 'Juliana', 'juliana', 'x', $2) RETURNING id`,
      [clinica, perfil.rows[0]!.id],
    )
  ).rows[0]!.id

  operador = (
    await migrate.query<{ id: string }>(
      `INSERT INTO operadores (usuario, nome, senha_hash) VALUES ($1, 'Operador de teste', 'x')
       RETURNING id`,
      [`op.${Date.now()}`.slice(0, 32)],
    )
  ).rows[0]!.id
})

afterAll(async () => {
  await declararAtorSistema(migrate)
  await migrate.query('DELETE FROM sessoes_de_operador WHERE operador_id = $1', [operador])
  await migrate.query('DELETE FROM operadores WHERE id = $1', [operador])
  await apagarClinicaDeTeste(migrate, clinica)
  await migrate.end()
})

describe('privilégio: o painel é invisível para a aplicação', () => {
  it('fir_app não enxerga NADA do painel — nem SELECT', async () => {
    for (const t of TABELAS_DO_PAINEL) {
      const p = await migrate.query<{
        sel: boolean
        ins: boolean
        upd: boolean
        del: boolean
      }>(
        `SELECT has_table_privilege('fir_app', $1, 'SELECT') AS sel,
                has_table_privilege('fir_app', $1, 'INSERT') AS ins,
                has_table_privilege('fir_app', $1, 'UPDATE') AS upd,
                has_table_privilege('fir_app', $1, 'DELETE') AS del`,
        [t],
      )
      expect(Object.values(p.rows[0]!), `fir_app alcança ${t}`).toEqual([false, false, false, false])
    }
  })

  it('fir_app não alcança nem a sequência de tentativas_de_operador', async () => {
    const r = await migrate.query<{ u: boolean }>(
      `SELECT has_sequence_privilege('fir_app', 'tentativas_de_operador_id_seq', 'USAGE') AS u`,
    )
    expect(r.rows[0]!.u).toBe(false)
  })
})

describe('fir_painel é um papel comum, sujeito à RLS', () => {
  it('fir_painel NÃO atravessa a RLS — sem BYPASSRLS, sem SUPERUSER, sem CREATEROLE', async () => {
    const r = await migrate.query<{
      rolbypassrls: boolean
      rolsuper: boolean
      rolcreaterole: boolean
    }>(`SELECT rolbypassrls, rolsuper, rolcreaterole FROM pg_roles WHERE rolname = 'fir_painel'`)
    expect(r.rows[0]).toEqual({ rolbypassrls: false, rolsuper: false, rolcreaterole: false })
  })

  it('fir_painel sem app.clinica_id fixado vê um banco VAZIO', async () => {
    // A prova de que o painel é súdito da RLS como qualquer um. O piso da
    // outra ponta importa tanto quanto: se `pessoas` estivesse vazia, zero
    // não provaria nada.
    const existem = await migrate.query<{ n: number }>('SELECT count(*)::int AS n FROM pessoas')
    expect(existem.rows[0]!.n, 'não há pessoa nenhuma: o zero abaixo não provaria nada').toBeGreaterThan(0)

    const c = await conectarComo('fir_painel')
    try {
      const r = await c.query<{ n: number }>('SELECT count(*)::int AS n FROM pessoas')
      expect(r.rows[0]!.n).toBe(0)
    } finally {
      await c.end()
    }
  })

  it('fir_painel com a clínica fixada enxerga só ela', async () => {
    const c = await conectarComo('fir_painel')
    try {
      await c.query(`SELECT set_config('app.clinica_id', $1, false)`, [clinica])
      const r = await c.query<{ id: string }>('SELECT id FROM pessoas')
      expect(r.rows.map((x) => x.id)).toEqual([pessoa])
    } finally {
      await c.end()
    }
  })

  it('fir_painel pode criar clínica; fir_app não', async () => {
    expect(await podeInserirClinica('fir_painel')).toBe(true)
    expect(await podeInserirClinica('fir_app')).toBe(false)
  })
})

describe('o ator "operador" é emitido de verdade', () => {
  it('grava ator_tipo=operador na trilha DA CLÍNICA', async () => {
    await migrate.query(`SELECT set_config('app.pessoa_id', 'operador:' || $1, false)`, [operador])
    await migrate.query(`UPDATE pessoas SET funcao = 'x' WHERE id = $1`, [pessoa])
    expect(await ultimaLinhaDaTrilha()).toEqual({ ator_tipo: 'operador', ator_id: operador })
    await declararAtorSistema(migrate)
  })

  it.each(['operador:', 'operador:nao-e-uuid', 'operador', 'ope:uuid-valido'])(
    'ator malformado (%s) continua RECUSANDO a escrita',
    async (mau) => {
      await migrate.query(`SELECT set_config('app.pessoa_id', $1, false)`, [mau])
      await expect(
        migrate.query(`UPDATE pessoas SET funcao = 'y' WHERE id = $1`, [pessoa]),
      ).rejects.toThrow()
      await declararAtorSistema(migrate)
    },
  )

  it('app_pessoa_id() devolve NULL para operador em vez de estourar', async () => {
    // A função faz `::uuid`. Sem tratamento, 'operador:…' derruba toda
    // consulta que a chame — e ela é chamada em teste e pode entrar numa
    // policy amanhã.
    await migrate.query(`SELECT set_config('app.pessoa_id', 'operador:' || $1, false)`, [operador])
    const r = await migrate.query<{ x: string | null }>('SELECT app_pessoa_id()::text AS x')
    expect(r.rows[0]!.x).toBeNull()
    await declararAtorSistema(migrate)
  })

  it('app_pessoa_id() continua devolvendo a pessoa, e NULL para sistema', async () => {
    await migrate.query(`SELECT set_config('app.pessoa_id', $1, false)`, [pessoa])
    expect(
      (await migrate.query<{ x: string | null }>('SELECT app_pessoa_id()::text AS x')).rows[0]!.x,
    ).toBe(pessoa)
    await declararAtorSistema(migrate)
    expect(
      (await migrate.query<{ x: string | null }>('SELECT app_pessoa_id()::text AS x')).rows[0]!.x,
    ).toBeNull()
  })
})

describe('auditoria_do_painel', () => {
  it('é append-only, nas duas camadas', async () => {
    await expect(migrate.query(`UPDATE auditoria_do_painel SET acao = 'x'`)).rejects.toThrow(
      /append-only/i,
    )
    await expect(migrate.query(`DELETE FROM auditoria_do_painel`)).rejects.toThrow(/append-only/i)
  })

  it('fir_painel insere e lê, mas não altera nem apaga', async () => {
    const p = await migrate.query<{ ins: boolean; sel: boolean; upd: boolean; del: boolean }>(
      `SELECT has_table_privilege('fir_painel', 'auditoria_do_painel', 'INSERT') AS ins,
              has_table_privilege('fir_painel', 'auditoria_do_painel', 'SELECT') AS sel,
              has_table_privilege('fir_painel', 'auditoria_do_painel', 'UPDATE') AS upd,
              has_table_privilege('fir_painel', 'auditoria_do_painel', 'DELETE') AS del`,
    )
    expect(p.rows[0]).toEqual({ ins: true, sel: true, upd: false, del: false })
  })

  it('operador como ator exige ator_id — "alguém fez" não é resposta', async () => {
    await expect(
      migrate.query(
        `INSERT INTO auditoria_do_painel (ator_tipo, acao, entidade, entidade_id)
         VALUES ('operador', 'criou', 'operadores', 'x')`,
      ),
    ).rejects.toThrow(/ator_do_painel_tem_id/)
  })

  it('aceita o break-glass da VPS, que não tem operador por trás', async () => {
    const r = await migrate.query<{ id: string }>(
      `INSERT INTO auditoria_do_painel (ator_tipo, acao, entidade, entidade_id, motivo)
       VALUES ('vps', 'alterou', 'operadores', $1, 'teste') RETURNING id::text`,
      [operador],
    )
    expect(r.rows[0]!.id).toBeDefined()
  })
})

describe('a denylist de segredos alcança as colunas do painel', () => {
  it('senha_hash e token_hash não atravessam para de/para', async () => {
    const r = await migrate.query<{ j: string }>(
      `SELECT auditoria_sem_segredos('{"senha_hash":"x","token_hash":"y","nome":"z"}')::text AS j`,
    )
    expect(r.rows[0]!.j).not.toMatch(/"x"|"y"/)
    expect(r.rows[0]!.j).toMatch(/"nome": ?"z"/)
  })
})

describe('operadores: a forma canônica é a mesma de pessoas.usuario', () => {
  it.each(['Ana', 'ana silva', 'ana..silva', 'ana.', '1ana', 'ab', 'a'.repeat(33), 'aná'])(
    'o banco RECUSA o operador %s',
    async (u) => {
      await expect(
        migrate.query(`INSERT INTO operadores (usuario, nome, senha_hash) VALUES ($1, 'X', 'h')`, [
          u,
        ]),
      ).rejects.toThrow(/operadores_usuario_canonico|usuario_canonico/)
    },
  )

  it('o usuário de operador é GLOBAL: não há clínica a que pertencer', async () => {
    const r = await migrate.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM information_schema.columns
        WHERE table_name = ANY($1) AND column_name = 'clinica_id'`,
      [[...TABELAS_DO_PAINEL]],
    )
    expect(r.rows[0]!.n, 'tabela do painel com clinica_id: o modelo se perdeu').toBe(0)
  })

  it('senha_provisoria true exige prazo, como em pessoas', async () => {
    await expect(
      migrate.query(`UPDATE operadores SET senha_provisoria = true WHERE id = $1`, [operador]),
    ).rejects.toThrow(/provisoria_tem_prazo/)
  })
})
