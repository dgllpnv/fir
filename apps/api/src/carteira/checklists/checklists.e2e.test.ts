import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { LinhaDeMetaEmAndamento, UsuarioDeGestaoPublico } from '@fir/contracts'
import { RelogioFixo } from '@fir/domain'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { BancoService } from '../../banco/banco.service'
import { declararAtorSistema } from '../../banco/limpeza-de-teste'
import { ChecklistDoClienteService } from './checklist-do-cliente.service'
import {
  ClienteSemDataDeEntrada,
  MetasJaCadastradas,
  NaoEhClienteExistente,
  NaoEncontrado,
  SemPermissaoDeAdministrar,
  ValorSemPermissao,
} from './checklists-comum'
import { EntradaDeClienteService } from './entrada-de-cliente.service'
import { ModelosDeChecklistService } from './modelos.service'

/**
 * **G8 2C — checklists e entrada de cliente, contra Postgres real.**
 *
 * O isolamento é provado pela RLS de verdade (papel `fir_carteira`, sessão
 * de outro grupo), nunca por um filtro escrito aqui. "Hoje" é domingo,
 * 08/11/2026, no fuso da Firmare.
 */
const URL_MIG =
  process.env['DATABASE_URL_MIGRATE'] ?? 'postgresql://fir_migrate:fir_local_dev@127.0.0.1:4832/fir'

const codigo = `chk${Date.now()}`
const PRODUTO_DE_TESTE = `Programa de teste ${codigo}`

let migrate: pg.Client
let banco: BancoService
let modelos: ModelosDeChecklistService
let checklist: ChecklistDoClienteService
let entrada: EntradaDeClienteService

let grupoA: string
let grupoB: string
let modeloDeTeste: string
let itensDeTeste: string[] = []
let geral: UsuarioDeGestaoPublico
let doA: UsuarioDeGestaoPublico
let doB: UsuarioDeGestaoPublico

async function usuarioDeGestao(nome: string, escopo: 'geral' | 'grupo', grupoId: string | null): Promise<UsuarioDeGestaoPublico> {
  const usuario = `${nome}.${codigo}`
  const r = await migrate.query<{ id: string }>(
    `INSERT INTO usuarios_gestao (usuario, nome, senha_hash, escopo, grupo_id) VALUES ($1, $2, 'x', $3, $4) RETURNING id`,
    [usuario, nome, escopo, grupoId],
  )
  // Perfil de 0.5: o geral administra (edita modelos); ninguém vê valores (meta em R$ recusada).
  return {
    id: r.rows[0]!.id,
    usuario,
    nome,
    escopo,
    grupoId,
    senhaProvisoria: false,
    valores: false,
    carteira: 'todos',
    modulos: [],
    administrar: escopo === 'geral',
    setor: null,
    funcao: null,
    telefone: null,
  }
}

async function cliente(
  grupo: string,
  extra: { produto?: string; area?: string | null; inicio?: string | null; desde?: string | null; responsavel?: string | null } = {},
): Promise<string> {
  const r = await migrate.query<{ id: string }>(
    `INSERT INTO clientes_carteira (grupo_id, nome, produto, area_foco, data_inicio, cliente_desde, responsavel_usuario_gestao_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [
      grupo,
      `Cliente ${randomUUID().slice(0, 6)}`,
      extra.produto ?? PRODUTO_DE_TESTE,
      extra.area ?? null,
      extra.inicio ?? null,
      extra.desde ?? null,
      extra.responsavel ?? null,
    ],
  )
  return r.rows[0]!.id
}

const tarefasDoCliente = async (clienteId: string) =>
  (
    await migrate.query<{ titulo: string; status: string; prazo: string; responsavel: string | null }>(
      `SELECT titulo, status, prazo::text AS prazo, responsavel_usuario_gestao_id AS responsavel
         FROM tarefas_internas WHERE cliente_carteira_id = $1 ORDER BY prazo, titulo`,
      [clienteId],
    )
  ).rows

beforeAll(async () => {
  migrate = new pg.Client({ connectionString: URL_MIG })
  await migrate.connect()
  await declararAtorSistema(migrate)
  banco = new BancoService()
  const relogio = new RelogioFixo(new Date('2026-11-08T15:00:00Z'))
  modelos = new ModelosDeChecklistService(banco)
  checklist = new ChecklistDoClienteService(banco, relogio)
  entrada = new EntradaDeClienteService(banco, relogio)

  const grupo = async (n: string) =>
    (await migrate.query<{ id: string }>('INSERT INTO grupos (nome) VALUES ($1) RETURNING id', [`${n} ${codigo}`])).rows[0]!.id
  grupoA = await grupo('A')
  grupoB = await grupo('B')
  geral = await usuarioDeGestao('geral', 'geral', null)
  doA = await usuarioDeGestao('doa', 'grupo', grupoA)
  doB = await usuarioDeGestao('dob', 'grupo', grupoB)

  // Um modelo PRÓPRIO do teste (produto que nenhum outro teste usa): editar o
  // item aqui nunca mexe na semente que a tela mostra.
  modeloDeTeste = (
    await migrate.query<{ id: string }>(`INSERT INTO modelos_de_checklist (produto) VALUES ($1) RETURNING id`, [PRODUTO_DE_TESTE])
  ).rows[0]!.id
  const item = async (dias: number, titulo: string, quem: string, ordem: number) =>
    (
      await migrate.query<{ id: string }>(
        `INSERT INTO itens_de_modelo (modelo_de_checklist_id, dias, titulo, quem, ordem) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [modeloDeTeste, dias, titulo, quem, ordem],
      )
    ).rows[0]!.id
  itensDeTeste = [
    await item(0, 'Conferir contrato', 'admin', 1),
    await item(10, 'Plano de ação', 'responsavel', 2),
    await item(40, 'Revisão', 'comercial', 3),
  ]
})

