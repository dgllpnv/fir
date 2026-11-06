import type { UsuarioDeGestaoPublico } from '@fir/contracts'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { BancoService } from '../banco/banco.service'
import { apagarClinicaDeTeste, declararAtorSistema } from '../banco/limpeza-de-teste'
import { ClienteCarteiraNaoEncontradoParaLinks, LinksDeAcessoClienteService } from './links-de-acesso-cliente.service'

/**
 * **OS 4 LINKS DE ACESSO, contra Postgres real** (migration 0036).
 *
 * Mesmo molde de `beneficios.e2e.test.ts`: `Cliente Firmare` SEM `status`
 * (fica `onboarding`, o default) — este arquivo nunca chama
 * `executarGeracaoDeCobrancas`, então um cliente `ativo` aqui seria varrido
 * pelo job de OUTRO arquivo rodando em paralelo (Vitest roda arquivos de
 * `apps/api` em paralelo por padrão).
 */
const URL_MIG =
  process.env['DATABASE_URL_MIGRATE'] ?? 'postgresql://fir_migrate:fir_local_dev@127.0.0.1:4832/fir'

const codigo = `links-acesso-${Date.now()}`

let migrate: pg.Client
let banco: BancoService
let servico: LinksDeAcessoClienteService
let grupo: string
let clinica: string
let cliente: string
let usuario: UsuarioDeGestaoPublico

beforeAll(async () => {
  migrate = new pg.Client({ connectionString: URL_MIG })
  await migrate.connect()
  await declararAtorSistema(migrate)
  banco = new BancoService()
  servico = new LinksDeAcessoClienteService(banco)

  grupo = (
    await migrate.query<{ id: string }>(`INSERT INTO grupos (nome) VALUES ($1) RETURNING id`, [
      `Grupo ${codigo}`,
    ])
  ).rows[0]!.id
  clinica = (
    await migrate.query<{ id: string }>(`INSERT INTO clinicas (codigo, nome) VALUES ($1, $2) RETURNING id`, [
      codigo,
      'Clínica de teste',
    ])
  ).rows[0]!.id
  cliente = (
    await migrate.query<{ id: string }>(
      `INSERT INTO clientes_carteira (grupo_id, clinica_id, nome, produto)
       VALUES ($1, $2, 'Cliente', 'Consultoria') RETURNING id`,
      [grupo, clinica],
    )
  ).rows[0]!.id
  const usuarioGestaoId = (
    await migrate.query<{ id: string }>(
      `INSERT INTO usuarios_gestao (usuario, nome, senha_hash, escopo, grupo_id) VALUES ($1, 'Teste', 'x', 'grupo', $2) RETURNING id`,
      [`links.${codigo}`, grupo],
    )
  ).rows[0]!.id
  usuario = {
    id: usuarioGestaoId,
    usuario: `links.${codigo}`,
    nome: 'Teste',
    escopo: 'grupo',
    grupoId: grupo,
    senhaProvisoria: false,
  }
})

afterAll(async () => {
  await declararAtorSistema(migrate)
  await migrate.query('DELETE FROM auditoria_da_carteira WHERE grupo_id = $1', [grupo])
  await migrate.query('DELETE FROM usuarios_gestao WHERE id = $1', [usuario.id])
  await migrate.query('DELETE FROM clientes_carteira WHERE id = $1', [cliente])
  await migrate.query('DELETE FROM grupos WHERE id = $1', [grupo])
  await apagarClinicaDeTeste(migrate, clinica)
  await migrate.end()
  await banco.onModuleDestroy()
})

describe('LinksDeAcessoClienteService.atualizar', () => {
  it('grava os 4 links e a trilha (acao=atualizar) em auditoria_da_carteira', async () => {
    const atualizado = await servico.atualizar(usuario, cliente, {
      linkPainel: 'https://painel.exemplo.com/clinica',
      linkDashInd: 'https://indicadores.exemplo.com',
      linkDashFin: 'https://financeiro.exemplo.com',
      linkRotina: 'https://rotina.exemplo.com',
    })

    expect(atualizado.id).toBe(cliente)
    expect(atualizado.linkPainel).toBe('https://painel.exemplo.com/clinica')
    expect(atualizado.linkDashInd).toBe('https://indicadores.exemplo.com')
    expect(atualizado.linkDashFin).toBe('https://financeiro.exemplo.com')
    expect(atualizado.linkRotina).toBe('https://rotina.exemplo.com')

    const auditoria = await migrate.query<{ usuario_gestao_id: string; acao: string; de: unknown; para: unknown }>(
      `SELECT usuario_gestao_id, acao, de, para FROM auditoria_da_carteira
        WHERE tabela = 'clientes_carteira' AND registro_id = $1`,
      [cliente],
    )
    expect(auditoria.rows).toHaveLength(1)
    expect(auditoria.rows[0]!.usuario_gestao_id).toBe(usuario.id)
    expect(auditoria.rows[0]!.acao).toBe('atualizar')
    expect(auditoria.rows[0]!.de).toEqual({
      link_painel: null,
      link_dash_ind: null,
      link_dash_fin: null,
      link_rotina: null,
    })
    expect(auditoria.rows[0]!.para).toEqual({
      link_painel: 'https://painel.exemplo.com/clinica',
      link_dash_ind: 'https://indicadores.exemplo.com',
      link_dash_fin: 'https://financeiro.exemplo.com',
      link_rotina: 'https://rotina.exemplo.com',
    })
  })

  it('limpar um link já cadastrado manda null, nunca string vazia', async () => {
    const limpo = await servico.atualizar(usuario, cliente, {
      linkPainel: null,
      linkDashInd: null,
      linkDashFin: null,
      linkRotina: null,
    })
    expect(limpo.linkPainel).toBeNull()
    expect(limpo.linkDashInd).toBeNull()
    expect(limpo.linkDashFin).toBeNull()
    expect(limpo.linkRotina).toBeNull()
  })

  it('cliente inexistente lança ClienteCarteiraNaoEncontradoParaLinks', async () => {
    await expect(
      servico.atualizar(usuario, '00000000-0000-0000-0000-000000000000', {
        linkPainel: null,
        linkDashInd: null,
        linkDashFin: null,
        linkRotina: null,
      }),
    ).rejects.toThrow(ClienteCarteiraNaoEncontradoParaLinks)
  })
})
