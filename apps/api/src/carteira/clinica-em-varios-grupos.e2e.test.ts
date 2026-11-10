import type {
  ComparativoDeCampanhasSaida,
  PainelDeMensalidadesSaida,
  ResumoSemanalSaida,
  UsoNaVisaoGeralSaida,
  VisaoGeralDaCarteiraSaida,
} from '@fir/contracts'
import { Dinheiro, RelogioFixo } from '@fir/domain'
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify'
import { Test } from '@nestjs/testing'
import { randomBytes } from 'node:crypto'
import pg from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AppModule } from '../app.module'
import { hashDeSenha } from '../autenticacao/senha'
import { BancoService } from '../banco/banco.service'
import {
  apagarClinicaDeTeste,
  apagarHistoricoGrupoDeTeste,
  declararAtorSistema,
  participarDoGrupoDeTeste,
} from '../banco/limpeza-de-teste'
import { RELOGIO } from '../comum/relogio'
import { registrarCookie } from '../main'
import { executarSincronizacaoDeCampanhas } from './campanhas/sincronizar-campanhas'
import { executarGeracaoDeCobrancas } from './financeiro/gerar-cobrancas'
import { executarUsoDiarioCliente } from './jobs/uso-diario-cliente'

/**
 * **Clínica em vários grupos (0068), no escopo `geral`, contra Postgres real.**
 * Seam: HTTP da API + jobs sobre Postgres real.
 *
 * Decisão do dono: só o cliente com `conta_na_receita` entra em MRR, cobrança,
 * metas e resumo; toda CONTAGEM do `geral` é por clínica, nunca por linha.
 *
 * O universo exato vem de "só a minha carteira": o usuário `minha` (escopo
 * geral) só enxerga clientes em que ele é o responsável, então MRR e contagens
 * são exatas sem a interferência de outros arquivos rodando em paralelo.
 */
const URL_MIG =
  process.env['DATABASE_URL_MIGRATE'] ?? 'postgresql://fir_migrate:fir_local_dev@127.0.0.1:4832/fir'
const SENHA = 'quatro-pedras-no-caminho'
const sufixo = randomBytes(4).toString('hex')
const AGORA = new Date('2026-11-11T15:00:00Z')
const COMPETENCIA = '2026-11-01'

let app: NestFastifyApplication
let migrate: pg.Client
let banco: BancoService
let operador = ''
const grupos: string[] = []
const clinicas: string[] = []
const clientes: string[] = []
const usuarios: string[] = []
const ids = { g1: '', g2: '', g3: '', minha: '', minha3: '', geral: '', pagador: '', outro: '', clinicaC: '' }
const cookie = { minha: '', minha3: '', geral: '' }
const NOME_C = `Clinica C ${sufixo}`

const http = () => request(app.getHttpServer())
const um = async (sql: string, p: unknown[]): Promise<string> => (await migrate.query<{ id: string }>(sql, p)).rows[0]!.id
const entrar = async (usuario: string): Promise<string> => {
  const r = await http().post('/v1/carteira/entrar').send({ usuario, senha: SENHA }).expect(200)
  const v = r.headers['set-cookie'] as unknown
  return (Array.isArray(v) ? (v as string[]) : [String(v)]).map((c) => c.split(';')[0]!).join('; ')
}
const get = async <T>(url: string, c: string): Promise<T> => (await http().get(url).set('cookie', c).expect(200)).body as T

