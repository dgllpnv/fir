import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  apagarClinicaDeTeste,
  apagarHistoricoGrupoDeTeste,
  declararAtorSistema,
} from '@fir/api/banco/limpeza-de-teste'

/**
 * A CARTEIRA NO BANCO — migration 0025 (G1a). ADRs 0011, 0012, 0013.
 *
 * `grupos`, `historico_grupo_da_clinica` e `usuarios_gestao` não têm
 * `clinica_id` — mesmo desenho do painel (0013): o ator não pertence a uma
 * clínica. Por isso ficam fora de `auditoria-inescapavel.test.ts`; quem as
 * protege é `escrita-sem-rls` (REVOKE) e este arquivo.
 *
 * A invariante que mais importa aqui é a mesma do painel: **`fir_carteira`
 * é súdito da RLS como qualquer um — sem `BYPASSRLS`.**
 */
const URL_MIG =
  process.env['DATABASE_URL_MIGRATE'] ?? 'postgresql://fir_migrate:fir_local_dev@127.0.0.1:4832/fir'

const URL_CARTEIRA =
  process.env['DATABASE_URL_CARTEIRA'] ?? 'postgresql://fir_carteira:fir_local_dev@127.0.0.1:4832/fir'

const TABELAS_DA_CARTEIRA = ['grupos', 'historico_grupo_da_clinica', 'usuarios_gestao'] as const

let migrate: pg.Client
let clinica: string
let operador: string
let grupoA: string
let grupoB: string

const codigo = `carteira-${Date.now()}`

async function conectarComo(papel: 'fir_carteira' | 'fir_app'): Promise<pg.Client> {
  const url =
    papel === 'fir_carteira'
      ? URL_CARTEIRA
      : (process.env['DATABASE_URL'] ?? 'postgresql://fir_app:fir_local_dev@127.0.0.1:4832/fir')
  const c = new pg.Client({ connectionString: url })
  c.on('error', (e) => console.error(`[carteira-no-banco] ${papel}:`, e.message))
  await c.connect()
  return c
}

beforeAll(async () => {
  migrate = new pg.Client({ connectionString: URL_MIG })
  migrate.on('error', (e) => console.error('[carteira-no-banco] migrate:', e.message))
  await migrate.connect()
  await declararAtorSistema(migrate)

  clinica = (
    await migrate.query<{ id: string }>(
      `INSERT INTO clinicas (codigo, nome) VALUES ($1, 'Clínica da carteira') RETURNING id`,
      [codigo],
    )
  ).rows[0]!.id

  operador = (
    await migrate.query<{ id: string }>(
      `INSERT INTO operadores (usuario, nome, senha_hash) VALUES ($1, 'Operador de teste', 'x')
       RETURNING id`,
      [`op.${Date.now()}`.slice(0, 32)],
    )
  ).rows[0]!.id

  grupoA = (
    await migrate.query<{ id: string }>(`INSERT INTO grupos (nome) VALUES ('Grupo A') RETURNING id`)
  ).rows[0]!.id
  grupoB = (
    await migrate.query<{ id: string }>(`INSERT INTO grupos (nome) VALUES ('Grupo B') RETURNING id`)
  ).rows[0]!.id
})

afterAll(async () => {
  await declararAtorSistema(migrate)
  await migrate.query('DELETE FROM usuarios_gestao WHERE grupo_id = ANY($1)', [[grupoA, grupoB]])
  await apagarHistoricoGrupoDeTeste(migrate, clinica)
  await migrate.query('DELETE FROM grupos WHERE id = ANY($1)', [[grupoA, grupoB]])
  await migrate.query('DELETE FROM operadores WHERE id = $1', [operador])
  await apagarClinicaDeTeste(migrate, clinica)
  await migrate.end()
})

