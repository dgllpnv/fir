import {
  CAMPOS_MONETARIOS,
  type MovimentoDeEstoque,
  type Relogio,
  type TipoDeMovimento,
  lotesComSaldo,
  saldoEmMedida,
} from '@fir/domain'
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify'
import { Test } from '@nestjs/testing'
import fc from 'fast-check'
import pg from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { AppModule } from '../app.module'
import { hashDeSenha } from '../autenticacao/senha'
import {
  apagarClinicaDeTeste,
  apagarMovimentosDeEstoqueDeTeste,
  apagarOperadorDeTeste,
  declararAtorSistema,
} from '../banco/limpeza-de-teste'
import { RELOGIO } from '../comum/relogio'
import { registrarCookie } from '../main'

/**
 * A ABA CONSUMO e o RECONHECIMENTO DA DIFERENÇA, contra Postgres de verdade.
 *
 * O que só este arquivo mede:
 *  1. Consumo: isolamento de clínica (404), as DUAS permissões (`estoque` e
 *     `jornada`), a trilha de acesso, a redação (nenhum campo monetário e
 *     nenhum custo), a paginação de limite fixo e o estorno ligado à origem.
 *  2. Diferença reconhecida: só em contagem concluída, só `estoque.gerir`,
 *     diferença recalculada no servidor, idempotente sob concorrência, e
 *     **efeito zero no saldo** (propriedade).
 *  3. "Estoque atualizado para o contado" só depois de concluída.
 */
const URL_MIG =
  process.env['DATABASE_URL_MIGRATE'] ?? 'postgresql://fir_migrate:fir_local_dev@127.0.0.1:4832/fir'
const SENHA = 'montanha-de-vidro-aberta'
const FUSO = 'America/Sao_Paulo'
const INICIO = new Date('2026-11-02T02:00:00.000Z')
const relogioDeTeste: Relogio = { agora: () => INICIO }
const HOJE = '2026-11-01'

let app: NestFastifyApplication
let migrate: pg.Client
let clinica: string
let outraClinica: string
let pacA: string
let pacB: string
let pacDaOutra: string
let pessoaGestora: string
let pessoaEnf: string
const codigo = `cdf-${Date.now()}`

const srv = () => request(app.getHttpServer())
const entrar = (usuario: string, cod = codigo) =>
  srv().post('/v1/entrar').send({ clinica: cod, usuario, senha: SENHA })
const cookieDe = (r: { headers: Record<string, string> }): string[] => {
  const v = r.headers['set-cookie'] as unknown
  return Array.isArray(v) ? (v as string[]) : typeof v === 'string' ? [v] : []
}

/** estoque + estoque.gerir + valores + jornada */
let gestora: string[]
/** estoque + jornada, SEM valores e sem gerir */
let enfJornada: string[]
/** estoque, SEM jornada */
let enfSemJornada: string[]
/** jornada, SEM estoque */
let soJornada: string[]
let adminDaOutra: string[]

const FRASCO = {
  nome: 'Tirzepatida 5 mg',
  medida: 'ampola',
  compra: { tem: true, unidade: 'caixa', fator: '4000' },
  uso: { tem: true, unidade: 'mg', fator: '5000' },
  aproveitaSobra: false,
  custo: '45000',
}

const criarItem = (sessao: string[], corpo: Record<string, unknown>) =>
  srv().post('/v1/estoque').set('Cookie', sessao).send(corpo)
const mover = (sessao: string[], corpo: Record<string, unknown>) =>
  srv().post('/v1/estoque/movimentos').set('Cookie', sessao).send(corpo)
const consumo = (sessao: string[], id: string, pagina?: number) =>
  srv()
    .get(`/v1/pacientes/${id}/consumo${pagina === undefined ? '' : `?pagina=${pagina}`}`)
    .set('Cookie', sessao)

/** Quantas linhas de acesso a `pacientes/<id>` a trilha tem — a trilha é append-only, então só se compara antes × depois. */
const acessosA = async (paciente: string): Promise<number> =>
  (
    await migrate.query(
      `SELECT 1 FROM auditoria WHERE acao = 'acessou' AND entidade = 'pacientes' AND entidade_id = $1`,
      [paciente],
    )
  ).rowCount ?? 0

const chavesProfundas = (x: unknown, saida = new Set<string>()): Set<string> => {
  if (x === null || typeof x !== 'object') return saida
  if (Array.isArray(x)) {
    for (const i of x) chavesProfundas(i, saida)
    return saida
  }
  for (const [k, v] of Object.entries(x)) {
    saida.add(k)
    chavesProfundas(v, saida)
  }
  return saida
}

