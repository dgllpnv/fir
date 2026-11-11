import { randomBytes } from 'node:crypto'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { executarCarga, gerarCorrespondencia, type ClienteSql } from '../infra/migracao-supabase/banco'
import { lerDumpDeTexto, planejar, relatorioDoPlano } from '../infra/migracao-supabase/nucleo'

/**
 * Mapa de usuários (arquivo fora do repo) e correspondência de clientes (P-19)
 * contra clientes de um banco LOCAL, com dados sintéticos.
 */
const URL_MIG =
  process.env['DATABASE_URL_MIGRATE'] ?? 'postgresql://fir_migrate:fir_local_dev@127.0.0.1:4832/fir'

const p = randomBytes(4).toString('hex')
const csvDe = (docs: unknown[]): string =>
  `dump\r\n"${JSON.stringify({ registros: docs, historico: [], acessos_cliente: [], auth_users: [], storage_objects: [] }).replace(/"/g, '""')}"`
const reg = (colecao: string, id: string, data: Record<string, unknown>, cliente_id: string | null = null) => ({
  id, colecao, cliente_id, atualizado_em: '2026-11-01T00:00:00Z', atualizado_por: 'x', data,
})
const cnpjDe = (n: number): string => `8${p.replace(/[a-f]/g, '2')}${String(n).padStart(5, '0')}`.slice(0, 14)
const mascara = (c: string): string => c.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')

let migrate: pg.Client
let grupoId: string
let cargaId: string
let responsavelId: string

beforeAll(async () => {
  migrate = new pg.Client({ connectionString: URL_MIG })
  migrate.on('error', () => undefined)
  await migrate.connect()
  await migrate.query(`SELECT set_config('app.pessoa_id', 'sistema', false)`)
  grupoId = (await migrate.query('INSERT INTO grupos (nome) VALUES ($1) RETURNING id::text AS id', [`Grupo corresp ${p}`])).rows[0]!['id'] as string
  const u = async (usuario: string, nome: string): Promise<string> =>
    (await migrate.query(`INSERT INTO usuarios_gestao (usuario, nome, senha_hash, escopo, ativo) VALUES ($1, $2, '!', 'geral', false) RETURNING id::text AS id`, [usuario, nome])).rows[0]!['id'] as string
  cargaId = await u(`carga.${p}`, 'Carga do sistema anterior')
  responsavelId = await u(`resp.${p}`, 'Responsavel sintetica')
})

afterAll(async () => {
  if (!migrate) return
  for (const t of ['tarefas_internas', 'clientes_carteira']) await migrate.query(`DELETE FROM ${t} WHERE grupo_id = $1`, [grupoId]).catch(() => undefined)
  await migrate.query('DELETE FROM grupos WHERE id = $1', [grupoId]).catch(() => undefined)
  await migrate.query('DELETE FROM usuarios_gestao WHERE id = ANY($1::uuid[])', [[cargaId, responsavelId]]).catch(() => undefined)
  await migrate.end()
})

const base = { opcoesDry: { grupoId: '00000000-0000-0000-0000-000000000000', usuarioCargaId: '00000000-0000-0000-0000-000000000000', instanteDaCarga: '2026-11-10T00:00:00Z', decisoesCliente: {} } }

describe('mapa de usuários (arquivo fora do repo)', () => {
  const docs = [
    reg('clientes', `${p}-c1`, { nome: `Cliente mapa ${p}`, produto: 'Projeto', status: 'ativo', servicos: [] }),
    reg('tarefas', `${p}-t1`, { titulo: `T1 ${p}`, cliente_id: `${p}-c1`, prazo: '2026-11-13', status: 'pendente', prioridade: 'normal', recorrencia: 'nenhuma', responsavel_id: 'u1', solicitante_id: 'u2' }, `${p}-c1`),
    reg('tarefas', `${p}-t2`, { titulo: `T2 ${p}`, cliente_id: '', prazo: '2026-11-14', status: 'pendente', prioridade: 'normal', recorrencia: 'nenhuma', responsavel_id: 'u3', solicitante_id: 'u1' }),
  ]

  it('o dry-run mostra quantas referências ficam nulas (por usuário ordinal, sem ids)', () => {
    const d = lerDumpDeTexto(csvDe(docs))
    const sem = planejar(d, { ...base.opcoesDry, mapaUsuarios: {} })
    expect(sem.usuarios.reduce((a, x) => a + x.nulas, 0)).toBe(4)
    const com = planejar(d, { ...base.opcoesDry, mapaUsuarios: { u1: responsavelId } })
    expect(com.usuarios.reduce((a, x) => a + x.mapeadas, 0)).toBe(2)
    expect(com.usuarios.reduce((a, x) => a + x.nulas, 0)).toBe(2)
    const rel = relatorioDoPlano(com).join('\n')
    expect(rel).toContain('resolvidas pelo mapa 2, ficam nulas/usuario de carga 2')
    expect(rel).not.toContain('u1')
  })

  it('a carga grava o destino do mapa, deixa NULL o resto e não cria conta', async () => {
    const d = lerDumpDeTexto(csvDe(docs))
    const antes = (await migrate.query('SELECT count(*)::int AS n FROM usuarios_gestao')).rows[0]!['n']
    const r = await executarCarga(migrate, d, { grupoId, usuarioCargaId: cargaId, mapaUsuarios: { u1: responsavelId } })
    expect(r.commitado, JSON.stringify(r.conferencia.filter((c) => !c.ok))).toBe(true)
    const t = await migrate.query('SELECT responsavel_usuario_gestao_id::text AS r, solicitante_usuario_gestao_id::text AS s FROM tarefas_internas WHERE grupo_id = $1 ORDER BY titulo', [grupoId])
    expect(t.rows).toEqual([{ r: responsavelId, s: null }, { r: null, s: responsavelId }])
    expect((await migrate.query('SELECT count(*)::int AS n FROM usuarios_gestao')).rows[0]!['n']).toBe(antes)
  })

  it('destino que não existe, ou que não é uuid, recusa a carga inteira antes de gravar', async () => {
    const d = lerDumpDeTexto(csvDe(docs))
    await expect(executarCarga(migrate, d, { grupoId, usuarioCargaId: cargaId, mapaUsuarios: { u1: '11111111-1111-4111-8111-111111111111' } })).rejects.toThrow('mapa_usuarios_aponta_para_usuario_inexistente')
    await expect(executarCarga(migrate, d, { grupoId, usuarioCargaId: cargaId, mapaUsuarios: { u1: 'nao-e-uuid' } })).rejects.toThrow('mapa_usuarios_com_destino_que_nao_e_uuid')
  })
})

