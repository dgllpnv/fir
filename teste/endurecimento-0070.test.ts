import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  apagarClinicaDeTeste,
  apagarOperadorDeTeste,
  declararAtorSistema,
} from '@fir/api/banco/limpeza-de-teste'

/**
 * Migration 0070: endurecimento da 0068 (achados do appsec). Postgres real.
 */
const URL_MIG =
  process.env['DATABASE_URL_MIGRATE'] ?? 'postgresql://fir_migrate:fir_local_dev@127.0.0.1:4832/fir'
const URL_CARTEIRA =
  process.env['DATABASE_URL_CARTEIRA'] ?? 'postgresql://fir_carteira:fir_local_dev@127.0.0.1:4832/fir'

const sufixo = `${Date.now()}`
let m: pg.Client
let operador: string
let grupoPadrao: string
let grupoArquivo: string
let grupoX: string
const clinicas: string[] = []
const portais: string[] = []

const ator = (a: string) => m.query(`SELECT set_config('app.pessoa_id', $1, false)`, [a])
const comoOperador = () => ator(`operador:${operador}`)

async function novaClinica(ativa = true): Promise<string> {
  const id = (
    await m.query<{ id: string }>(`INSERT INTO clinicas (codigo, nome, ativa) VALUES ($1, 'Clínica 0070', $2) RETURNING id`, [
      `e70-${sufixo}-${clinicas.length}`,
      ativa,
    ])
  ).rows[0]!.id
  clinicas.push(id)
  return id
}
async function clinicaNoFirmare(): Promise<string> {
  await comoOperador()
  const id = await novaClinica()
  await declararAtorSistema(m)
  return id
}
const clienteDe = async (clinica: string, grupo: string) =>
  (await m.query<{ id: string; status: string; conta: boolean }>(
    `SELECT id, status, conta_na_receita AS conta FROM clientes_carteira WHERE clinica_id = $1 AND grupo_id = $2`,
    [clinica, grupo],
  )).rows[0]!

beforeAll(async () => {
  m = new pg.Client({ connectionString: URL_MIG })
  m.on('error', (e) => console.error('[endurecimento-0070]', e.message))
  await m.connect()
  await declararAtorSistema(m)
  operador = (
    await m.query<{ id: string }>(
      `INSERT INTO operadores (usuario, nome, senha_hash) VALUES ($1, 'Dono 0070', 'x') RETURNING id`,
      [`e70.op.${sufixo}`],
    )
  ).rows[0]!.id
  grupoPadrao = (await m.query<{ id: string }>(`SELECT id FROM grupos WHERE padrao`)).rows[0]!.id
  grupoArquivo = (await m.query<{ id: string }>(`SELECT id FROM grupos WHERE arquivo`)).rows[0]!.id
  grupoX = (await m.query<{ id: string }>(`INSERT INTO grupos (nome) VALUES ('Grupo X 0070') RETURNING id`)).rows[0]!.id
})

afterAll(async () => {
  await declararAtorSistema(m)
  for (const p of portais) await m.query('DELETE FROM usuarios_do_portal WHERE id = $1', [p])
  for (const id of clinicas) await apagarClinicaDeTeste(m, id)
  await m.query('DELETE FROM grupos WHERE id = $1', [grupoX])
  await apagarOperadorDeTeste(m, operador)
  await m.end()
})

