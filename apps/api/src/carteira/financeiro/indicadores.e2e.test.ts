import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { UsuarioDeGestaoPublico } from '@fir/contracts'
import { BancoService } from '../../banco/banco.service'
import { apagarClinicaDeTeste, declararAtorSistema } from '../../banco/limpeza-de-teste'
import { IndicadorCarteiraNaoEncontrado, IndicadoresCarteiraService } from './indicadores.service'
import { EntradaInvalidaNaMeta, SemPermissaoDeValoresNaMeta } from './metas-comum'

/**
 * **G3 — `IndicadoresCarteiraService`, contra Postgres real.**
 *
 * Nível de SERVIÇO, não HTTP: `CarteiraFinanceiroModule` ainda não está
 * registrado em `AppModule` (fora da propriedade de arquivo deste ticket — a
 * fiação final é feita por quem integra as duas frentes, ver o relatório
 * final). O que este arquivo prova é exatamente o que a camada HTTP vai
 * expor sem reinterpretar: a trigger de coerência de unidade (banco REAL, não
 * mock) e o upsert com auditoria dupla (critério 2.1.3).
 */
const URL_MIG =
  process.env['DATABASE_URL_MIGRATE'] ?? 'postgresql://fir_migrate:fir_local_dev@127.0.0.1:4832/fir'

const codigo = `indicadores-${Date.now()}`

let migrate: pg.Client
let banco: BancoService
let servico: IndicadoresCarteiraService
let grupo: string
let clinica: string
let cliente: string
let usuario: UsuarioDeGestaoPublico

beforeAll(async () => {
  migrate = new pg.Client({ connectionString: URL_MIG })
  await migrate.connect()
  await declararAtorSistema(migrate)
  banco = new BancoService()
  servico = new IndicadoresCarteiraService(banco)

  grupo = (await migrate.query<{ id: string }>(`INSERT INTO grupos (nome) VALUES ($1) RETURNING id`, [
    `Grupo ${codigo}`,
  ])).rows[0]!.id
  clinica = (
    await migrate.query<{ id: string }>(`INSERT INTO clinicas (codigo, nome) VALUES ($1, $2) RETURNING id`, [
      codigo,
      'Clínica de teste',
    ])
  ).rows[0]!.id
  cliente = (
    await migrate.query<{ id: string }>(
      `INSERT INTO clientes_carteira (grupo_id, clinica_id, nome, produto) VALUES ($1, $2, 'Cliente', 'Consultoria') RETURNING id`,
      [grupo, clinica],
    )
  ).rows[0]!.id
  const usuarioGestaoId = (
    await migrate.query<{ id: string }>(
      `INSERT INTO usuarios_gestao (usuario, nome, senha_hash, escopo, grupo_id) VALUES ($1, 'Teste', 'x', 'grupo', $2) RETURNING id`,
      [`ind.${codigo}`, grupo],
    )
  ).rows[0]!.id
  usuario = { id: usuarioGestaoId, usuario: `ind.${codigo}`, nome: 'Teste', escopo: 'grupo', grupoId: grupo, senhaProvisoria: false, valores: false, carteira: 'todos', modulos: [], administrar: false, setor: null, funcao: null, telefone: null }
})

afterAll(async () => {
  await declararAtorSistema(migrate)
  await migrate.query('DELETE FROM auditoria_da_carteira WHERE grupo_id = $1', [grupo])
  await migrate.query('DELETE FROM lancamentos_de_indicador WHERE grupo_id = $1', [grupo])
  await migrate.query('DELETE FROM indicadores_carteira WHERE grupo_id = $1', [grupo])
  await migrate.query('DELETE FROM usuarios_gestao WHERE id = $1', [usuario.id])
  await migrate.query('DELETE FROM clientes_carteira WHERE id = $1', [cliente])
  await migrate.query('DELETE FROM grupos WHERE id = $1', [grupo])
  await apagarClinicaDeTeste(migrate, clinica)
  await migrate.end()
  await banco.onModuleDestroy()
})