afterAll(async () => {
  // O modelo de teste não pode ficar na tela do Método: arquivar é o estado final (regra 20).
  await migrate.query('UPDATE modelos_de_checklist SET arquivado_em = now() WHERE id = $1', [modeloDeTeste])
  await migrate.end()
})

describe('a semente (LGPD A50 e A51 — VETOS)', () => {
  const VETADOS = [/base de pacientes/i, /exporta[cç][aã]o da base/i, /transcri[cç][aã]o/i]

  it('nenhum item gravado manda receber base de pacientes ou anexar transcrição', async () => {
    const r = await migrate.query<{ titulo: string }>('SELECT titulo FROM itens_de_modelo')
    expect(r.rows.length).toBeGreaterThan(80)
    for (const { titulo } of r.rows) for (const v of VETADOS) expect(titulo, titulo).not.toMatch(v)
  })

  it('o texto da migration (fora dos comentários) também não tem os itens vetados', () => {
    const sql = readFileSync(join(__dirname, '../../../migrations/0053_carteira_checklists_e_entrada_de_cliente.sql'), 'utf8')
    const semComentarios = sql
      .split(/\r?\n/)
      .filter((l) => !l.trimStart().startsWith('--'))
      .join('\n')
    for (const v of VETADOS) expect(semComentarios).not.toMatch(v)
    // Os substitutos estão lá.
    expect(semComentarios).toContain('agregado por serviço, sem identificação de paciente')
    expect(semComentarios).toContain("'Realizar o briefing com o roteiro da ferramenta'")
  })

  it('os seis checklists do protótipo, com 27 itens no Acelerador FIR · Comercial', async () => {
    const saida = await modelos.listar(doA)
    const rotulos = saida.modelos.map((m) => m.rotulo)
    for (const r of [
      'Acelerador FIR',
      'Acelerador FIR · Comercial',
      'Consultoria',
      'Gestão por Assinatura',
      'Programa de Gestão FIR',
      'Projeto',
    ]) {
      expect(rotulos).toContain(r)
    }
    expect(saida.modelos.find((m) => m.rotulo === 'Acelerador FIR · Comercial')?.itens).toHaveLength(27)
    expect(saida.podeAdministrar).toBe(false)
  })
})