describe('3. conta_na_receita: só o Operador da sessão', () => {
  it.each([
    ['sistema', 'sistema'],
    ['sem ator', ''],
    ['usuário de gestão', 'usuario_gestao:00000000-0000-0000-0000-000000000001'],
    ['usuário do portal', 'usuario_portal:00000000-0000-0000-0000-000000000001'],
    ['operador inexistente', 'operador:00000000-0000-0000-0000-0000000000ff'],
  ])('UPDATE por %s falha com 42501', async (_n, a) => {
    const id = await clinicaNoFirmare()
    await ator(a)
    await expect(
      m.query(`UPDATE clientes_carteira SET conta_na_receita = false WHERE clinica_id = $1`, [id]),
    ).rejects.toMatchObject({ code: '42501' })
    await declararAtorSistema(m)
    expect((await clienteDe(id, grupoPadrao)).conta).toBe(true)
  })

  it('o Operador troca; outros campos continuam livres para o sistema', async () => {
    const id = await clinicaNoFirmare()
    await declararAtorSistema(m)
    await m.query(`UPDATE clientes_carteira SET mensalidade_centavos = 100 WHERE clinica_id = $1`, [id])
    await comoOperador()
    await m.query(`UPDATE clientes_carteira SET conta_na_receita = false WHERE clinica_id = $1`, [id])
    expect((await clienteDe(id, grupoPadrao)).conta).toBe(false)
    await declararAtorSistema(m)
  })

  it('INSERT ligado a clínica por ator vazio, gestão ou portal falha; o fluxo do Operador funciona', async () => {
    const id = await clinicaNoFirmare()
    await m.query('SELECT 1')
    for (const a of ['', 'usuario_gestao:00000000-0000-0000-0000-000000000001', 'usuario_portal:00000000-0000-0000-0000-000000000001']) {
      await ator(a)
      await expect(
        m.query(`INSERT INTO clientes_carteira (grupo_id, clinica_id, nome, produto, conta_na_receita) VALUES ($1, $2, 'x', 'x', false)`, [grupoX, id]),
      ).rejects.toMatchObject({ code: '42501' })
    }
    await declararAtorSistema(m)
  })

  it('adicionar_clinica_ao_grupo (fir_carteira, Operador) segue funcionando', async () => {
    const id = await clinicaNoFirmare()
    const c = new pg.Client({ connectionString: URL_CARTEIRA })
    await c.connect()
    try {
      await c.query(`SELECT set_config('app.pessoa_id', $1, false), set_config('app.escopo', 'geral', false)`, [`operador:${operador}`])
      await c.query('SELECT adicionar_clinica_ao_grupo($1, $2, $3)', [id, grupoX, 'teste 0070'])
    } finally {
      await c.end()
    }
    expect((await clienteDe(id, grupoX)).conta).toBe(false)
  })
})

describe('4. usuário do portal fora do grupo padrão e do arquivo', () => {
  const novo = async (escopo: 'grupo' | 'cliente', alvo: string) => {
    const col = escopo === 'grupo' ? 'grupo_id' : 'cliente_carteira_id'
    const r = await m.query<{ id: string }>(
      `INSERT INTO usuarios_do_portal (usuario, nome, senha_hash, escopo, ${col}) VALUES ($1, 'P', 'x', $2, $3) RETURNING id`,
      [`e70.p.${sufixo}.${portais.length}.${Math.floor(Math.random() * 1e6)}`, escopo, alvo],
    )
    portais.push(r.rows[0]!.id)
    return r.rows[0]!.id
  }

  it.each([['padrão'], ['arquivo']])('escopo grupo no grupo %s falha', async (qual) => {
    await expect(novo('grupo', qual === 'padrão' ? grupoPadrao : grupoArquivo)).rejects.toMatchObject({
      constraint: 'usuario_do_portal_do_grupo_padrao',
    })
  })

  it('escopo grupo num grupo comum passa; UPDATE posterior (senha) não é barrado', async () => {
    const id = await novo('grupo', grupoX)
    await m.query(`UPDATE usuarios_do_portal SET senha_hash = 'y' WHERE id = $1`, [id])
    await expect(m.query(`UPDATE usuarios_do_portal SET grupo_id = $2 WHERE id = $1`, [id, grupoPadrao])).rejects.toThrow()
  })

  it('escopo cliente apontando para cliente do grupo de arquivo falha', async () => {
    const id = await clinicaNoFirmare()
    const c = await clienteDe(id, grupoPadrao)
    await comoOperador()
    await m.query(`UPDATE clientes_carteira SET grupo_id = $2, excluido_em = now() WHERE id = $1`, [c.id, grupoArquivo])
    await declararAtorSistema(m)
    await expect(novo('cliente', c.id)).rejects.toMatchObject({ constraint: 'usuario_do_portal_do_grupo_padrao' })
  })
})