describe('correspondência de clientes (P-19) contra banco local, somente leitura', () => {
  it('propõe por CNPJ (com máscara) e por nome (acento, caixa, espaço duplo); marca ambíguo; não grava nada', async () => {
    const cnpjA = cnpjDe(1)
    const mk = async (nome: string, cnpj: string | null): Promise<string> =>
      (await migrate.query("INSERT INTO clientes_carteira (grupo_id, nome, produto, cnpj) VALUES ($1, $2, 'Projeto', $3) RETURNING id::text AS id", [grupoId, nome, cnpj])).rows[0]!['id'] as string
    const idCnpj = await mk(`Existente por cnpj ${p}`, cnpjA)
    const idNome = await mk(`Clínica Beta ${p}`, null)
    const homA = await mk(`Homonima ${p}`, null)
    await mk(`Homonima ${p}`, null)
    const d = lerDumpDeTexto(csvDe([
      reg('clientes', `${p}-o1`, { nome: 'Nome totalmente diferente', produto: 'Projeto', status: 'ativo', cnpj: mascara(cnpjA), servicos: [] }),
      reg('clientes', `${p}-o2`, { nome: `  CLINICA   beta ${p} `, produto: 'Projeto', status: 'ativo', cnpj: '', servicos: [] }),
      reg('clientes', `${p}-o3`, { nome: `Homonima  ${p}`, produto: 'Projeto', status: 'ativo', cnpj: '', servicos: [] }),
      reg('clientes', `${p}-o4`, { nome: `Sem candidato ${p}`, produto: 'Projeto', status: 'ativo', cnpj: '', servicos: [] }),
    ]))
    const antes = (await migrate.query("SELECT md5(string_agg(t::text, '|' ORDER BY id)) AS h, count(*)::int AS n FROM clientes_carteira t WHERE grupo_id = $1", [grupoId])).rows[0]!
    const emitidos: string[] = []
    const espiao: ClienteSql = {
      query: (texto, valores) => {
        emitidos.push(texto)
        return migrate.query(texto, valores as unknown[] | undefined) as unknown as ReturnType<ClienteSql['query']>
      },
    }
    const r = await gerarCorrespondencia(espiao, d)
    expect(r.clientes).toBe(4)
    const por = (o: string) => r.propostas.find((x) => x.origemId === `${p}-${o}`)
    expect(por('o1')).toMatchObject({ existenteId: idCnpj, por: 'cnpj', rotulo: 'cliente#1' })
    expect(por('o2')).toMatchObject({ existenteId: idNome, por: 'nome' })
    expect(por('o3')).toMatchObject({ por: 'nome', ambiguo: true })
    expect([homA, ...[]].length).toBe(1)
    expect(por('o4')).toBeUndefined()
    // somente leitura: transação READ ONLY, nenhum comando de escrita, banco intacto
    expect(emitidos[0]).toBe('BEGIN READ ONLY')
    expect(emitidos.filter((q) => /^\s*(INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP|CREATE)\b/i.test(q))).toEqual([])
    const depois = (await migrate.query("SELECT md5(string_agg(t::text, '|' ORDER BY id)) AS h, count(*)::int AS n FROM clientes_carteira t WHERE grupo_id = $1", [grupoId])).rows[0]!
    expect(depois).toEqual(antes)
  })

  it('uma escrita dentro do modo é recusada pelo próprio banco (READ ONLY)', async () => {
    await migrate.query('BEGIN READ ONLY')
    try {
      await expect(migrate.query("INSERT INTO clientes_carteira (grupo_id, nome, produto) VALUES ($1, 'x', 'Projeto')", [grupoId])).rejects.toThrow(/read-only transaction/)
    } finally {
      await migrate.query('ROLLBACK')
    }
  })
})