const novoGrupo = async (nome: string) => {
  const id = await um('INSERT INTO grupos (nome) VALUES ($1) RETURNING id', [`${nome} ${sufixo}`])
  grupos.push(id)
  return id
}
const novaClinica = async (nome: string) => {
  const id = await um('INSERT INTO clinicas (codigo, nome) VALUES ($1, $2) RETURNING id', [`vg-${sufixo}-${clinicas.length}`, nome])
  clinicas.push(id)
  return id
}
const novoUsuario = async (nome: string, carteira: string) => {
  const id = await um(
    `INSERT INTO usuarios_gestao (usuario, nome, senha_hash, escopo, grupo_id, valores, carteira, administrar)
     VALUES ($1, $2, $3, 'geral', NULL, true, $4, false) RETURNING id`,
    [`${nome}.${sufixo}`, `${nome} ${sufixo}`, await hashDeSenha(SENHA), carteira],
  )
  usuarios.push(id)
  return id
}
const novoCliente = async (
  grupo: string,
  clinica: string,
  nome: string,
  mensalidade: bigint,
  contaNaReceita: boolean,
  responsavel: string,
) => {
  await participarDoGrupoDeTeste(migrate, clinica, grupo)
  const id = await um(
    `INSERT INTO clientes_carteira (grupo_id, clinica_id, nome, produto, status, mensalidade_centavos, dia_vencimento,
                                    conta_na_receita, responsavel_usuario_gestao_id)
     VALUES ($1, $2, $3, 'FIR Clinic', 'ativo', $4, 10, $5, $6) RETURNING id`,
    [grupo, clinica, nome, mensalidade.toString(), contaNaReceita, responsavel],
  )
  clientes.push(id)
  return id
}
const comoOperador = async (fn: () => Promise<void>) => {
  await migrate.query('BEGIN')
  try {
    await migrate.query(`SELECT set_config('app.pessoa_id', $1, true)`, [`operador:${operador}`])
    await fn()
    await migrate.query('COMMIT')
  } catch (e) {
    await migrate.query('ROLLBACK')
    throw e
  }
}

beforeAll(async () => {
  migrate = new pg.Client({ connectionString: URL_MIG })
  await migrate.connect()
  // Os jobs varrem todo cliente ativo do banco: mesma trava dos outros arquivos de job (D16).
  await migrate.query("SELECT pg_advisory_lock(hashtext('teste:jobs-da-carteira'))")
  await declararAtorSistema(migrate)
  banco = new BancoService()

  ids.g1 = await novoGrupo('Varios A')
  ids.g2 = await novoGrupo('Varios B')
  ids.g3 = await novoGrupo('Varios C')
  ids.minha = await novoUsuario('minha', 'minha')
  ids.minha3 = await novoUsuario('minha3', 'minha')
  ids.geral = await novoUsuario('geral', 'todos')

  // A clínica C em 2 grupos: o pagador (R$ 1.000,00) e o outro (R$ 0).
  ids.clinicaC = await novaClinica(NOME_C)
  ids.pagador = await novoCliente(ids.g1, ids.clinicaC, NOME_C, 100_000n, true, ids.minha)
  ids.outro = await novoCliente(ids.g2, ids.clinicaC, NOME_C, 0n, false, ids.minha)
  operador = (await migrate.query<{ id: string }>(`SELECT id FROM operadores WHERE usuario = 'participacao-de-teste'`)).rows[0]!.id

  const mod = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(RELOGIO)
    .useValue(new RelogioFixo(AGORA))
    .compile()
  app = mod.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
  await registrarCookie(app)
  await app.init()
  await app.getHttpAdapter().getInstance().ready()
  cookie.minha = await entrar(`minha.${sufixo}`)
  cookie.minha3 = await entrar(`minha3.${sufixo}`)
  cookie.geral = await entrar(`geral.${sufixo}`)
})

afterAll(async () => {
  await declararAtorSistema(migrate)
  for (const t of [
    'uso_diario_cliente',
    'campanhas_carteira',
    'sincronizacao_campanhas_carteira',
    'beneficios_de_indicacao',
    'cobrancas_do_cliente_firmare',
  ]) {
    await migrate.query(`DELETE FROM ${t} WHERE cliente_carteira_id = ANY($1)`, [clientes])
  }
  await migrate.query('DELETE FROM auditoria_da_carteira WHERE grupo_id = ANY($1)', [grupos])
  await migrate.query('DELETE FROM sessoes_de_carteira WHERE usuario_gestao_id = ANY($1)', [usuarios])
  await migrate.query('DELETE FROM tentativas_de_carteira WHERE identificador = ANY($1)', [
    ['minha', 'minha3', 'geral'].map((u) => `${u}.${sufixo}`),
  ])
  await migrate.query('DELETE FROM clientes_carteira WHERE id = ANY($1)', [clientes])
  await migrate.query('DELETE FROM usuarios_gestao WHERE id = ANY($1)', [usuarios])
  for (const c of clinicas) await apagarHistoricoGrupoDeTeste(migrate, c)
  await migrate.query('DELETE FROM grupos WHERE id = ANY($1)', [grupos])
  for (const c of clinicas) await apagarClinicaDeTeste(migrate, c)
  await migrate.end()
  await app.close()
  await banco.onModuleDestroy()
})