describe('aplicar o checklist (X5, appsec A-20)', () => {
  it('aplicar três vezes gera as tarefas UMA vez', async () => {
    const id = await cliente(grupoA, { inicio: '2026-11-08', responsavel: doA.id })
    const primeira = await checklist.aplicar(doA, id, { origem: 'novo' })
    const segunda = await checklist.aplicar(doA, id, { origem: 'novo' })
    const terceira = await checklist.aplicar(doA, id, { origem: 'gerar' })
    expect([primeira.criadas, segunda.criadas, terceira.criadas]).toEqual([3, 0, 0])
    expect(segunda.jaExistiam).toBe(3)
    const tarefas = await tarefasDoCliente(id)
    expect(tarefas).toHaveLength(3)
    // Diretoria = escopo geral; responsável = doA; "comercial" sem setor cai no responsável.
    expect(tarefas.map((t) => [t.titulo, t.prazo])).toEqual([
      ['Conferir contrato', '2026-11-08'],
      ['Plano de ação', '2026-11-18'],
      ['Revisão', '2026-12-18'],
    ])
    expect(tarefas[1]!.responsavel).toBe(doA.id)
    expect(tarefas[2]!.responsavel).toBe(doA.id)
    const diretoria = await migrate.query<{ escopo: string }>('SELECT escopo FROM usuarios_gestao WHERE id = $1', [tarefas[0]!.responsavel])
    expect(diretoria.rows[0]!.escopo).toBe('geral')
    expect(primeira.recado).toContain(`Cliente criada com 3 tarefas do checklist ${PRODUTO_DE_TESTE}`)
  })

  it('o item do setor vai à primeira pessoa ativa daquele setor do grupo (setor decide só o destino)', async () => {
    const grupoC = (
      await migrate.query<{ id: string }>('INSERT INTO grupos (nome) VALUES ($1) RETURNING id', [`C ${codigo}`])
    ).rows[0]!.id
    const comercial = (
      await migrate.query<{ id: string }>(
        `INSERT INTO usuarios_gestao (usuario, nome, senha_hash, escopo, grupo_id, setor) VALUES ($1, 'Eduarda', 'x', 'grupo', $2, 'comercial') RETURNING id`,
        [`edu.${codigo}`, grupoC],
      )
    ).rows[0]!.id
    const id = await cliente(grupoC, { inicio: '2026-11-08' })
    await checklist.aplicar(geral, id, { origem: 'novo' })
    const t = await tarefasDoCliente(id)
    expect(t.find((x) => x.titulo === 'Revisão')?.responsavel).toBe(comercial)
  })

  it('três cliques CONCORRENTES também geram uma vez só', async () => {
    const id = await cliente(grupoA, { inicio: '2026-11-08' })
    const r = await Promise.all([1, 2, 3].map(() => checklist.aplicar(doA, id, { origem: 'novo' })))
    expect(r.map((x) => x.criadas).sort()).toEqual([0, 0, 3])
    expect(await tarefasDoCliente(id)).toHaveLength(3)
  })

  it('produto e frente vencem o geral do produto (Acelerador FIR · Comercial)', async () => {
    const id = await cliente(grupoA, { produto: 'Acelerador FIR', area: 'Comercial', inicio: '2026-11-08' })
    const r = await checklist.aplicar(doA, id, { origem: 'novo' })
    expect(r.rotulo).toBe('Acelerador FIR · Comercial')
    expect(r.criadas).toBe(27)
    const lido = await checklist.ler(doA, id)
    expect(lido.geradoParaOModelo).toBe(true)
    expect(lido.progresso).toMatchObject({ total: 27, concluidos: 0, atrasados: 0 })
    expect(lido.itens.find((i) => i.dias === 3)?.acao).toBe('diagnostico')
  })

  it('cliente que já era da Firmare: itens vencidos entram feitos e "Completar o cadastro" nasce uma vez', async () => {
    const id = await cliente(grupoA, { desde: '2025-03-01', inicio: '2026-10-20' })
    const r = await checklist.aplicar(doA, id, { origem: 'existente' })
    // 20/10 (D+0) e 30/10 (D+10) passaram; 29/11 (D+40) fica pela frente.
    expect([r.criadas, r.entraramFeitas]).toEqual([3, 2])
    expect(r.recado).toBe('Cliente trazida. 1 itens do checklist pela frente, 2 marcados como feitos.')
    await checklist.aplicar(doA, id, { origem: 'existente' })
    const tarefas = await tarefasDoCliente(id)
    expect(tarefas.filter((t) => t.titulo.startsWith('Completar o cadastro de'))).toHaveLength(1)
    expect(tarefas.filter((t) => t.status === 'concluida')).toHaveLength(2)
    const e = await entrada.ler(doA, id)
    expect(e.existente).toBe(true)
    expect(e.faltas.map((f) => f.codigo)).toEqual(['links', 'metas'])
    expect(e.mostrarAviso).toBe(true)
  })

  it('"Já é cliente" sem "cliente desde" é recusado', async () => {
    const id = await cliente(grupoA)
    await expect(checklist.aplicar(doA, id, { origem: 'existente' })).rejects.toBeInstanceOf(ClienteSemDataDeEntrada)
  })

  it('marcar no checklist conclui a tarefa da rotina, e reabrir volta', async () => {
    const id = await cliente(grupoA, { inicio: '2026-11-01' })
    await checklist.aplicar(doA, id, { origem: 'gerar' })
    const antes = await checklist.ler(doA, id)
    expect(antes.progresso.atrasados).toBe(1)
    const item = antes.itens[0]!
    await checklist.mudarStatus(doA, id, item.id, true)
    const depois = await checklist.ler(doA, id)
    expect(depois.progresso).toMatchObject({ concluidos: 1, atrasados: 0 })
    const t = await migrate.query<{ status: string }>('SELECT status FROM tarefas_internas WHERE id = $1', [item.tarefaId])
    expect(t.rows[0]!.status).toBe('concluida')
    await checklist.mudarStatus(doA, id, item.id, false)
    expect((await checklist.ler(doA, id)).progresso.concluidos).toBe(0)
  })
})