describe('privilégio: a carteira é invisível para a aplicação', () => {
  it('fir_app não enxerga NADA da carteira — nem SELECT', async () => {
    for (const t of TABELAS_DA_CARTEIRA) {
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

describe('fir_carteira é um papel comum, sujeito à RLS', () => {
  it('fir_carteira NÃO atravessa a RLS — sem BYPASSRLS, sem SUPERUSER, sem CREATEROLE', async () => {
    const r = await migrate.query<{
      rolbypassrls: boolean
      rolsuper: boolean
      rolcreaterole: boolean
    }>(`SELECT rolbypassrls, rolsuper, rolcreaterole FROM pg_roles WHERE rolname = 'fir_carteira'`)
    expect(r.rows[0]).toEqual({ rolbypassrls: false, rolsuper: false, rolcreaterole: false })
  })

  it('fir_carteira LÊ grupos e usuarios_gestao (a escrita é só do painel — 0041, ver carteira-identidade-so-pelo-painel.test.ts)', async () => {
    const c = await conectarComo('fir_carteira')
    try {
      const r = await c.query<{ n: number }>('SELECT count(*)::int AS n FROM grupos')
      expect(r.rows[0]!.n).toBeGreaterThanOrEqual(2)
    } finally {
      await c.end()
    }
  })
})

describe('usuarios_gestao: o invariante de Escopo', () => {
  it('escopo=grupo SEM grupo_id é recusado', async () => {
    await expect(
      migrate.query(
        `INSERT INTO usuarios_gestao (usuario, nome, senha_hash, escopo)
         VALUES ('teste.sem.grupo', 'Teste', 'x', 'grupo')`,
      ),
    ).rejects.toThrow(/usuarios_gestao_escopo_grupo/)
  })

  it('escopo=geral COM grupo_id é recusado — nunca os dois', async () => {
    await expect(
      migrate.query(
        `INSERT INTO usuarios_gestao (usuario, nome, senha_hash, escopo, grupo_id)
         VALUES ('teste.geral.com.grupo', 'Teste', 'x', 'geral', $1)`,
        [grupoA],
      ),
    ).rejects.toThrow(/usuarios_gestao_escopo_grupo/)
  })

  it('escopo=grupo COM grupo_id é aceito', async () => {
    const r = await migrate.query<{ id: string }>(
      `INSERT INTO usuarios_gestao (usuario, nome, senha_hash, escopo, grupo_id)
       VALUES ('teste.valido', 'Teste Válido', 'x', 'grupo', $1) RETURNING id`,
      [grupoA],
    )
    expect(r.rows[0]!.id).toBeDefined()
  })

  it.each(['Ana', 'ana silva', 'ana..silva', 'ana.', '1ana', 'ab', 'a'.repeat(33), 'aná'])(
    'o banco RECUSA o usuário de gestão %s — mesma forma canônica de pessoas/operadores',
    async (u) => {
      await expect(
        migrate.query(
          `INSERT INTO usuarios_gestao (usuario, nome, senha_hash, escopo, grupo_id)
           VALUES ($1, 'X', 'h', 'grupo', $2)`,
          [u, grupoA],
        ),
      ).rejects.toThrow(/usuarios_gestao_usuario_canonico/)
    },
  )

  it('senha_provisoria true exige prazo, como em pessoas e operadores', async () => {
    await expect(
      migrate.query(
        `UPDATE usuarios_gestao SET senha_provisoria = true WHERE usuario = 'teste.valido'`,
      ),
    ).rejects.toThrow(/provisoria_tem_prazo/)
  })
})

describe('P-12: revogação é o estado `ativo`, checado a cada requisição', () => {
  it('desativar não apaga a linha — estado, nunca exclusão (regra 20)', async () => {
    await migrate.query(`UPDATE usuarios_gestao SET ativo = false WHERE usuario = 'teste.valido'`)
    const r = await migrate.query<{ ativo: boolean }>(
      `SELECT ativo FROM usuarios_gestao WHERE usuario = 'teste.valido'`,
    )
    expect(r.rows[0]!.ativo).toBe(false)
    // a linha continua existindo e legível — é o guard da API (fora deste
    // teste de banco) que recusa a requisição de um usuario_gestao inativo,
    // a cada chamada, nunca só no login.
  })
})

describe('historico_grupo_da_clinica é append-only', () => {
  it('REVOKE UPDATE/DELETE para fir_carteira, e a trigger alcança até o dono', async () => {
    const p = await migrate.query<{ upd: boolean; del: boolean }>(
      `SELECT has_table_privilege('fir_carteira', 'historico_grupo_da_clinica', 'UPDATE') AS upd,
              has_table_privilege('fir_carteira', 'historico_grupo_da_clinica', 'DELETE') AS del`,
    )
    expect(p.rows[0]).toEqual({ upd: false, del: false })

    await migrate.query(
      `INSERT INTO historico_grupo_da_clinica (clinica_id, grupo_novo_id, mudado_por, motivo)
       VALUES ($1, $2, $3, 'teste')`,
      [clinica, grupoA, operador],
    )
    await expect(
      migrate.query(`UPDATE historico_grupo_da_clinica SET motivo = 'x' WHERE clinica_id = $1`, [
        clinica,
      ]),
    ).rejects.toThrow(/append-only/i)
    await expect(
      migrate.query(`DELETE FROM historico_grupo_da_clinica WHERE clinica_id = $1`, [clinica]),
    ).rejects.toThrow(/append-only/i)
  })
})

describe('o ator "usuario_gestao" é emitido de verdade na trilha DA CLÍNICA', () => {
  const usuarioGestaoId = () =>
    migrate
      .query<{ id: string }>(`SELECT id FROM usuarios_gestao WHERE usuario = 'teste.valido'`)
      .then((r) => r.rows[0]!.id)

  it('grava ator_tipo=usuario_gestao na auditoria DAQUELA clínica', async () => {
    const perfil = await migrate.query<{ id: string }>(
      `INSERT INTO perfis (clinica_id, chave, nome, perms) VALUES ($1, 'pf_rec', 'Recepção', '{jornada}') RETURNING id`,
      [clinica],
    )
    const pessoa = await migrate.query<{ id: string }>(
      `INSERT INTO pessoas (clinica_id, nome, usuario, senha_hash, perfil_id)
       VALUES ($1, 'Juliana', 'juliana.carteira', 'x', $2) RETURNING id`,
      [clinica, perfil.rows[0]!.id],
    )
    const ug = await usuarioGestaoId()
    await migrate.query(`SELECT set_config('app.pessoa_id', 'usuario_gestao:' || $1, false)`, [ug])
    await migrate.query(`UPDATE pessoas SET funcao = 'x' WHERE id = $1`, [pessoa.rows[0]!.id])

    const trilha = await migrate.query<{ ator_tipo: string; ator_id: string }>(
      `SELECT ator_tipo, ator_id FROM auditoria
        WHERE clinica_id = $1 ORDER BY em DESC, id DESC LIMIT 1`,
      [clinica],
    )
    expect(trilha.rows[0]).toEqual({ ator_tipo: 'usuario_gestao', ator_id: ug })
    await declararAtorSistema(migrate)
  })

  it('auditoria aceita o quarto valor de ator_tipo', async () => {
    const r = await migrate.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM auditoria WHERE clinica_id = $1 AND ator_tipo = 'usuario_gestao'`,
      [clinica],
    )
    expect(r.rows[0]!.n).toBeGreaterThan(0)
  })
})

describe('app_grupo_id() e app_escopo()', () => {
  it('devolvem NULL sem sessão fixada', async () => {
    const r = await migrate.query<{ g: string | null; e: string | null }>(
      `SELECT app_grupo_id()::text AS g, app_escopo() AS e`,
    )
    expect(r.rows[0]).toEqual({ g: null, e: null })
  })

  it('devolvem o que a sessão fixar', async () => {
    await migrate.query(`SELECT set_config('app.grupo_id', $1, false)`, [grupoB])
    await migrate.query(`SELECT set_config('app.escopo', 'grupo', false)`)
    const r = await migrate.query<{ g: string; e: string }>(
      `SELECT app_grupo_id()::text AS g, app_escopo() AS e`,
    )
    expect(r.rows[0]).toEqual({ g: grupoB, e: 'grupo' })
  })
})

describe('app_pode_ver_grupo(alvo): o OR mora dentro da função, não na policy', () => {
  it('escopo=geral vê qualquer grupo, mesmo sem app.grupo_id fixado', async () => {
    await migrate.query(`SELECT set_config('app.escopo', 'geral', false)`)
    await migrate.query(`SELECT set_config('app.grupo_id', '', false)`)
    const r = await migrate.query<{ a: boolean; b: boolean }>(
      `SELECT app_pode_ver_grupo($1) AS a, app_pode_ver_grupo($2) AS b`,
      [grupoA, grupoB],
    )
    expect(r.rows[0]).toEqual({ a: true, b: true })
  })

  it('escopo=grupo vê só o próprio', async () => {
    await migrate.query(`SELECT set_config('app.escopo', 'grupo', false)`)
    await migrate.query(`SELECT set_config('app.grupo_id', $1, false)`, [grupoA])
    const r = await migrate.query<{ a: boolean; b: boolean }>(
      `SELECT app_pode_ver_grupo($1) AS a, app_pode_ver_grupo($2) AS b`,
      [grupoA, grupoB],
    )
    expect(r.rows[0]).toEqual({ a: true, b: false })
  })

  it('sem escopo nenhum fixado, não vê nada', async () => {
    await migrate.query(`SELECT set_config('app.escopo', '', false)`)
    await migrate.query(`SELECT set_config('app.grupo_id', '', false)`)
    const r = await migrate.query<{ a: boolean }>(`SELECT app_pode_ver_grupo($1) AS a`, [grupoA])
    expect(r.rows[0]!.a).toBe(false)
  })
})