describe('IndicadoresCarteiraService.criar', () => {
  it('cria um indicador unidade=R$', async () => {
    const r = await servico.criar(usuario, { clienteCarteiraId: cliente, nome: 'Faturamento', unidade: 'R$', sentido: 'maior_melhor' })
    expect(r.unidade).toBe('R$')
    expect(r.clienteCarteiraId).toBe(cliente)
  })
})

describe('IndicadoresCarteiraService.lancar — critério 2.1.2 (CHECK de coerência pelo BANCO)', () => {
  it('unidade=R$ com valor_inteiro preenchido FALHA NO BANCO (trigger da migration 0031)', async () => {
    const indicador = await servico.criar(usuario, {
      clienteCarteiraId: cliente,
      nome: 'Faturamento 2',
      unidade: 'R$',
      sentido: 'maior_melhor',
    })
    // O contrato Zod já recusaria "os dois ou nenhum" — este teste contorna o
    // contrato para provar que o BANCO, e não só a aplicação, recusa.
    await expect(
      banco.nasTabelasDaCarteiraComEscopo(usuario.escopo, usuario.grupoId, (c) =>
        c.query(
          `INSERT INTO lancamentos_de_indicador (indicador_id, grupo_id, referencia, valor_inteiro, lancado_por)
           VALUES ($1, $2, '2026-11-01', 100, $3)`,
          [indicador.id, grupo, usuario.id],
        ),
      ),
    ).rejects.toThrow()
  })

  it('indicador inexistente lança IndicadorCarteiraNaoEncontrado', async () => {
    await expect(
      servico.lancar(usuario, '00000000-0000-0000-0000-000000000000', { referencia: '2026-11-02', valorInteiro: 100n }),
    ).rejects.toThrow(IndicadorCarteiraNaoEncontrado)
  })
})

describe('IndicadoresCarteiraService.lancar — upsert idempotente com DUAS entradas de auditoria (critério 2.1.3)', () => {
  it('lançar a MESMA referência duas vezes com valores diferentes atualiza a MESMA linha e audita as duas', async () => {
    const indicador = await servico.criar(usuario, {
      clienteCarteiraId: cliente,
      nome: 'Pacientes novos na semana',
      unidade: 'un',
      sentido: 'maior_melhor',
    })

    const primeiro = await servico.lancar(usuario, indicador.id, { referencia: '2026-11-09', valorInteiro: 38n })
    const segundo = await servico.lancar(usuario, indicador.id, { referencia: '2026-11-09', valorInteiro: 36n })

    expect(primeiro.id).toBe(segundo.id) // MESMA linha
    expect(segundo.valorInteiro).toBe('36')

    const linhas = await migrate.query(
      `SELECT * FROM lancamentos_de_indicador WHERE indicador_id = $1 AND referencia = '2026-11-09'`,
      [indicador.id],
    )
    expect(linhas.rows.length).toBe(1) // nunca duplica a linha

    const auditoria = await migrate.query(
      `SELECT acao FROM auditoria_da_carteira WHERE tabela = 'lancamentos_de_indicador' AND registro_id = $1 ORDER BY em`,
      [primeiro.id],
    )
    expect(auditoria.rows.map((r: { acao: string }) => r.acao)).toEqual(['criar', 'atualizar'])
  })
})

describe('IndicadoresCarteiraService.lancar — G8 2B: segunda-feira (CE-4) e A-6', () => {
  it('referência fora da segunda é recusada na entrada; R$ sem a permissão valores também', async () => {
    const un = await servico.criar(usuario, { clienteCarteiraId: cliente, nome: 'Contagem', unidade: 'un', sentido: 'maior_melhor' })
    await expect(servico.lancar(usuario, un.id, { referencia: '2026-11-10', valorInteiro: 1n })).rejects.toThrow(EntradaInvalidaNaMeta)
    const rs = await servico.criar(usuario, { clienteCarteiraId: cliente, nome: 'Receita', unidade: 'R$', sentido: 'maior_melhor' })
    await expect(servico.lancar(usuario, rs.id, { referencia: '2026-11-09', valor: 100n })).rejects.toThrow(SemPermissaoDeValoresNaMeta)
    const n = await migrate.query('SELECT 1 FROM lancamentos_de_indicador WHERE indicador_id = ANY($1)', [[un.id, rs.id]])
    expect(n.rowCount).toBe(0)
  })
})