describe('isolamento por grupo', () => {
  it('outro grupo não lê, não aplica e não marca: 404 idêntico a "não existe"', async () => {
    const id = await cliente(grupoA, { inicio: '2026-11-08' })
    await checklist.aplicar(doA, id, { origem: 'novo' })
    const item = (await checklist.ler(doA, id)).itens[0]!
    await expect(checklist.ler(doB, id)).rejects.toBeInstanceOf(NaoEncontrado)
    await expect(checklist.aplicar(doB, id, { origem: 'gerar' })).rejects.toBeInstanceOf(NaoEncontrado)
    await expect(checklist.mudarStatus(doB, id, item.id, true)).rejects.toBeInstanceOf(NaoEncontrado)
    await expect(entrada.ler(doB, id)).rejects.toBeInstanceOf(NaoEncontrado)
    // Pelo banco: a sessão de B não enxerga nenhuma linha do checklist de A.
    const visto = await banco.nasTabelasDaCarteiraComoUsuarioDeGestao(doB, (c) =>
      c.query('SELECT 1 FROM checklist_do_cliente WHERE cliente_carteira_id = $1', [id]),
    )
    expect(visto.rowCount).toBe(0)
  })

  it('grupo não escreve modelo: 403 no serviço E recusa da RLS se o serviço esquecer', async () => {
    await expect(modelos.criarItem(doA, modeloDeTeste, { titulo: 'x', dias: 1, quem: 'responsavel', acao: null })).rejects.toBeInstanceOf(
      SemPermissaoDeAdministrar,
    )
    await expect(
      banco.nasTabelasDaCarteiraComoUsuarioDeGestao(doA, (c) =>
        c.query(`INSERT INTO itens_de_modelo (modelo_de_checklist_id, dias, titulo) VALUES ($1, 1, 'x')`, [modeloDeTeste]),
      ),
    ).rejects.toThrow(/row-level security/)
    const r = await banco.nasTabelasDaCarteiraComoUsuarioDeGestao(doA, (c) =>
      c.query(`UPDATE itens_de_modelo SET titulo = 'x' WHERE id = $1`, [itensDeTeste[0]]),
    )
    expect(r.rowCount).toBe(0)
  })
})

describe('editar o item do modelo (X3)', () => {
  it('propaga o título só para as tarefas ABERTAS', async () => {
    const aberto = await cliente(grupoA, { inicio: '2026-11-08' })
    const fechado = await cliente(grupoB, { inicio: '2026-11-08' })
    await checklist.aplicar(doA, aberto, { origem: 'novo' })
    await checklist.aplicar(doB, fechado, { origem: 'novo' })
    const itemFechado = (await checklist.ler(doB, fechado)).itens.find((i) => i.titulo === 'Plano de ação')!
    await checklist.mudarStatus(doB, fechado, itemFechado.id, true)

    const r = await modelos.editarItem(geral, itensDeTeste[1]!, { titulo: 'Plano de ação de 4 meses' })
    expect(r.item.titulo).toBe('Plano de ação de 4 meses')
    expect(r.tarefasAtualizadas).toBeGreaterThanOrEqual(1)
    expect((await tarefasDoCliente(aberto)).map((t) => t.titulo)).toContain('Plano de ação de 4 meses')
    expect((await tarefasDoCliente(fechado)).map((t) => t.titulo)).toContain('Plano de ação')
  })
})