const painel = (c: string) => get<VisaoGeralDaCarteiraSaida>('/v1/carteira/painel', c)
const resumo = (c: string) => get<ResumoSemanalSaida>('/v1/carteira/resumo/semanal', c)
const mensalidades = (c: string) => get<PainelDeMensalidadesSaida>('/v1/carteira/cobrancas/painel?mes=2026-11', c)

describe('clínica C em 2 grupos, vista pelo geral', () => {
  it('Visão geral: 1 cliente ativo e MRR de R$ 1.000,00; lançar R$ 500,00 no que não conta não muda nada', async () => {
    for (const mensalidadeDoOutro of [0n, 50_000n]) {
      await migrate.query('UPDATE clientes_carteira SET mensalidade_centavos = $2 WHERE id = $1', [ids.outro, mensalidadeDoOutro.toString()])
      const p = await painel(cookie.minha)
      expect(p.kpis.clientesAtivos).toBe(1)
      expect(p.clientesAtivos.map((x) => x.nome)).toEqual([NOME_C])
      expect(p.kpis.mrr).toBe('100000')
      expect(p.kpis.ticketMedio).toBe('100000')
    }
  })

  it('Resumo semanal: "1 cliente ativo" e receita recorrente de R$ 1.000,00', async () => {
    const r = await resumo(cookie.minha)
    expect(r.texto).toContain('1 cliente ativo')
    expect(r.texto).not.toContain('2 clientes ativos')
    expect(r.texto).toContain(`Receita recorrente mensal: ${Dinheiro.deCentavos(100_000n).formatar()}.`)
  })

  it('Cobranças: gera só a do pagador, idempotente em 3 execuções, e o painel soma R$ 1.000,00', async () => {
    // O que não conta tem mensalidade lançada (R$ 500,00): mesmo assim não é cobrado.
    await migrate.query('UPDATE clientes_carteira SET mensalidade_centavos = 50000 WHERE id = $1', [ids.outro])
    const gerar = () => executarGeracaoDeCobrancas(banco, { agora: () => AGORA }, COMPETENCIA, [ids.g1, ids.g2])
    const primeira = await gerar()
    expect(primeira.falhas).toEqual([])
    expect(primeira.geradas).toBe(1)
    expect((await gerar()).geradas).toBe(0)
    expect((await gerar()).geradas).toBe(0)

    const linhas = await migrate.query<{ cliente_carteira_id: string; valor_centavos: string }>(
      'SELECT cliente_carteira_id, valor_centavos::text FROM cobrancas_do_cliente_firmare WHERE cliente_carteira_id = ANY($1)',
      [[ids.pagador, ids.outro]],
    )
    expect(linhas.rows).toEqual([{ cliente_carteira_id: ids.pagador, valor_centavos: '100000' }])

    const m = await mensalidades(cookie.minha)
    expect(m.recorrente.receita).toBe('100000')
    expect(m.recorrente.clientesComMensalidade).toBe(1)
    expect(m.totais.somaValor).toBe('100000')
    expect(m.mensalidades).toHaveLength(1)
  })

  it('Cobranças: uma cobrança antiga do cliente que não conta fica fora dos totais', async () => {
    await migrate.query(
      `INSERT INTO cobrancas_do_cliente_firmare (cliente_carteira_id, grupo_id, competencia, mensalidade_centavos,
                                                 desconto_centavos, valor_centavos, vencimento)
       VALUES ($1, $2, $3, 50000, 0, 50000, '2026-11-10')`,
      [ids.outro, ids.g2, COMPETENCIA],
    )
    const m = await mensalidades(cookie.minha)
    expect(m.totais.somaValor).toBe('100000')
    expect(m.mensalidades).toHaveLength(1)
  })

  it('Uso: 1 item para a clínica e 1 registro de acesso, não 2', async () => {
    for (const [cli, g] of [
      [ids.pagador, ids.g1],
      [ids.outro, ids.g2],
    ] as const) {
      await migrate.query(
        `INSERT INTO uso_diario_cliente (cliente_carteira_id, grupo_id, dia, usuarios_cadastrados, usuarios_ativos,
                                         tarefas_criadas, tarefas_concluidas, tarefas_no_prazo, contatos_pacientes,
                                         faltas, faltas_recontatadas, receita_registrada)
         VALUES ($1, $2, '2026-11-10', 3, 2, 5, 5, 5, 4, 1, 1, 15001)`,
        [cli, g],
      )
    }
    await migrate.query('DELETE FROM auditoria WHERE clinica_id = $1', [ids.clinicaC]).catch(() => undefined)
    const antes = Number(
      (await migrate.query(`SELECT count(*) FROM auditoria WHERE clinica_id = $1 AND entidade = 'uso_diario_cliente'`, [ids.clinicaC])).rows[0].count,
    )
    const r = await get<{ clientes: UsoNaVisaoGeralSaida[] }>('/v1/carteira/uso', cookie.geral)
    expect(r.clientes.filter((x) => x.nome === NOME_C)).toHaveLength(1)
    const depois = Number(
      (await migrate.query(`SELECT count(*) FROM auditoria WHERE clinica_id = $1 AND entidade = 'uso_diario_cliente'`, [ids.clinicaC])).rows[0].count,
    )
    expect(depois - antes).toBe(1)
  })

  it('Campanhas: a receita de R$ 500,00 da clínica entra uma vez no comparativo do geral', async () => {
    const perfil = await um(`INSERT INTO perfis (clinica_id, chave, nome, perms) VALUES ($1, 'pf_x', 'X', '{}') RETURNING id`, [ids.clinicaC])
    const pessoa = await um(
      `INSERT INTO pessoas (clinica_id, nome, usuario, senha_hash, perfil_id, ativo) VALUES ($1, 'Ana', 'ana', 'x', $2, true) RETURNING id`,
      [ids.clinicaC, perfil],
    )
    const campanha = await um(
      `INSERT INTO campanhas (clinica_id, categoria, foco, nome, objetivo, inicio, fim, metrica, tipo_metrica, meta, criada_por)
       VALUES ($1, 'Aniversariantes', '', 'Rosa', '', '2026-11-01', '2026-11-30', 'receita', '', 100000, $2) RETURNING id`,
      [ids.clinicaC, pessoa],
    )
    // Hoje o índice (campanha, mês) só admite UMA cópia, e ela é do primeiro
    // cliente sincronizado; aqui, de propósito, a do que NÃO conta na receita.
    await migrate.query(
      `INSERT INTO campanhas_carteira (cliente_carteira_id, grupo_id, campanha_origem_id, origem, nome, periodo_inicio,
                                       periodo_fim, metrica, meta, resultado, mes_referencia, receita_centavos,
                                       orcamentos_pagos, categoria, status, rotulo_da_metrica)
       VALUES ($1, $2, $3, 'sincronizada', 'Rosa', '2026-11-01', '2026-11-30', 'receita', 100000, 50000, '2026-11-01',
               50000, 6, 'Aniversariantes', 'ativa', 'Receita')`,
      [ids.outro, ids.g2, campanha],
    )
    const r = await get<ComparativoDeCampanhasSaida>('/v1/carteira/campanhas?periodo=3m', cookie.geral)
    const minhas = r.porCliente.filter((x) => x.nome === NOME_C)
    expect(minhas).toHaveLength(1)
    expect(minhas[0]!.valorGerado).toBe('50000')
    expect(r.maisGeraram.filter((x) => x.nomeDoCliente === NOME_C)).toHaveLength(1)
  })
})