describe('5. SECURITY DEFINER com search_path fixo', () => {
  it('toda função definer da 0068/0070 tem pg_catalog, public, pg_temp', async () => {
    const r = await m.query<{ proname: string; cfg: string[] | null }>(
      `SELECT proname, proconfig AS cfg FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND prosecdef AND proname = ANY($1)`,
      [[
        'operador_da_sessao', 'adicionar_clinica_ao_grupo', 'encerrar_participacao_da_clinica',
        'grupos_que_recebem_a_clinica', 'clinica_nova_entra_no_grupo_padrao', 'preencher_grupo_firmare',
        'participacao_regras', 'clientes_carteira_confere_vinculos', 'grupos_padrao_fixo',
        'usuario_de_gestao_nao_e_do_grupo_padrao', 'usuario_do_portal_nao_e_do_grupo_padrao',
      ]],
    )
    expect(r.rows).toHaveLength(11)
    for (const f of r.rows) expect(f.cfg, f.proname).toContain('search_path=pg_catalog, public, pg_temp')
  })
})

describe('6. operador inativo não é operador da sessão', () => {
  it('operador_da_sessao devolve NULL quando ativo = false', async () => {
    const op = (
      await m.query<{ id: string }>(
        `INSERT INTO operadores (usuario, nome, senha_hash) VALUES ($1, 'Inativo 0070', 'x') RETURNING id`,
        [`e70.in.${sufixo}`],
      )
    ).rows[0]!.id
    try {
      await ator(`operador:${op}`)
      expect((await m.query('SELECT operador_da_sessao() AS o')).rows[0].o).toBe(op)
      await declararAtorSistema(m)
      await m.query(`UPDATE operadores SET ativo = false WHERE id = $1`, [op])
      await ator(`operador:${op}`)
      expect((await m.query('SELECT operador_da_sessao() AS o')).rows[0].o).toBeNull()
    } finally {
      await declararAtorSistema(m)
      await apagarOperadorDeTeste(m, op)
    }
  })
})

describe('8. cliente arquivado não volta', () => {
  it('do grupo de arquivo, não reativa; sem participação ativa, também não', async () => {
    const id = await clinicaNoFirmare()
    const c = await clienteDe(id, grupoPadrao)
    await comoOperador()
    await m.query(`UPDATE clientes_carteira SET grupo_id = $2, excluido_em = now() WHERE id = $1`, [c.id, grupoArquivo])
    await expect(m.query(`UPDATE clientes_carteira SET excluido_em = NULL WHERE id = $1`, [c.id])).rejects.toMatchObject({
      constraint: 'clientes_carteira_arquivo_nao_reativa',
    })

    // grupo comum: soft delete com participação ativa reativa; sem ela, não.
    await m.query('SELECT adicionar_clinica_ao_grupo($1, $2, $3)', [id, grupoX, 'teste 0070'])
    const x = await clienteDe(id, grupoX)
    await m.query(`UPDATE clientes_carteira SET excluido_em = now() WHERE id = $1`, [x.id])
    await m.query(`UPDATE clientes_carteira SET excluido_em = NULL WHERE id = $1`, [x.id])
    await m.query(`UPDATE clientes_carteira SET excluido_em = now() WHERE id = $1`, [x.id])
    await m.query('SELECT encerrar_participacao_da_clinica($1, $2, $3)', [id, grupoX, 'teste 0070'])
    await expect(m.query(`UPDATE clientes_carteira SET excluido_em = NULL WHERE id = $1`, [x.id])).rejects.toMatchObject({
      constraint: 'clientes_carteira_grupo_da_clinica',
    })
    await declararAtorSistema(m)
  })
})

describe('9. clínica inativa nasce com cliente pausado', () => {
  it('gatilho da clínica nova: ativo=false gera status pausado; ativo=true segue ativo', async () => {
    await comoOperador()
    const inativa = await novaClinica(false)
    const ativa = await novaClinica(true)
    await declararAtorSistema(m)
    expect((await clienteDe(inativa, grupoPadrao)).status).toBe('pausado')
    expect((await clienteDe(ativa, grupoPadrao)).status).toBe('onboarding')
  })

  it('preencher_grupo_firmare respeita o mesmo critério', async () => {
    const inativa = await novaClinica(false)
    const r = await m.query(`SELECT * FROM preencher_grupo_firmare($1, ARRAY[$2]::uuid[])`, [operador, inativa])
    expect(r.rows[0]).toMatchObject({ clinicas: 1, participacoes: 1, clientes: 1 })
    expect((await clienteDe(inativa, grupoPadrao)).status).toBe('pausado')
    await declararAtorSistema(m)
  })
})