describe('metas em andamento da entrada (C6, passo 2 de 3)', () => {
  const meta = (extra: Partial<LinhaDeMetaEmAndamento> = {}): LinhaDeMetaEmAndamento => ({
    titulo: 'Novos pacientes por mês',
    indicador: 'Novos pacientes',
    unidade: 'un',
    tipo: 'mensal',
    valorInicial: '20',
    valorAtual: '28',
    valorMeta: '40',
    prazo: null,
    ...extra,
  })

  it('o mesmo lote três vezes cria as metas uma vez; outro lote é recusado', async () => {
    const id = await cliente(grupoA, { desde: '2024-01-10' })
    await checklist.aplicar(doA, id, { origem: 'existente' })
    const chave = randomUUID()
    const lote = { chaveIdempotencia: chave, metas: [meta(), meta({ titulo: 'Taxa de retorno', unidade: '%', valorMeta: '3500', tipo: 'prazo', prazo: '2027-02-28' })] }
    const r = [await entrada.cadastrarMetas(doA, id, lote), await entrada.cadastrarMetas(doA, id, lote), await entrada.cadastrarMetas(doA, id, lote)]
    expect(r).toEqual([
      { criadas: 2, jaExistia: false },
      { criadas: 2, jaExistia: true },
      { criadas: 2, jaExistia: true },
    ])
    const m = await migrate.query<{ tipo: string; agregacao: string; prazo: string | null }>(
      'SELECT tipo, agregacao, prazo::text AS prazo FROM metas_comerciais WHERE cliente_carteira_id = $1 ORDER BY titulo',
      [id],
    )
    expect(m.rows).toEqual([
      { tipo: 'mensal', agregacao: 'soma', prazo: null },
      { tipo: 'prazo', agregacao: 'media', prazo: '2027-02-28' },
    ])
    const l = await migrate.query<{ referencia: string }>(
      `SELECT l.referencia::text AS referencia FROM lancamentos_de_indicador l
         JOIN indicadores_carteira i ON i.id = l.indicador_id WHERE i.cliente_carteira_id = $1`,
      [id],
    )
    // "Hoje" = domingo 08/11: o lançamento é da semana que começou na segunda 02/11.
    expect(l.rows.map((x) => x.referencia)).toEqual(['2026-11-02', '2026-11-02'])
    await expect(entrada.cadastrarMetas(doA, id, { ...lote, chaveIdempotencia: randomUUID() })).rejects.toBeInstanceOf(
      MetasJaCadastradas,
    )
    expect((await entrada.ler(doA, id)).faltas.map((f) => f.codigo)).not.toContain('metas')
  })

  it('meta em R$ sem a permissão de valores: 403 e nada gravado (appsec A-6)', async () => {
    const id = await cliente(grupoA, { desde: '2024-01-10' })
    await checklist.aplicar(doA, id, { origem: 'existente' })
    await expect(
      entrada.cadastrarMetas(doA, id, { chaveIdempotencia: randomUUID(), metas: [meta({ unidade: 'R$', valorMeta: '15000000' })] }),
    ).rejects.toBeInstanceOf(ValorSemPermissao)
    const n = await migrate.query('SELECT 1 FROM metas_comerciais WHERE cliente_carteira_id = $1', [id])
    expect(n.rowCount).toBe(0)
  })

  it('cliente que não entrou como "já é cliente" não tem o passo; "Fazer depois" cria a tarefa uma vez', async () => {
    const nova = await cliente(grupoA)
    await expect(entrada.cadastrarMetas(doA, nova, { chaveIdempotencia: randomUUID(), metas: [meta()] })).rejects.toBeInstanceOf(
      NaoEhClienteExistente,
    )
    const id = await cliente(grupoA, { desde: '2024-01-10' })
    await checklist.aplicar(doA, id, { origem: 'existente' })
    expect(await entrada.metasDepois(doA, id)).toEqual({ tarefaCriada: true })
    expect(await entrada.metasDepois(doA, id)).toEqual({ tarefaCriada: false })
    const t = await tarefasDoCliente(id)
    expect(t.filter((x) => x.titulo.startsWith('Cadastrar as metas em andamento'))).toHaveLength(1)
  })
})
