import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { UsuarioDeGestaoPublico } from '@fir/contracts'
import { BancoService } from '../../banco/banco.service'
import { apagarClinicaDeTeste, declararAtorSistema } from '../../banco/limpeza-de-teste'
import { IndicadoresCarteiraService } from './indicadores.service'
import { MetasComerciaisService } from './metas.service'

/**
 * **G3 — `MetasComerciaisService`, contra Postgres real.**
 *
 * O que importa aqui é o critério 2.1.4: progresso SEMPRE derivado do último
 * `Lançamento de indicador`, nunca um campo persistido. `ultimoLancamento` é
 * `null` sem nenhum lançamento (critério 2.1.5) e muda sozinho quando um novo
 * lançamento chega — sem nenhuma chamada a "atualizar a meta".
 */
const URL_MIG =
  process.env['DATABASE_URL_MIGRATE'] ?? 'postgresql://fir_migrate:fir_local_dev@127.0.0.1:4832/fir'

const codigo = `metas-${Date.now()}`

let migrate: pg.Client
let banco: BancoService
let indicadores: IndicadoresCarteiraService
let metas: MetasComerciaisService
let grupo: string
let clinica: string
let cliente: string
let usuario: UsuarioDeGestaoPublico

beforeAll(async () => {
  migrate = new pg.Client({ connectionString: URL_MIG })
  await migrate.connect()
  await declararAtorSistema(migrate)
  banco = new BancoService()
  indicadores = new IndicadoresCarteiraService(banco)
  metas = new MetasComerciaisService(banco)

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
      [`meta.${codigo}`, grupo],
    )
  ).rows[0]!.id
  usuario = { id: usuarioGestaoId, usuario: `meta.${codigo}`, nome: 'Teste', escopo: 'grupo', grupoId: grupo, senhaProvisoria: false }
})

afterAll(async () => {
  await declararAtorSistema(migrate)
  await migrate.query('DELETE FROM auditoria_da_carteira WHERE grupo_id = $1', [grupo])
  await migrate.query('DELETE FROM metas_comerciais WHERE grupo_id = $1', [grupo])
  await migrate.query('DELETE FROM lancamentos_de_indicador WHERE grupo_id = $1', [grupo])
  await migrate.query('DELETE FROM indicadores_carteira WHERE grupo_id = $1', [grupo])
  await migrate.query('DELETE FROM usuarios_gestao WHERE id = $1', [usuario.id])
  await migrate.query('DELETE FROM clientes_carteira WHERE id = $1', [cliente])
  await migrate.query('DELETE FROM grupos WHERE id = $1', [grupo])
  await apagarClinicaDeTeste(migrate, clinica)
  await migrate.end()
  await banco.onModuleDestroy()
})

describe('MetasComerciaisService — progresso SEMPRE derivado (critério 2.1.4)', () => {
  it('sem nenhum lançamento, ultimoLancamento é null (critério 2.1.5)', async () => {
    const indicador = await indicadores.criar(usuario, {
      clienteCarteiraId: cliente,
      nome: 'Faturamento semanal',
      unidade: 'R$',
      sentido: 'maior_melhor',
    })
    const meta = await metas.criar(usuario, {
      clienteCarteiraId: cliente,
      indicadorId: indicador.id,
      titulo: 'Crescer 20% em 3 meses',
      sentido: 'maior_melhor',
      valorMeta: 5000000n,
      inicio: '2026-11-01',
      prazo: '2027-01-31',
    })
    expect(meta.ultimoLancamento).toBeNull()

    const antes = await metas.listarPorCliente(usuario, cliente)
    expect(antes.find((m) => m.id === meta.id)!.ultimoLancamento).toBeNull()

    // Lança DIRETO no indicador (fora da API de meta — não existe "atualizar
    // a meta"), e relê a meta: o progresso muda SOZINHO.
    await indicadores.lancar(usuario, indicador.id, { referencia: '2026-11-10', valor: 3800000n })

    const depois = await metas.listarPorCliente(usuario, cliente)
    const metaDepois = depois.find((m) => m.id === meta.id)!
    expect(metaDepois.ultimoLancamento).not.toBeNull()
    expect(metaDepois.ultimoLancamento!.valor).toBe('3800000')
    expect(metaDepois.valorMeta).toBe('5000000') // a META em si não mudou

    // Um segundo lançamento, referência mais recente: o ÚLTIMO muda de novo,
    // sem nenhuma chamada que "atualize" a meta.
    await indicadores.lancar(usuario, indicador.id, { referencia: '2026-11-17', valor: 4200000n })
    const terceiraLeitura = await metas.listarPorCliente(usuario, cliente)
    expect(terceiraLeitura.find((m) => m.id === meta.id)!.ultimoLancamento!.valor).toBe('4200000')
  })
})