describe('3 clínicas em 1, 2 e 3 grupos: o total do geral é o de cada uma em 1 grupo', () => {
  it('Visão geral e resumo não mudam ao acrescentar clientes que não contam', async () => {
    const [x, y, z] = [await novaClinica(`X ${sufixo}`), await novaClinica(`Y ${sufixo}`), await novaClinica(`Z ${sufixo}`)]
    await novoCliente(ids.g1, x, `X ${sufixo}`, 100_000n, true, ids.minha3)
    await novoCliente(ids.g1, y, `Y ${sufixo}`, 200_033n, true, ids.minha3)
    await novoCliente(ids.g1, z, `Z ${sufixo}`, 300_001n, true, ids.minha3)
    const antes = await painel(cookie.minha3)
    const resumoAntes = await resumo(cookie.minha3)
    expect(antes.kpis.clientesAtivos).toBe(3)
    expect(antes.kpis.mrr).toBe('600034')

    await novoCliente(ids.g2, y, `Y ${sufixo}`, 77_777n, false, ids.minha3)
    await novoCliente(ids.g2, z, `Z ${sufixo}`, 88_888n, false, ids.minha3)
    await novoCliente(ids.g3, z, `Z ${sufixo}`, 99_999n, false, ids.minha3)

    const depois = await painel(cookie.minha3)
    expect(depois.kpis).toEqual(antes.kpis)
    expect(depois.clientesAtivos.map((c) => c.nome).sort()).toEqual(antes.clientesAtivos.map((c) => c.nome).sort())
    expect((await resumo(cookie.minha3)).texto).toBe(resumoAntes.texto)
  })
})