beforeAll(async () => {
  migrate = new pg.Client({ connectionString: URL_MIG })
  await migrate.connect()
  await declararAtorSistema(migrate)

  const novaClinica = async (cod: string) =>
    (
      await migrate.query<{ id: string }>(
        `INSERT INTO clinicas (codigo, nome, fuso) VALUES ($1, 'Clínica do Consumo', $2) RETURNING id`,
        [cod, FUSO],
      )
    ).rows[0]!.id
  clinica = await novaClinica(codigo)
  outraClinica = await novaClinica(`${codigo}-b`)

  const perfil = async (c: string, chave: string, perms: string[]) =>
    (
      await migrate.query<{ id: string }>(
        `INSERT INTO perfis (clinica_id, chave, nome, perms) VALUES ($1,$2,$2,$3) RETURNING id`,
        [c, chave, perms],
      )
    ).rows[0]!.id
  const pfGestora = await perfil(clinica, 'pf_gestora', ['estoque', 'estoque.gerir', 'valores', 'jornada'])
  const pfEnfJ = await perfil(clinica, 'pf_enf_j', ['estoque', 'jornada'])
  const pfEnf = await perfil(clinica, 'pf_enf', ['estoque'])
  const pfJ = await perfil(clinica, 'pf_j', ['jornada'])

  const hash = await hashDeSenha(SENHA)
  const pessoa = async (c: string, nome: string, usuario: string, perfilId: string | null) =>
    (
      await migrate.query<{ id: string }>(
        `INSERT INTO pessoas (clinica_id, nome, usuario, senha_hash, admin, perfil_id)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [c, nome, usuario, hash, perfilId === null, perfilId],
      )
    ).rows[0]!.id
  pessoaGestora = await pessoa(clinica, 'Helena Prado', 'helena', pfGestora)
  pessoaEnf = await pessoa(clinica, 'Camila Enf', 'camila', pfEnfJ)
  await pessoa(clinica, 'Sem Jornada', 'semj', pfEnf)
  await pessoa(clinica, 'So Jornada', 'soj', pfJ)
  await pessoa(outraClinica, 'Vizinha', 'vizinha', null)

  const paciente = async (c: string, nome: string) =>
    (
      await migrate.query<{ id: string }>(
        `INSERT INTO pacientes (clinica_id, nome) VALUES ($1, $2) RETURNING id`,
        [c, nome],
      )
    ).rows[0]!.id
  pacA = await paciente(clinica, 'Fernanda Teste')
  pacB = await paciente(clinica, 'Outra Paciente')
  pacDaOutra = await paciente(outraClinica, 'Paciente da Vizinha')

  const mod = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(RELOGIO)
    .useValue(relogioDeTeste)
    .compile()
  app = mod.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
  await registrarCookie(app)
  await app.init()
  await app.getHttpAdapter().getInstance().ready()

  gestora = cookieDe(await entrar('helena').expect(200))
  enfJornada = cookieDe(await entrar('camila').expect(200))
  enfSemJornada = cookieDe(await entrar('semj').expect(200))
  soJornada = cookieDe(await entrar('soj').expect(200))
  adminDaOutra = cookieDe(await entrar('vizinha', `${codigo}-b`).expect(200))
})

afterAll(async () => {
  await apagarClinicaDeTeste(migrate, clinica)
  await apagarClinicaDeTeste(migrate, outraClinica)
  await migrate.end()
  await app.close()
})

beforeEach(async () => {
  await apagarMovimentosDeEstoqueDeTeste(migrate, clinica)
  for (const tabela of [
    'contado_na_contagem',
    'itens_da_contagem',
    'contagens_de_estoque',
    'tarefas',
    'itens_de_estoque',
  ]) {
    await migrate.query(`DELETE FROM ${tabela} WHERE clinica_id = $1`, [clinica])
  }
})

/* ========================================================================
 * 3.1 — A ABA CONSUMO
 * ====================================================================== */

describe('GET /v1/pacientes/:id/consumo', () => {
  let frasco: string

  beforeEach(async () => {
    const r = await criarItem(gestora, {
      ...FRASCO,
      inicial: { quantidade: '100000' },
    }).expect(201)
    frasco = r.body.id
  })

  const consumirDe = (paciente: string, mg: string) =>
    mover(gestora, {
      itemId: frasco,
      tipo: 'consumo',
      quantidade: mg,
      unidade: 'mg',
      dia: HOJE,
      pacienteId: paciente,
    }).expect(201)

  it('mostra a dose formatada pela conversão do item, sem milésimos brutos, sem custo e sem o descarte', async () => {
    await consumirDe(pacA, '2500') // 2,5 mg = 0,5 ampola; abre o frasco e DESCARTA a sobra
    const r = await consumo(enfJornada, pacA).expect(200)

    expect(r.body.itens).toHaveLength(1)
    const l = r.body.itens[0]
    expect(l.item).toBe('Tirzepatida 5 mg')
    expect(l.quantidade.texto).toBe('0,5 ampola')
    expect(l.quantidadeEmUso.texto).toBe('2,5 mg')
    expect(l.dia).toBe(HOJE)
    expect(l.estorno).toBe(false)
    expect(l.estornado).toBe(false)
    expect(l.origem).toBe('atendimento')
    // O descarte da sobra existe no banco (sem paciente) e NÃO é aplicação.
    const desc = await migrate.query(
      `SELECT 1 FROM movimentos_de_estoque WHERE item_id = $1 AND tipo = 'descarte'`,
      [frasco],
    )
    expect(desc.rowCount).toBe(1)

    // Sem custo: nem o nome da chave, nem o valor cadastrado (R$ 450,00).
    const chaves = chavesProfundas(r.body)
    for (const k of CAMPOS_MONETARIOS) expect(chaves, k).not.toContain(k)
    expect(r.text).not.toContain('45000')
    expect(r.text).not.toContain('custo')
    // Nenhum campo de paciente: nem o id, nem o nome.
    expect(r.text).not.toContain(pacA)
    expect(r.text).not.toContain('Fernanda')
  })

  it('NÃO traz o consumo de outro paciente da mesma clínica, nem "outros do lote"', async () => {
    await consumirDe(pacA, '2500')
    await consumirDe(pacB, '1000')
    const r = await consumo(gestora, pacA).expect(200)
    expect(r.body.itens).toHaveLength(1)
    expect(r.body.itens[0].quantidade.texto).toBe('0,5 ampola')
    expect(r.text).not.toContain(pacB)
    const rb = await consumo(gestora, pacB).expect(200)
    expect(rb.body.itens).toHaveLength(1)
    expect(rb.body.itens[0].quantidade.texto).toBe('0,2 ampola')
  })

  it('o ESTORNO aparece ligado à origem — e a origem sabe que foi estornada', async () => {
    await consumirDe(pacA, '2500')
    const origem = await migrate.query<{ id: string }>(
      `SELECT id FROM movimentos_de_estoque WHERE paciente_id = $1 AND tipo = 'consumo'`,
      [pacA],
    )
    const idOrigem = origem.rows[0]!.id
    // O que `desfazer` faz: espelha a origem, SEM `paciente_id`.
    await migrate.query(
      `INSERT INTO movimentos_de_estoque
         (clinica_id, item_id, tipo, milesimos, dia, lote, motivo, obs, compensa_id, compensa_motivo)
       SELECT clinica_id, item_id, tipo, -milesimos, dia, lote, motivo, 'Sessão reaberta', id, 'sessao-reaberta'
         FROM movimentos_de_estoque WHERE id = $1`,
      [idOrigem],
    )
    const r = await consumo(gestora, pacA).expect(200)
    expect(r.body.itens).toHaveLength(2)
    const estorno = r.body.itens.find((x: { estorno: boolean }) => x.estorno)
    const consumoOriginal = r.body.itens.find((x: { estorno: boolean }) => !x.estorno)
    expect(estorno.estornaId).toBe(idOrigem)
    expect(estorno.quantidade.texto).toBe('0,5 ampola')
    expect(consumoOriginal.id).toBe(idOrigem)
    expect(consumoOriginal.estornado).toBe(true)
    // O estorno do paciente B não vaza para a ficha de A.
    const rb = await consumo(gestora, pacB).expect(200)
    expect(rb.body.itens).toHaveLength(0)
  })

  it('`tarefaId` só sai para quem enxerga a tarefa (a regra de editar tarefa)', async () => {
    const t = await migrate.query<{ id: string }>(
      `INSERT INTO tarefas (clinica_id, solicitante_id, responsavel_id, descricao, prazo)
       VALUES ($1, $2, $2, 'Sessão', $3::date) RETURNING id`,
      [clinica, pessoaGestora, HOJE],
    )
    const tarefaId = t.rows[0]!.id
    await migrate.query(
      `INSERT INTO movimentos_de_estoque
         (clinica_id, item_id, tipo, milesimos, dia, paciente_id, tarefa_id, item_chave, aplicado_por_id)
       VALUES ($1, $2, 'consumo', -500, $3::date, $4, $5, 'a1', $6)`,
      [clinica, frasco, HOJE, pacA, tarefaId, pessoaEnf],
    )
    const dono = await consumo(gestora, pacA).expect(200)
    expect(dono.body.itens[0].tarefaId).toBe(tarefaId)
    expect(dono.body.itens[0].origem).toBe('sessao')
    expect(dono.body.itens[0].quem).toBe('Camila Enf')

    const outra = await consumo(enfJornada, pacA).expect(200)
    expect(outra.body.itens[0].tarefaId).toBeNull()
    expect(outra.text).not.toContain(tarefaId)
  })

  it('exige `estoque` E `jornada`: falta uma, 403 — e 403 não grava acesso', async () => {
    const antes = await acessosA(pacA)
    await consumo(enfSemJornada, pacA).expect(403)
    await consumo(soJornada, pacA).expect(403)
    expect(await acessosA(pacA)).toBe(antes)
  })

  it('a leitura GRAVA o acesso (regra 18), com o id do paciente e o ator', async () => {
    const antes = await acessosA(pacA)
    await consumo(enfJornada, pacA).expect(200)
    expect(await acessosA(pacA)).toBe(antes + 1)
    const trilha = await migrate.query<{ ator_id: string }>(
      `SELECT ator_id FROM auditoria WHERE clinica_id = $1 AND acao = 'acessou'
          AND entidade = 'pacientes' AND entidade_id = $2 ORDER BY em DESC LIMIT 1`,
      [clinica, pacA],
    )
    expect(trilha.rows[0]!.ator_id).toBe(pessoaEnf)
  })

  it('paciente de OUTRA clínica é 404 nos dois sentidos, e não grava acesso', async () => {
    const antes = (await acessosA(pacA)) + (await acessosA(pacDaOutra))
    await consumo(gestora, pacDaOutra).expect(404)
    await consumo(adminDaOutra, pacA).expect(404)
    expect((await acessosA(pacA)) + (await acessosA(pacDaOutra))).toBe(antes)
  })

  it('PAGINA com limite fixo no servidor: 25 linhas = 20 + 5, e o cliente não escolhe o limite', async () => {
    for (let i = 0; i < 25; i++) {
      await migrate.query(
        `INSERT INTO movimentos_de_estoque
           (clinica_id, item_id, tipo, milesimos, dia, paciente_id)
         VALUES ($1, $2, 'consumo', -100, $3::date, $4)`,
        [clinica, frasco, HOJE, pacA],
      )
    }
    const p1 = await consumo(gestora, pacA).expect(200)
    expect(p1.body.itens).toHaveLength(20)
    expect(p1.body.temMais).toBe(true)
    expect(p1.body.limite).toBe(20)
    const p2 = await consumo(gestora, pacA, 2).expect(200)
    expect(p2.body.itens).toHaveLength(5)
    expect(p2.body.temMais).toBe(false)
    const ids = new Set([...p1.body.itens, ...p2.body.itens].map((x: { id: string }) => x.id))
    expect(ids.size).toBe(25)

    await srv().get(`/v1/pacientes/${pacA}/consumo?limite=100000`).set('Cookie', gestora).expect(400)
    await consumo(gestora, pacA, 0).expect(400)
  })

  it('vazio: devolve lista vazia, não erro', async () => {
    const r = await consumo(gestora, pacA).expect(200)
    expect(r.body).toEqual({ itens: [], liquidoPorItem: [], pagina: 1, limite: 20, temMais: false })
  })
})

/* ========================================================================
 * 3.2 — INVENTÁRIO: o saldo já é o contado; reconhecer não mexe nele
 * ====================================================================== */

const abrirEConcluir = async (
  frasco: string,
  contadoMilesimos: string,
): Promise<{ id: string; concluida: Record<string, any> }> => {
  const a = await srv()
    .post('/v1/estoque/contagens')
    .set('Cookie', gestora)
    .send({ filtro: 'todos', responsavelId: pessoaGestora, prazo: HOJE })
    .expect(201)
  const id = a.body.contagem.id as string
  const r = await srv()
    .put(`/v1/estoque/contagens/${id}`)
    .set('Cookie', gestora)
    .send({
      itens: [{ itemId: frasco, lotes: [{ lote: null, quantidade: contadoMilesimos }] }],
      concluir: true,
      reposicao: false,
    })
    .expect(200)
  return { id, concluida: r.body.contagem }
}

const saldoDe = async (id: string): Promise<string> => {
  const r = await srv().get('/v1/estoque').set('Cookie', gestora).expect(200)
  return (r.body.itens as { id: string; saldoEmEstoque: { milesimos: string } }[]).find(
    (i) => i.id === id,
  )!.saldoEmEstoque.milesimos
}

const reconhecer = (sessao: string[], id: string, corpo: unknown) =>
  srv().post(`/v1/estoque/contagens/${id}/reconhecer`).set('Cookie', sessao).send(corpo as object)

const linhasReconhecidas = async (contagemId: string) =>
  (
    await migrate.query<{ diferenca_milesimos: string; motivo: string; reconhecida_por: string }>(
      `SELECT diferenca_milesimos::text, motivo, reconhecida_por
         FROM diferencas_reconhecidas WHERE contagem_id = $1`,
      [contagemId],
    )
  ).rows

describe('concluir a contagem: "Estoque atualizado para o contado"', () => {
  let frasco: string
  beforeEach(async () => {
    frasco = (await criarItem(gestora, { ...FRASCO, inicial: { quantidade: '10000' } }).expect(201))
      .body.id
  })

  it('a ABERTA não tem esperado nem o aviso; a CONCLUÍDA mostra saldo anterior → novo', async () => {
    const a = await srv()
      .post('/v1/estoque/contagens')
      .set('Cookie', gestora)
      .send({ filtro: 'todos', responsavelId: pessoaGestora, prazo: HOJE })
      .expect(201)
    const aberta = await srv()
      .get(`/v1/estoque/contagens/${a.body.contagem.id}`)
      .set('Cookie', gestora)
      .expect(200)
    for (const k of ['estoqueAtualizado', 'esperadoEmEstoque', 'diferencaReconhecida']) {
      expect(Object.keys(aberta.body.itens[0]), k).not.toContain(k)
    }
    expect(aberta.text).not.toContain('10000')

    const { concluida } = await abrirEConcluir(frasco, '8000')
    expect(concluida.itens[0].estoqueAtualizado.de.texto).toBe('10 ampola')
    expect(concluida.itens[0].estoqueAtualizado.para.texto).toBe('8 ampola')
    expect(concluida.itens[0].diferencaReconhecida).toBeNull()
  })
})

describe('POST /v1/estoque/contagens/:id/reconhecer', () => {
  let frasco: string
  beforeEach(async () => {
    frasco = (await criarItem(gestora, { ...FRASCO, inicial: { quantidade: '10000' } }).expect(201))
      .body.id
  })

  it('grava a diferença RECALCULADA no servidor, com quem e quando, e o saldo NÃO se mexe', async () => {
    const { id } = await abrirEConcluir(frasco, '8000') // esperado 10, contado 8
    const saldoAntes = await saldoDe(frasco)
    const movsAntes = (await migrate.query('SELECT 1 FROM movimentos_de_estoque WHERE item_id = $1', [frasco])).rowCount

    const r = await reconhecer(gestora, id, { itens: [frasco] }).expect(200)
    expect(r.body.reconhecidas).toBe(1)
    expect(r.body.jaReconhecidas).toBe(0)
    const item = r.body.contagem.itens[0]
    expect(item.diferencaReconhecida.quantidadeEmEstoque.milesimos).toBe('-2000')
    expect(item.diferencaReconhecida.por).toBe('Helena Prado')

    const linhas = await linhasReconhecidas(id)
    expect(linhas).toEqual([
      { diferenca_milesimos: '-2000', motivo: 'Inventário', reconhecida_por: pessoaGestora },
    ])

    // EFEITO ZERO: mesmo saldo, mesmo número de movimentos.
    expect(await saldoDe(frasco)).toBe(saldoAntes)
    expect(saldoAntes).toBe('8000')
    expect(
      (await migrate.query('SELECT 1 FROM movimentos_de_estoque WHERE item_id = $1', [frasco])).rowCount,
    ).toBe(movsAntes)

    // O histórico mostra quem/quando junto da lista.
    const lista = await srv().get('/v1/estoque/contagens').set('Cookie', gestora).expect(200)
    const na = lista.body.contagens.find((x: { id: string }) => x.id === id)
    expect(na.reconhecidas).toMatchObject({ quantidade: 1, por: 'Helena Prado' })
  })

  it('ignora qualquer valor do cliente: o corpo só aceita os itens (400)', async () => {
    const { id } = await abrirEConcluir(frasco, '8000')
    await reconhecer(gestora, id, { itens: [frasco], diferenca: '0' }).expect(400)
    await reconhecer(gestora, id, { itens: [{ itemId: frasco, diferenca: '1' }] }).expect(400)
    await reconhecer(gestora, id, { itens: [] }).expect(400)
    const mais = Array.from({ length: 51 }, () => frasco)
    await reconhecer(gestora, id, { itens: mais }).expect(400)
    expect(await linhasReconhecidas(id)).toHaveLength(0)
  })

  it('é IDEMPOTENTE: repetir 3 vezes mantém 1 registro', async () => {
    const { id } = await abrirEConcluir(frasco, '8000')
    const a = await reconhecer(gestora, id, { itens: [frasco] }).expect(200)
    const b = await reconhecer(gestora, id, { itens: [frasco] }).expect(200)
    const c = await reconhecer(gestora, id, { itens: [frasco] }).expect(200)
    expect([a.body.reconhecidas, b.body.reconhecidas, c.body.reconhecidas]).toEqual([1, 0, 0])
    expect([b.body.jaReconhecidas, c.body.jaReconhecidas]).toEqual([1, 1])
    expect(await linhasReconhecidas(id)).toHaveLength(1)
  })

  it('duplo clique CONCORRENTE gera UM registro', async () => {
    const { id } = await abrirEConcluir(frasco, '8000')
    const rs = await Promise.all(
      Array.from({ length: 6 }, () => reconhecer(gestora, id, { itens: [frasco] })),
    )
    for (const r of rs) expect(r.status).toBe(200)
    expect(rs.reduce((s, r) => s + (r.body.reconhecidas as number), 0)).toBe(1)
    expect(await linhasReconhecidas(id)).toHaveLength(1)
  })

  it('exige `estoque.gerir`: a enfermagem (só `estoque`) é 403', async () => {
    const { id } = await abrirEConcluir(frasco, '8000')
    await reconhecer(enfJornada, id, { itens: [frasco] }).expect(403)
    await reconhecer(enfSemJornada, id, { itens: [frasco] }).expect(403)
    expect(await linhasReconhecidas(id)).toHaveLength(0)
  })

  it('só em contagem CONCLUÍDA (409) e só de item DA contagem (422)', async () => {
    const a = await srv()
      .post('/v1/estoque/contagens')
      .set('Cookie', gestora)
      .send({ filtro: 'todos', responsavelId: pessoaGestora, prazo: HOJE })
      .expect(201)
    await reconhecer(gestora, a.body.contagem.id, { itens: [frasco] }).expect(409)

    const { id } = await abrirEConcluir(frasco, '8000')
    const estranho = '00000000-0000-4000-8000-000000000001'
    await reconhecer(gestora, id, { itens: [estranho] }).expect(422)
  })

  it('item SEM diferença (contado = esperado) não tem o que reconhecer: 422', async () => {
    const { id } = await abrirEConcluir(frasco, '10000')
    await reconhecer(gestora, id, { itens: [frasco] }).expect(422)
    expect(await linhasReconhecidas(id)).toHaveLength(0)
  })

  it('contagem de OUTRA clínica é 404', async () => {
    const { id } = await abrirEConcluir(frasco, '8000')
    await reconhecer(adminDaOutra, id, { itens: [frasco] }).expect(404)
  })

  it('é APPEND-ONLY: UPDATE e DELETE são recusados, até para o dono', async () => {
    const { id } = await abrirEConcluir(frasco, '8000')
    await reconhecer(gestora, id, { itens: [frasco] }).expect(200)
    await expect(
      migrate.query('UPDATE diferencas_reconhecidas SET diferenca_milesimos = 1 WHERE contagem_id = $1', [id]),
    ).rejects.toThrow(/append-only/)
    await expect(
      migrate.query('DELETE FROM diferencas_reconhecidas WHERE contagem_id = $1', [id]),
    ).rejects.toThrow(/append-only/)
  })

  it('PROPRIEDADE: o saldo é idêntico antes e depois de reconhecer, para qualquer contado e qualquer entrada', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: 40 }), // entrada, em ampolas
        fc.integer({ min: 0, max: 60 }), // contado, em ampolas
        async (entrada, contado) => {
          await apagarMovimentosDeEstoqueDeTeste(migrate, clinica)
          for (const t of ['contado_na_contagem', 'itens_da_contagem', 'contagens_de_estoque', 'tarefas']) {
            await migrate.query(`DELETE FROM ${t} WHERE clinica_id = $1`, [clinica])
          }
          if (entrada > 0) {
            await mover(gestora, {
              itemId: frasco, tipo: 'entrada', quantidade: String(entrada * 1000), unidade: 'ampola', dia: HOJE,
            }).expect(201)
          }
          // Antes de contar, o esperado é 10 + entrada; a contagem do inicial foi apagada acima.
          await migrate.query(
            `INSERT INTO movimentos_de_estoque (clinica_id, item_id, tipo, milesimos, dia)
             VALUES ($1, $2, 'contagem', 10000, $3::date - 1)`,
            [clinica, frasco, HOJE],
          )
          const { id } = await abrirEConcluir(frasco, String(contado * 1000))
          const antes = await saldoDe(frasco)
          const esperado = (10 + entrada) * 1000
          const r = await reconhecer(gestora, id, { itens: [frasco] })
          if (contado * 1000 === esperado) {
            expect(r.status).toBe(422) // nada a reconhecer
          } else {
            expect(r.status).toBe(200)
            expect((await linhasReconhecidas(id))[0]!.diferenca_milesimos).toBe(String(contado * 1000 - esperado))
          }
          expect(await saldoDe(frasco)).toBe(antes)
          expect(antes).toBe(String(contado * 1000))
        },
      ),
      { numRuns: 12 },
    )
  }, 120_000)
})

/* ========================================================================
 * REVISÃO DA FATIA 3 — fuso, drift, suporte, lotes, conversões, líquido
 * ====================================================================== */

const movsDoItem = async (itemId: string): Promise<MovimentoDeEstoque[]> =>
  (
    await migrate.query<{
      id: string
      tipo: string
      milesimos: string
      sequencia: string
      dia: string
      em: Date
      lote: string | null
      compensa_id: string | null
      contagem_id: string | null
    }>(
      `SELECT id, tipo, milesimos::text, sequencia::text, to_char(dia,'YYYY-MM-DD') AS dia, em,
              to_char(lote,'YYYY-MM-DD') AS lote, compensa_id, contagem_id
         FROM movimentos_de_estoque WHERE item_id = $1 ORDER BY dia, em, sequencia`,
      [itemId],
    )
  ).rows.map((l) => ({
    id: l.id,
    sequencia: BigInt(l.sequencia),
    tipo: l.tipo as TipoDeMovimento,
    milesimos: BigInt(l.milesimos),
    dia: l.dia,
    em: l.em.toISOString(),
    lote: l.lote,
    compensaId: l.compensa_id,
    contagemId: l.contagem_id,
  }))

describe('o dia do reconhecimento é o da CLÍNICA (regra 22)', () => {
  it('21h30 em São Paulo (00h30 UTC do dia seguinte) continua no dia 1º — na contagem e na lista', async () => {
    const frasco = (await criarItem(gestora, { ...FRASCO, inicial: { quantidade: '10000' } }).expect(201)).body.id
    const { id } = await abrirEConcluir(frasco, '8000')
    await migrate.query(
      `INSERT INTO diferencas_reconhecidas
         (clinica_id, contagem_id, item_id, diferenca_milesimos, reconhecida_por, em)
       VALUES ($1, $2, $3, -2000, $4, '2026-11-02T00:30:00Z')`,
      [clinica, id, frasco, pessoaGestora],
    )
    const r = await srv().get(`/v1/estoque/contagens/${id}`).set('Cookie', gestora).expect(200)
    expect(r.body.itens[0].diferencaReconhecida.dia).toBe('2026-11-01')
    const lista = await srv().get('/v1/estoque/contagens').set('Cookie', gestora).expect(200)
    expect(lista.body.contagens.find((x: { id: string }) => x.id === id).reconhecidas.dia).toBe('2026-11-01')
  })
})

describe('drift: a diferença reconhecida (congelada) x a de hoje', () => {
  it('um lançamento retroativo entre as contagens muda a de hoje; a congelada fica, e as duas saem', async () => {
    const item = (await criarItem(gestora, { ...FRASCO, nome: 'Drift 5 mg' }).expect(201)).body.id
    await migrate.query(
      `INSERT INTO movimentos_de_estoque (clinica_id, item_id, tipo, milesimos, dia)
       VALUES ($1, $2, 'contagem', 10000, '2026-10-29')`,
      [clinica, item],
    )
    const { id } = await abrirEConcluir(item, '8000') // esperado 10, contado 8 → −2
    const r = await reconhecer(gestora, id, { itens: [item] }).expect(200)
    const antes = r.body.contagem.itens.find((x: { itemId: string }) => x.itemId === item)
    expect(antes.diferencaReconhecida.quantidadeEmEstoque.milesimos).toBe('-2000')
    expect(antes.diferencaReconhecida.hojeEmEstoque.milesimos).toBe('-2000')

    // Entrada RETROATIVA (dia 31/10): cai entre as duas contagens → esperado 11.
    await migrate.query(
      `INSERT INTO movimentos_de_estoque (clinica_id, item_id, tipo, milesimos, dia)
       VALUES ($1, $2, 'entrada', 1000, '2026-10-31')`,
      [clinica, item],
    )
    const v = await srv().get(`/v1/estoque/contagens/${id}`).set('Cookie', gestora).expect(200)
    const depois = v.body.itens.find((x: { itemId: string }) => x.itemId === item)
    expect(depois.diferencaReconhecida.quantidadeEmEstoque.milesimos).toBe('-2000')
    expect(depois.diferencaReconhecida.hojeEmEstoque.milesimos).toBe('-3000')
    expect(depois.diferencaEmEstoque.milesimos).toBe('-3000')
    expect((await linhasReconhecidas(id))[0]!.diferenca_milesimos).toBe('-2000')
  })
})

describe('perfil sem `estoque` e sem `estoque.gerir`', () => {
  it('não reconhece (403) e não lê o Consumo (403)', async () => {
    const frasco = (await criarItem(gestora, { ...FRASCO, inicial: { quantidade: '10000' } }).expect(201)).body.id
    const { id } = await abrirEConcluir(frasco, '8000')
    await reconhecer(soJornada, id, { itens: [frasco] }).expect(403)
    await consumo(soJornada, pacA).expect(403)
    expect(await linhasReconhecidas(id)).toHaveLength(0)
  })
})

describe('sessão de SUPORTE (operador)', () => {
  const SENHA_OP = 'senha-do-operador-do-consumo'
  let operador = ''
  let suporte = ''

  beforeAll(async () => {
    const usuario = `op.consumo.${Date.now()}`
    operador = (
      await migrate.query<{ id: string }>(
        `INSERT INTO operadores (usuario, nome, senha_hash) VALUES ($1, 'Operador', $2) RETURNING id`,
        [usuario, await hashDeSenha(SENHA_OP)],
      )
    ).rows[0]!.id
    const pares = (r: { headers: Record<string, unknown> }): string => {
      const v = r.headers['set-cookie']
      const lista = Array.isArray(v) ? (v as string[]) : typeof v === 'string' ? [v] : []
      return lista.map((x) => x.split(';')[0]!).join('; ')
    }
    const painel = pares(await srv().post('/v1/superadmin/entrar').send({ usuario, senha: SENHA_OP }).expect(200))
    suporte = pares(
      await srv().post(`/v1/superadmin/clinicas/${clinica}/sessao-de-suporte`).set('Cookie', painel).expect(201),
    )
  })
  afterAll(async () => {
    await declararAtorSistema(migrate)
    await migrate.query('DELETE FROM tentativas_de_operador WHERE identificador LIKE $1', ['op.consumo.%'])
    await migrate.query('DELETE FROM sessoes WHERE operador_id = $1', [operador])
    if (operador !== '') await apagarOperadorDeTeste(migrate, operador)
  })

  const acessosDoOperador = async (): Promise<number> =>
    (
      await migrate.query(
        `SELECT 1 FROM auditoria WHERE acao = 'acessou' AND entidade = 'pacientes'
            AND entidade_id = $1 AND ator_tipo = 'operador' AND ator_id = $2`,
        [pacA, operador],
      )
    ).rowCount ?? 0

  it('LÊ o Consumo e a trilha de acesso grava `ator_tipo = operador`', async () => {
    const antes = await acessosDoOperador()
    const r = await srv().get(`/v1/pacientes/${pacA}/consumo`).set('Cookie', suporte)
    expect(r.status, JSON.stringify(r.body)).toBe(200)
    expect(await acessosDoOperador()).toBe(antes + 1)
  })

  it('NÃO reconhece diferença: 403 e nada gravado', async () => {
    const frasco = (await criarItem(gestora, { ...FRASCO, inicial: { quantidade: '10000' } }).expect(201)).body.id
    const { id } = await abrirEConcluir(frasco, '8000')
    const r = await srv()
      .post(`/v1/estoque/contagens/${id}/reconhecer`)
      .set('Cookie', suporte)
      .send({ itens: [frasco] })
    expect(r.status, JSON.stringify(r.body)).toBe(403)
    expect(await linhasReconhecidas(id)).toHaveLength(0)
  })
})

describe('PROPRIEDADE por lote: reconhecer não muda o saldo nem o saldo por lote', () => {
  it('1 a 4 lotes, entradas entre as contagens, qualquer contado', async () => {
    const VALIDADES = ['2027-01-31', '2027-03-31', '2027-06-30', '2027-09-30']
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 4 }),
        fc.array(fc.integer({ min: 1, max: 20 }), { minLength: 4, maxLength: 4 }),
        fc.array(fc.tuple(fc.integer({ min: 0, max: 3 }), fc.integer({ min: 1, max: 10 })), { maxLength: 3 }),
        fc.array(fc.integer({ min: 0, max: 20 }), { minLength: 4, maxLength: 4 }),
        async (n, q1, entradas, q2) => {
          await apagarMovimentosDeEstoqueDeTeste(migrate, clinica)
          for (const t of ['contado_na_contagem', 'itens_da_contagem', 'contagens_de_estoque', 'tarefas', 'itens_de_estoque']) {
            await migrate.query(`DELETE FROM ${t} WHERE clinica_id = $1`, [clinica])
          }
          const item = (await criarItem(gestora, { ...FRASCO, controlaValidade: true }).expect(201)).body.id
          const lotes = VALIDADES.slice(0, n)
          const contar = async (qs: number[]) => {
            const a = await srv()
              .post('/v1/estoque/contagens')
              .set('Cookie', gestora)
              .send({ filtro: 'todos', responsavelId: pessoaGestora, prazo: HOJE })
              .expect(201)
            const id = a.body.contagem.id as string
            await srv()
              .put(`/v1/estoque/contagens/${id}`)
              .set('Cookie', gestora)
              .send({
                itens: [{ itemId: item, lotes: lotes.map((l, i) => ({ lote: l, quantidade: String(qs[i]! * 1000) })) }],
                concluir: true,
                reposicao: false,
              })
              .expect(200)
            return id
          }
          await contar(q1)
          for (const [i, q] of entradas) {
            await mover(gestora, {
              itemId: item, tipo: 'entrada', quantidade: String(q * 1000), unidade: 'ampola',
              dia: HOJE, lote: lotes[i % n]!,
            }).expect(201)
          }
          const id = await contar(q2)

          const ler = async () => {
            const m = await movsDoItem(item)
            return {
              saldo: saldoEmMedida(m, 'ampola').saldo.milesimos,
              lotes: lotesComSaldo(m, 'ampola').map((l) => [l.lote, l.saldo.milesimos]),
              n: m.length,
            }
          }
          const antes = await ler()
          const r = await reconhecer(gestora, id, { itens: [item] })
          expect([200, 422]).toContain(r.status)
          expect(await ler()).toEqual(antes)
        },
      ),
      { numRuns: 10 },
    )
  }, 300_000)
})

describe('Consumo — conversões, limites e líquido (cenários do validador de números)', () => {
  const itemComUso = async (nome: string, fatorUso: string): Promise<string> =>
    (
      await criarItem(gestora, {
        nome,
        medida: 'ampola',
        compra: { tem: true, unidade: 'caixa', fator: '4000' },
        uso: { tem: true, unidade: 'mg', fator: fatorUso },
        aproveitaSobra: true,
        inicial: { quantidade: '1000' },
      }).expect(201)
    ).body.id

  const gastar = (item: string, milesimos: string) =>
    migrate.query(
      `INSERT INTO movimentos_de_estoque (clinica_id, item_id, tipo, milesimos, dia, paciente_id)
       VALUES ($1, $2, 'consumo', $3, $4::date, $5)`,
      [clinica, item, `-${milesimos}`, HOJE, pacA],
    )

  type LinhaT = { item: string; quantidade: { milesimos: string }; quantidadeEmUso: { texto: string } | null }
  const linhaDe = (corpo: { itens: LinhaT[] }, nome: string) => corpo.itens.find((x) => x.item === nome)!

  it('fator de uso 2500: 0,4 ampola = "1 mg"', async () => {
    const i = await itemComUso('Fator 2500', '2500')
    await gastar(i, '400')
    expect(linhaDe((await consumo(gestora, pacA).expect(200)).body, 'Fator 2500').quantidadeEmUso!.texto).toBe('1 mg')
  })

  it('fator de uso 3000: 0,5 = "1,5 mg" e 0,333 = "0,999 mg"', async () => {
    const i = await itemComUso('Fator 3000', '3000')
    await gastar(i, '500')
    await gastar(i, '333')
    const r = await consumo(gestora, pacA).expect(200)
    const textos = (r.body.itens as LinhaT[])
      .filter((x) => x.item === 'Fator 3000')
      .map((x) => x.quantidadeEmUso?.texto)
      .sort()
    expect(textos).toEqual(['0,999 mg', '1,5 mg'])
  })

  it('conversão INEXATA (0,001 ampola, fator 2500) não inventa dose: quantidadeEmUso = null', async () => {
    const i = await itemComUso('Inexato', '2500')
    await gastar(i, '1')
    const l = linhaDe((await consumo(gestora, pacA).expect(200)).body, 'Inexato')
    expect(l.quantidade.milesimos).toBe('1')
    expect(l.quantidadeEmUso).toBeNull()
  })

  it('acima de 2^53 não perde precisão (9007199254740993 milésimos)', async () => {
    const i = await itemComUso('Gigante', '1000')
    await gastar(i, '9007199254740993')
    const r = await consumo(gestora, pacA).expect(200)
    expect(linhaDe(r.body, 'Gigante').quantidade.milesimos).toBe('9007199254740993')
    expect(
      (r.body.liquidoPorItem as { item: string; quantidade: { milesimos: string } }[]).find((x) => x.item === 'Gigante')!
        .quantidade.milesimos,
    ).toBe('9007199254740993')
  })

  it('`liquidoPorItem`: consumo menos estorno, no servidor e sobre o histórico inteiro', async () => {
    const i = await itemComUso('Liquido', '5000')
    await gastar(i, '500')
    await gastar(i, '500')
    const origem = await migrate.query<{ id: string }>(
      `SELECT id FROM movimentos_de_estoque WHERE item_id = $1 AND tipo = 'consumo' LIMIT 1`,
      [i],
    )
    await migrate.query(
      `INSERT INTO movimentos_de_estoque
         (clinica_id, item_id, tipo, milesimos, dia, lote, motivo, obs, compensa_id, compensa_motivo)
       SELECT clinica_id, item_id, tipo, -milesimos, dia, lote, motivo, 'Sessão reaberta', id, 'sessao-reaberta'
         FROM movimentos_de_estoque WHERE id = $1`,
      [origem.rows[0]!.id],
    )
    const r = await consumo(gestora, pacA).expect(200)
    // Somar as 3 linhas ignorando o flag daria 1,5; o líquido é 0,5.
    expect(r.body.itens).toHaveLength(3)
    const liq = (r.body.liquidoPorItem as { item: string; quantidade: { texto: string } }[]).find((x) => x.item === 'Liquido')!
    expect(liq.quantidade.texto).toBe('0,5 ampola')
  })

  it('o líquido cobre as OUTRAS páginas (25 linhas de 0,1 = 2,5 ampolas)', async () => {
    const i = await itemComUso('Paginado', '5000')
    for (let k = 0; k < 25; k++) await gastar(i, '100')
    const r = await consumo(gestora, pacA).expect(200)
    expect(r.body.itens).toHaveLength(20)
    expect(
      (r.body.liquidoPorItem as { item: string; quantidade: { texto: string } }[]).find((x) => x.item === 'Paginado')!
        .quantidade.texto,
    ).toBe('2,5 ampola')
  })
})