describe('jobs ignoram o cliente de um grupo de que a clínica foi removida', () => {
  it('uso diário e campanhas: só o cliente ativo grava, 3 execuções idênticas', async () => {
    const c = await novaClinica(`Job ${sufixo}`)
    const ativo = await novoCliente(ids.g1, c, `Job ${sufixo}`, 0n, true, ids.minha3)
    const removido = await novoCliente(ids.g2, c, `Job ${sufixo}`, 0n, false, ids.minha3)
    await comoOperador(async () => {
      await migrate.query(
        `UPDATE clientes_carteira SET excluido_em = now(), grupo_id = (SELECT id FROM grupos WHERE arquivo) WHERE id = $1`,
        [removido],
      )
    })

    const linhasDeUso = async () =>
      Number(
        (await migrate.query('SELECT count(*) FROM uso_diario_cliente WHERE cliente_carteira_id = ANY($1) AND dia = $2', [[ativo, removido], '2026-11-10']))
          .rows[0].count,
      )
    for (let i = 0; i < 3; i++) {
      const r = await executarUsoDiarioCliente(banco, { agora: () => AGORA }, '2026-11-10')
      expect(r.falhas.filter((f) => [ativo, removido].includes(f.clienteCarteiraId))).toEqual([])
      expect(await linhasDeUso()).toBe(1)
    }
    expect((await migrate.query('SELECT 1 FROM uso_diario_cliente WHERE cliente_carteira_id = $1', [removido])).rowCount).toBe(0)

    for (let i = 0; i < 3; i++) {
      const r = await executarSincronizacaoDeCampanhas(banco, { agora: () => AGORA }, { clienteIds: [ativo, removido] })
      expect(r.processados).toBe(1)
      expect(r.falhas).toEqual([])
    }
    const marcas = await migrate.query<{ cliente_carteira_id: string }>(
      'SELECT cliente_carteira_id FROM sincronizacao_campanhas_carteira WHERE cliente_carteira_id = ANY($1)',
      [[ativo, removido]],
    )
    expect(marcas.rows.map((x) => x.cliente_carteira_id)).toEqual([ativo])
  })
})
