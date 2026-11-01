import type { Relogio } from '@fir/domain'
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify'
import { Test } from '@nestjs/testing'
import pg from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { AppModule } from '../app.module'
import {
  apagarClinicaDeTeste,
  apagarMovimentosDeEstoqueDeTeste,
  declararAtorSistema,
} from '../banco/limpeza-de-teste'
import { hashDeSenha } from '../autenticacao/senha'
import { RELOGIO } from '../comum/relogio'
import { registrarCookie } from '../main'

/**
 * O ESTOQUE pela porta HTTP, contra **Postgres de verdade**.
 *
 * O que só este arquivo pode medir:
 *
 *  1. **O append-only é do BANCO.** Um `UPDATE` em `movimentos_de_estoque` é
 *     recusado mesmo por `fir_migrate`, que é dono e tem BYPASSRLS.
 *  2. **A conversão vem do cadastro** e atravessa o HTTP: a entrada em caixas
 *     soma ampolas, a dose em mg baixa meia ampola.
 *  3. **Unidade não declarada é 422**, nunca uma conversão em silêncio.
 *  4. **A sobra de frasco gera DOIS movimentos** somando o frasco inteiro.
 *  5. **A importação é idempotente três vezes** (regra 26) e **completa, nunca
 *     sobrescreve** (regra 27).
 *  6. **O saldo é derivado** e a última contagem é o ponto de partida.
 */
const URL_MIG =
  process.env['DATABASE_URL_MIGRATE'] ?? 'postgresql://fir_migrate:fir_local_dev@127.0.0.1:4832/fir'

const SENHA = 'montanha-de-vidro-aberta'

/** Fuso FIXADO na clínica, e ele não é o do processo — regra 22. */
const FUSO = 'America/Sao_Paulo'
/** 2026-11-02T02:00:00Z = 1º de novembro, 23h em São Paulo. */
const INICIO = new Date('2026-11-02T02:00:00.000Z')
const relogioDeTeste: Relogio = { agora: () => INICIO }
const HOJE_NA_CLINICA = '2026-11-01'

let app: NestFastifyApplication
let migrate: pg.Client
let clinica: string
let outraClinica: string
let pacienteId: string
let itemDaOutra: string
/** Quem conta: a gestora e a enfermagem, para `responsavelId` da contagem. */
let pessoaDaGestora: string
let pessoaDaEnfermagem: string
const codigo = `est-${Date.now()}`

const entrar = (usuario: string, senha: string, cod = codigo) =>
  request(app.getHttpServer()).post('/v1/entrar').send({ clinica: cod, usuario, senha })

const cookieDe = (r: { headers: Record<string, string> }): string[] => {
  const v = r.headers['set-cookie'] as unknown
  return Array.isArray(v) ? (v as string[]) : typeof v === 'string' ? [v] : []
}

/** Tem `estoque` e `estoque.gerir`. */
let gestora: string[]
/** Tem só `estoque` — a enfermagem. */
let enfermagem: string[]
let adminDaOutra: string[]

const srv = () => request(app.getHttpServer())

const criarItem = (sessao: string[], corpo: Record<string, unknown>) =>
  srv().post('/v1/estoque').set('Cookie', sessao).send(corpo)

const editarItem = (sessao: string[], id: string, corpo: Record<string, unknown>) =>
  srv().patch(`/v1/estoque/${id}`).set('Cookie', sessao).send(corpo)

const listarItens = (sessao: string[]) => srv().get('/v1/estoque').set('Cookie', sessao)

const criarLocal = (sessao: string[], corpo: Record<string, unknown>) =>
  srv().post('/v1/estoque/locais').set('Cookie', sessao).send(corpo)

const mover = (sessao: string[], corpo: Record<string, unknown>) =>
  srv().post('/v1/estoque/movimentos').set('Cookie', sessao).send(corpo)

const importar = (sessao: string[], corpo: Record<string, unknown>) =>
  srv().post('/v1/estoque/importar').set('Cookie', sessao).send(corpo)

/** O FRASCO do MANUAL: 1 caixa = 4 ampolas, 1 ampola = 5 mg, sem aproveitar sobra. */
const FRASCO = {
  nome: 'Tirzepatida 5 mg',
  medida: 'ampola',
  compra: { tem: true, unidade: 'caixa', fator: '4000' },
  uso: { tem: true, unidade: 'mg', fator: '5000' },
  aproveitaSobra: false,
}

const saldoDe = async (sessao: string[], id: string): Promise<string> => {
  const r = await listarItens(sessao).expect(200)
  const item = (r.body.itens as { id: string; saldoEmEstoque: { milesimos: string } }[]).find(
    (i) => i.id === id,
  )!
  return item.saldoEmEstoque.milesimos
}

beforeAll(async () => {
  migrate = new pg.Client({ connectionString: URL_MIG })
  await migrate.connect()
  await declararAtorSistema(migrate)

  const novaClinica = async (cod: string) =>
    (
      await migrate.query<{ id: string }>(
        `INSERT INTO clinicas (codigo, nome, fuso) VALUES ($1, 'Clínica do Estoque', $2)
         RETURNING id`,
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
  const pfGestora = await perfil(clinica, 'pf_sup', ['estoque', 'estoque.gerir', 'valores'])
  const pfEnf = await perfil(clinica, 'pf_enf', ['estoque'])

  const hash = await hashDeSenha(SENHA)
  const pessoa = async (c: string, nome: string, usuario: string, perfilId: string | null) =>
    migrate.query<{ id: string }>(
      `INSERT INTO pessoas (clinica_id, nome, usuario, senha_hash, admin, perfil_id)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [c, nome, usuario, hash, perfilId === null, perfilId],
    )
  pessoaDaGestora = (await pessoa(clinica, 'Helena Prado', 'helena', pfGestora)).rows[0]!.id
  pessoaDaEnfermagem = (await pessoa(clinica, 'Camila Enf', 'camila', pfEnf)).rows[0]!.id
  await pessoa(outraClinica, 'Vizinha', 'vizinha', null)

  pacienteId = (
    await migrate.query<{ id: string }>(
      `INSERT INTO pacientes (clinica_id, nome) VALUES ($1, 'Fernanda Teste') RETURNING id`,
      [clinica],
    )
  ).rows[0]!.id

  itemDaOutra = (
    await migrate.query<{ id: string }>(
      `INSERT INTO itens_de_estoque (clinica_id, nome, medida) VALUES ($1, 'Item da Vizinha', 'un.')
       RETURNING id`,
      [outraClinica],
    )
  ).rows[0]!.id

  const mod = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(RELOGIO)
    .useValue(relogioDeTeste)
    .compile()
  app = mod.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
  await registrarCookie(app)
  await app.init()
  await app.getHttpAdapter().getInstance().ready()

  gestora = cookieDe(await entrar('helena', SENHA).expect(200))
  enfermagem = cookieDe(await entrar('camila', SENHA).expect(200))
  adminDaOutra = cookieDe(await entrar('vizinha', SENHA, `${codigo}-b`).expect(200))
})

afterAll(async () => {
  await apagarClinicaDeTeste(migrate, clinica)
  await apagarClinicaDeTeste(migrate, outraClinica)
  await migrate.end()
  await app.close()
})

beforeEach(async () => {
  /**
   * `movimentos_de_estoque` é APPEND-ONLY **nas duas camadas**: nem `fir_app`
   * nem o DONO conseguem apagar. A limpeza passa por
   * `apagarMovimentosDeEstoqueDeTeste`, que desliga a trigger numa transação —
   * e **precisar dela é a prova de que a trigger funciona**.
   */
  await apagarMovimentosDeEstoqueDeTeste(migrate, clinica)
  /**
   * A ORDEM é a das chaves estrangeiras: o movimento (acima) aponta para o
   * grupo de contagem e para a nota; a contagem aponta para a tarefa; o
   * vínculo e o item da contagem apontam para o item.
   *
   * `tarefas` entra porque `criarContagem` cria a tarefa de quem conta e a
   * conclusão cria a de reposição — deixá-las vivas faria o segundo `it`
   * colidir com o índice `tarefa_de_reposicao_viva` do primeiro.
   */
  for (const tabela of [
    'contado_na_contagem',
    'itens_da_contagem',
    'contagens_de_estoque',
    'tarefas',
    'vinculos_de_nota',
    'notas_de_entrada',
    'itens_de_estoque',
    'locais_de_estoque',
  ]) {
    await migrate.query(`DELETE FROM ${tabela} WHERE clinica_id = $1`, [clinica])
  }
})

describe('salvarItemEstoque — as três unidades e a contagem inicial', () => {
  it('cria com as duas conversões e a contagem inicial, e o SALDO é derivado', async () => {
    const r = await criarItem(gestora, {
      ...FRASCO,
      controlaValidade: true,
      minimo: '2000',
      custo: '45000',
      inicial: { quantidade: '4000', lote: '2027-06-30' },
    })
    expect(r.status).toBe(201)
    expect(r.body.compra).toEqual({ unidade: 'caixa', fator: '4000' })
    expect(r.body.uso).toEqual({ unidade: 'mg', fator: '5000' })

    // O saldo veio do MOVIMENTO de contagem, não de uma coluna.
    expect(r.body.saldoEmEstoque).toEqual({ milesimos: '4000', unidade: 'ampola', texto: '4 ampola' })
    // E o mesmo saldo na unidade de uso: 4 ampolas × 5 mg = 20 mg.
    expect(r.body.saldoEmUso).toEqual({ milesimos: '20000', unidade: 'mg', texto: '20 mg' })
    expect(r.body.semContagem).toBe(false)
    expect(r.body.loteSugerido).toBe('2027-06-30')
    expect(r.body.abaixoDoMinimo).toBe(false)

    // A linha de `itens_de_estoque` NÃO tem coluna de saldo (regra 11).
    const colunas = await migrate.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = 'itens_de_estoque' AND column_name LIKE '%saldo%'`,
    )
    expect(colunas.rows).toEqual([])

    // E a contagem inicial carrega o DIA DA CLÍNICA, não o do processo: às 23h
    // de São Paulo o UTC já virou, e `dia` tem de ser o 1º, não o 2.
    const mov = await migrate.query<{ dia: string; tipo: string; obs: string }>(
      `SELECT to_char(dia, 'YYYY-MM-DD') AS dia, tipo, obs
         FROM movimentos_de_estoque WHERE item_id = $1`,
      [r.body.id],
    )
    expect(mov.rows).toHaveLength(1)
    expect(mov.rows[0]).toMatchObject({ dia: HOJE_NA_CLINICA, tipo: 'contagem', obs: 'Inventário inicial' })
  })

  it('item SEM contagem inicial marca `semContagem` — o aviso do MANUAL', async () => {
    const r = await criarItem(gestora, { nome: 'Seringa 1 ml' }).expect(201)
    expect(r.body.semContagem).toBe(true)
    expect(r.body.saldoEmEstoque.milesimos).toBe('0')
  })

  it('a CONVERSÃO MEIO DECLARADA é 400 — o protótipo a aceita e a descarta', async () => {
    // `unidCompra: 'caixa'` sem fator: a clínica cadastra, não vê erro, e a
    // entrada em caixas simplesmente não aparece como opção.
    await criarItem(gestora, {
      nome: 'Meio cadastrada',
      compra: { tem: true, unidade: 'caixa' },
    }).expect(400)
  })

  it('unidade de compra IGUAL à medida é recusada pelo banco', async () => {
    // `paraMedida` casaria a medida primeiro e o fator nunca seria aplicado —
    // o número gravado dependeria da ordem dos `if`.
    const r = await criarItem(gestora, {
      nome: 'Ambígua',
      medida: 'ampola',
      compra: { tem: true, unidade: 'ampola', fator: '4000' },
    })
    expect(r.status).toBeGreaterThanOrEqual(400)
  })

  it('o PATCH é parcial: desativar não apaga as conversões', async () => {
    const c = await criarItem(gestora, FRASCO).expect(201)
    const r = await editarItem(gestora, c.body.id as string, { ativo: false }).expect(200)
    expect(r.body.ativo).toBe(false)
    expect(r.body.medida).toBe('ampola')
    expect(r.body.compra).toEqual({ unidade: 'caixa', fator: '4000' })
    expect(r.body.uso).toEqual({ unidade: 'mg', fator: '5000' })
  })

  it('nome repetido é 409, ignorando caixa e acento', async () => {
    await criarItem(gestora, { nome: 'Tirzepatida 5 mg' }).expect(201)
    await criarItem(gestora, { nome: 'tirzepatida 5 MG' }).expect(409)
  })

  it('cadastrar exige `estoque.gerir`; LER exige só `estoque`', async () => {
    await listarItens(enfermagem).expect(200)
    await criarItem(enfermagem, { nome: 'Da enfermagem' }).expect(403)
  })

  it('sem `valores`, o CUSTO vem `null` — redação num ponto único (regra 17)', async () => {
    await criarItem(gestora, { nome: 'Com custo', custo: '45000' }).expect(201)
    const r = await listarItens(enfermagem).expect(200)
    const item = (r.body.itens as { nome: string; custo: string | null }[]).find(
      (i) => i.nome === 'Com custo',
    )!
    expect(item.custo).toBeNull()

    // E com `valores`, o número atravessa inteiro.
    const g = await listarItens(gestora).expect(200)
    const comValores = (g.body.itens as { nome: string; custo: string | null }[]).find(
      (i) => i.nome === 'Com custo',
    )!
    expect(comValores.custo).toBe('45000')
  })

  it('a ENFERMAGEM vê a QUANTIDADE e não vê o custo — são coisas diferentes', async () => {
    /**
     * **O defeito que este teste pegou, e ele era meu.**
     *
     * O campo da quantidade em estoque nasceu chamado `saldo`. E `saldo` está
     * em `CAMPOS_MONETARIOS` — por causa do SALDO EM ABERTO da paciente, que é
     * dinheiro. O `RedacaoInterceptor` casa **nome de chave**, em qualquer
     * profundidade, e não olha o tipo do valor: a quantidade em estoque era
     * apagada para quem não tem `valores`, e a tela do estoque da enfermagem
     * mostraria o catálogo inteiro **sem número nenhum**.
     *
     * Nenhuma varredura pegaria isso: `redacao-de-valores` cobra que todo campo
     * MONETÁRIO tenha rota registrada, e não que um campo não-monetário deixe
     * de se chamar como um. É o mesmo caso que `CAMPOS_MONETARIOS` já registra
     * para `resultado` → `resultadoDoMes`: nome genérico em dinheiro é nome que
     * colide.
     *
     * O conserto foi o nome: `saldoEmEstoque`. A redação casa nome EXATO e não
     * prefixo (está escrito lá, de propósito), então ele atravessa.
     */
    const item = await criarItem(gestora, {
      nome: 'Visível para a enfermagem',
      medida: 'ampola',
      uso: { tem: true, unidade: 'mg', fator: '5000' },
      custo: '45000',
      minimo: '2000',
      inicial: { quantidade: '4000' },
    }).expect(201)

    const r = await listarItens(enfermagem).expect(200)
    const vista = (r.body.itens as { id: string; custo: unknown; saldoEmEstoque: { milesimos: string; texto: string } | null; saldoEmUso: { texto: string } | null; minimo: unknown }[])
      .find((i) => i.id === item.body.id)!

    // A QUANTIDADE atravessa: é a dose que ela precisa aplicar.
    expect(vista.saldoEmEstoque).not.toBeNull()
    expect(vista.saldoEmEstoque!.milesimos).toBe('4000')
    expect(vista.saldoEmEstoque!.texto).toBe('4 ampola')
    expect(vista.saldoEmUso!.texto).toBe('20 mg')
    // O MÍNIMO também: ele é quantidade, não dinheiro.
    expect(vista.minimo).toBe('2000')
    // E o CUSTO não: esse é dinheiro.
    expect(vista.custo).toBeNull()
  })

  it('mínimo NULO nunca fica "abaixo do mínimo" — nem com saldo negativo', async () => {
    /**
     * **Encontrado por mutação:** `minimo !== null && saldo < minimo` e
     * `saldo < (minimo ?? 0n)` davam o mesmo resultado em todos os casos que os
     * outros testes exercitavam — e divergem exatamente aqui, no saldo
     * NEGATIVO de um item sem mínimo declarado.
     *
     * Com o `?? 0n`, esse item geraria tarefa de reposição. O problema dele não
     * é o mínimo (que ninguém definiu): é o negativo, que a análise do estoque
     * explica. `null` é "este item não tem mínimo", e não "o mínimo é zero".
     */
    const sem = await criarItem(gestora, {
      nome: 'Sem mínimo',
      controlaValidade: true,
      inicial: { quantidade: '0', lote: null },
    }).expect(201)
    expect(sem.body.minimo).toBeNull()
    expect(sem.body.abaixoDoMinimo).toBe(false)

    await mover(gestora, {
      itemId: sem.body.id, tipo: 'entrada', quantidade: '1000', unidade: 'un.',
      dia: HOJE_NA_CLINICA, lote: '2027-06-30',
    }).expect(201)
    await mover(gestora, {
      itemId: sem.body.id, tipo: 'descarte', quantidade: '3000', unidade: 'un.',
      dia: HOJE_NA_CLINICA, lote: '2027-06-30', motivo: 'Vencido',
    }).expect(201)

    const r = await listarItens(gestora).expect(200)
    const item = (r.body.itens as { nome: string; saldoEmEstoque: { milesimos: string }; abaixoDoMinimo: boolean }[])
      .find((i) => i.nome === 'Sem mínimo')!
    expect(item.saldoEmEstoque.milesimos).toBe('-2000')
    expect(item.abaixoDoMinimo).toBe(false)
  })

  it('mínimo DECLARADO como zero é respeitado — zero não é "sem mínimo"', async () => {
    const z = await criarItem(gestora, { nome: 'Mínimo zero', minimo: '0' }).expect(201)
    expect(z.body.minimo).toBe('0')
    // Saldo zero NÃO está abaixo de zero: a fronteira é estrita.
    expect(z.body.abaixoDoMinimo).toBe(false)
  })

  it('o ITEM DA VIZINHA é 404 — RLS, não filtro de aplicação', async () => {
    await editarItem(gestora, itemDaOutra, { nome: 'Tomado' }).expect(404)
    const l = await listarItens(adminDaOutra).expect(200)
    expect((l.body.itens as { nome: string }[]).map((i) => i.nome)).toEqual(['Item da Vizinha'])
  })
})

describe('salvarLocalEstoque', () => {
  it('cria, conta os itens e recusa nome repetido na MESMA unidade', async () => {
    const g = await criarLocal(gestora, { nome: 'Geladeira' }).expect(201)
    expect(g.body).toMatchObject({ nome: 'Geladeira', unidadeId: null, ativo: true, itens: 0 })

    // `NULLS NOT DISTINCT`: duas "Geladeira" sem unidade colidem, e a clínica
    // de um endereço só é justamente a que teria duas.
    await criarLocal(gestora, { nome: 'geladeira' }).expect(409)

    await criarItem(gestora, { nome: 'Na geladeira', localId: g.body.id }).expect(201)
    const r = await srv().get('/v1/estoque/locais').set('Cookie', gestora).expect(200)
    expect((r.body.locais as { nome: string; itens: number }[])[0]).toMatchObject({
      nome: 'Geladeira',
      itens: 1,
    })
  })

  it('cadastrar local exige `estoque.gerir`', async () => {
    await criarLocal(enfermagem, { nome: 'Da enfermagem' }).expect(403)
    await srv().get('/v1/estoque/locais').set('Cookie', enfermagem).expect(200)
  })
})

describe('movEstoque — a conversão, o sinal e a sobra', () => {
  let frasco: string

  beforeEach(async () => {
    const r = await criarItem(gestora, {
      ...FRASCO,
      controlaValidade: true,
      inicial: { quantidade: '0', lote: null },
    }).expect(201)
    frasco = r.body.id as string
  })

  it('ENTRADA EM CAIXAS soma AMPOLAS — a conversão vem do cadastro', async () => {
    const r = await mover(gestora, {
      itemId: frasco,
      tipo: 'entrada',
      quantidade: '2000',
      unidade: 'caixa',
      dia: HOJE_NA_CLINICA,
      lote: '2027-06-30',
      custo: '45000',
    })
    expect(r.status).toBe(201)
    // 2 caixas × 4 ampolas = 8 ampolas. Nunca "2".
    expect(r.body.movimentos[0].quantidade).toEqual({
      milesimos: '8000',
      unidade: 'ampola',
      texto: '8 ampola',
    })
    expect(await saldoDe(gestora, frasco)).toBe('8000')
  })

  it('UNIDADE NÃO DECLARADA é 422, com a frase que lista as unidades do item', async () => {
    const r = await mover(gestora, {
      itemId: frasco,
      tipo: 'entrada',
      quantidade: '20000',
      unidade: 'UI',
      dia: HOJE_NA_CLINICA,
      lote: '2027-06-30',
    })
    expect(r.status).toBe(422)
    expect(r.body.codigo).toBe('UnidadeNaoDeclarada')
    expect(r.body.message).toContain('ampola')
    expect(r.body.message).toContain('mg')
    // E NADA foi gravado.
    expect(await saldoDe(gestora, frasco)).toBe('0')
  })

  it('CONSUMO de 2,5 mg gera DOIS movimentos somando o FRASCO INTEIRO (regra 15)', async () => {
    await mover(gestora, {
      itemId: frasco,
      tipo: 'entrada',
      quantidade: '4000',
      unidade: 'ampola',
      dia: HOJE_NA_CLINICA,
      lote: '2027-06-30',
    }).expect(201)

    const r = await mover(enfermagem, {
      itemId: frasco,
      tipo: 'consumo',
      quantidade: '2500',
      unidade: 'mg',
      dia: HOJE_NA_CLINICA,
      pacienteId,
    })
    expect(r.status).toBe(201)

    const ms = r.body.movimentos as { tipo: string; quantidade: { milesimos: string }; motivo: string; lote: string }[]
    expect(ms.map((m) => m.tipo)).toEqual(['consumo', 'descarte'])
    // 0,5 ampola na paciente + 0,5 ampola de sobra = UMA ampola saiu.
    expect(ms.map((m) => m.quantidade.milesimos)).toEqual(['-500', '-500'])
    expect(ms[1]!.motivo).toBe('Sobra de frasco aberto')
    // MESMO LOTE: a sobra é do frasco que foi aberto.
    expect(new Set(ms.map((m) => m.lote))).toEqual(new Set(['2027-06-30']))
    expect(await saldoDe(gestora, frasco)).toBe('3000')
  })

  it('o DESCARTE da sobra não leva o paciente — ela não foi aplicada em ninguém', async () => {
    await mover(gestora, {
      itemId: frasco,
      tipo: 'entrada',
      quantidade: '4000',
      unidade: 'ampola',
      dia: HOJE_NA_CLINICA,
      lote: '2027-06-30',
    }).expect(201)
    await mover(enfermagem, {
      itemId: frasco,
      tipo: 'consumo',
      quantidade: '2500',
      unidade: 'mg',
      dia: HOJE_NA_CLINICA,
      pacienteId,
    }).expect(201)

    // Pôr o paciente no descarte diria, na ficha dela, que recebeu o dobro.
    const l = await migrate.query<{ tipo: string; paciente_id: string | null }>(
      `SELECT tipo, paciente_id FROM movimentos_de_estoque
        WHERE item_id = $1 AND tipo IN ('consumo','descarte') ORDER BY sequencia`,
      [frasco],
    )
    expect(l.rows.map((x) => [x.tipo, x.paciente_id !== null])).toEqual([
      ['consumo', true],
      ['descarte', false],
    ])
  })

  it('dose EXATA de 5 mg gera UM movimento — nenhum descarte de zero', async () => {
    await mover(gestora, {
      itemId: frasco,
      tipo: 'entrada',
      quantidade: '4000',
      unidade: 'ampola',
      dia: HOJE_NA_CLINICA,
      lote: '2027-06-30',
    }).expect(201)
    const r = await mover(enfermagem, {
      itemId: frasco,
      tipo: 'consumo',
      quantidade: '5000',
      unidade: 'mg',
      dia: HOJE_NA_CLINICA,
      pacienteId,
    }).expect(201)
    expect((r.body.movimentos as unknown[]).length).toBe(1)
    expect(await saldoDe(gestora, frasco)).toBe('3000')
  })

  it('o AJUSTE exige `estoque.gerir`, motivo e SENTIDO em palavras', async () => {
    const base = {
      itemId: frasco,
      tipo: 'ajuste',
      quantidade: '1000',
      unidade: 'ampola',
      dia: HOJE_NA_CLINICA,
      lote: '2027-06-30',
      motivo: 'Correção de lançamento',
    }
    // MANUAL: "Ajuste de estoque — só administrativo" (regra 13).
    await mover(enfermagem, { ...base, sentido: 'faltou' }).expect(400)
    // Sem `sentido`, 400: no protótipo um corpo sem `sinal` TIRA do estoque,
    // porque `Number(undefined)===1` é falso e o `else` é −1.
    await mover(gestora, base).expect(400)
    // Sem motivo, 400 (regra 13: ajuste manual exige motivo).
    await mover(gestora, { ...base, sentido: 'faltou', motivo: '' }).expect(400)

    await mover(gestora, { ...base, sentido: 'sobrou' }).expect(201)
    expect(await saldoDe(gestora, frasco)).toBe('1000')
    await mover(gestora, { ...base, sentido: 'faltou' }).expect(201)
    expect(await saldoDe(gestora, frasco)).toBe('0')
  })

  it('DATA FUTURA é recusada, pelo dia do SERVIDOR no fuso da clínica', async () => {
    const r = await mover(gestora, {
      itemId: frasco,
      tipo: 'entrada',
      quantidade: '1000',
      unidade: 'ampola',
      dia: '2026-11-02',
      lote: '2027-06-30',
    })
    expect(r.status).toBe(422)
    // E a mensagem diz o dia da CLÍNICA, que às 23h de São Paulo é o 1º —
    // o UTC já virou. Com `America/Bahia` fixo, ou com o relógio do
    // navegador, esta data passaria.
    expect(r.body.message).toContain(HOJE_NA_CLINICA)
  })

  it('ENTRADA em item que controla validade EXIGE o lote', async () => {
    const r = await mover(gestora, {
      itemId: frasco,
      tipo: 'entrada',
      quantidade: '1000',
      unidade: 'ampola',
      dia: HOJE_NA_CLINICA,
    })
    expect(r.status).toBe(422)
    expect(r.body.message).toContain('vencimento')
  })

  it('SAÍDA sem lote usa o FIFO de validade — o que vence primeiro', async () => {
    await mover(gestora, {
      itemId: frasco, tipo: 'entrada', quantidade: '1000', unidade: 'ampola',
      dia: HOJE_NA_CLINICA, lote: '2027-06-30',
    }).expect(201)
    await mover(gestora, {
      itemId: frasco, tipo: 'entrada', quantidade: '1000', unidade: 'ampola',
      dia: HOJE_NA_CLINICA, lote: '2026-12-31',
    }).expect(201)

    const r = await mover(gestora, {
      itemId: frasco, tipo: 'descarte', quantidade: '1000', unidade: 'ampola',
      dia: HOJE_NA_CLINICA, motivo: 'Vencido',
    }).expect(201)
    expect(r.body.movimentos[0].lote).toBe('2026-12-31')

    // Esgotado o primeiro, o seguinte assume.
    const outro = await mover(gestora, {
      itemId: frasco, tipo: 'descarte', quantidade: '1000', unidade: 'ampola',
      dia: HOJE_NA_CLINICA, motivo: 'Vencido',
    }).expect(201)
    expect(outro.body.movimentos[0].lote).toBe('2027-06-30')
  })

  it('a CONTAGEM é o PONTO DE PARTIDA: o que veio antes dela não soma mais', async () => {
    await mover(gestora, {
      itemId: frasco, tipo: 'entrada', quantidade: '10000', unidade: 'ampola',
      dia: HOJE_NA_CLINICA, lote: '2027-06-30',
    }).expect(201)
    expect(await saldoDe(gestora, frasco)).toBe('10000')

    // A equipe foi à prateleira e achou 4. É isso que vale.
    await mover(gestora, {
      itemId: frasco, tipo: 'contagem', quantidade: '4000', unidade: 'ampola',
      dia: HOJE_NA_CLINICA, lote: '2027-06-30',
    }).expect(201)
    expect(await saldoDe(gestora, frasco)).toBe('4000')
  })

  it('o SALDO NEGATIVO aparece — o protótipo o clampa em zero e esconde o incidente', async () => {
    await mover(gestora, {
      itemId: frasco, tipo: 'descarte', quantidade: '2000', unidade: 'ampola',
      dia: HOJE_NA_CLINICA, lote: null, motivo: 'Vencido',
    }).expect(422) // sem lote com saldo, a saída é recusada

    // Com lote e sem estoque, o negativo é a informação: mais saída registrada
    // do que havia significa lançamento duplicado ou contagem errada.
    await mover(gestora, {
      itemId: frasco, tipo: 'entrada', quantidade: '1000', unidade: 'ampola',
      dia: HOJE_NA_CLINICA, lote: '2027-06-30',
    }).expect(201)
    await mover(gestora, {
      itemId: frasco, tipo: 'descarte', quantidade: '3000', unidade: 'ampola',
      dia: HOJE_NA_CLINICA, lote: '2027-06-30', motivo: 'Vencido',
    }).expect(201)
    expect(await saldoDe(gestora, frasco)).toBe('-2000')
  })

  it('o CUSTO de entrada exige `estoque.gerir`', async () => {
    await mover(enfermagem, {
      itemId: frasco, tipo: 'entrada', quantidade: '1000', unidade: 'ampola',
      dia: HOJE_NA_CLINICA, lote: '2027-06-30', custo: '45000',
    }).expect(400)
    // E sem custo, a enfermagem lança a entrada normalmente.
    await mover(enfermagem, {
      itemId: frasco, tipo: 'entrada', quantidade: '1000', unidade: 'ampola',
      dia: HOJE_NA_CLINICA, lote: '2027-06-30',
    }).expect(201)
  })

  it('CAMPO DE OUTRO RAMO é 400 — a união discriminada fecha a porta', async () => {
    // No protótipo, `custo` num consumo é descartado em silêncio.
    await mover(gestora, {
      itemId: frasco, tipo: 'consumo', quantidade: '1000', unidade: 'ampola',
      dia: HOJE_NA_CLINICA, pacienteId, custo: '45000',
    }).expect(400)
    // E `consumo` sem paciente é 400: "uso interno" tem tipo próprio.
    await mover(gestora, {
      itemId: frasco, tipo: 'consumo', quantidade: '1000', unidade: 'ampola',
      dia: HOJE_NA_CLINICA,
    }).expect(400)
  })

  it('MOVIMENTO É APPEND-ONLY — e é o BANCO que recusa, até para o dono', async () => {
    await mover(gestora, {
      itemId: frasco, tipo: 'entrada', quantidade: '1000', unidade: 'ampola',
      dia: HOJE_NA_CLINICA, lote: '2027-06-30',
    }).expect(201)

    /**
     * `fir_migrate` é DONO da tabela e tem BYPASSRLS: o `REVOKE` não o alcança.
     * Quem o recusa é a trigger `movimentos_sem_update` — e sem ela, um
     * `UPDATE` numa migration de dados ou num psql às duas da manhã passaria
     * sem aviso nenhum.
     */
    await expect(
      migrate.query(`UPDATE movimentos_de_estoque SET milesimos = 0 WHERE item_id = $1`, [frasco]),
    ).rejects.toThrow(/append-only/)
    await expect(
      migrate.query(`DELETE FROM movimentos_de_estoque WHERE item_id = $1`, [frasco]),
    ).rejects.toThrow(/append-only/)
    expect(await saldoDe(gestora, frasco)).toBe('1000')
  })

  it('a escrita entra na TRILHA pelo trigger', async () => {
    const r = await mover(gestora, {
      itemId: frasco, tipo: 'entrada', quantidade: '1000', unidade: 'ampola',
      dia: HOJE_NA_CLINICA, lote: '2027-06-30',
    }).expect(201)
    const t = await migrate.query<{ para: Record<string, unknown> }>(
      `SELECT para FROM auditoria
        WHERE clinica_id = $1 AND entidade = 'movimentos_de_estoque' AND entidade_id = $2`,
      [clinica, r.body.movimentos[0].id],
    )
    expect(t.rows).toHaveLength(1)
    // A trilha grava o jsonb da linha, e `bigint` vira NÚMERO no jsonb do
    // Postgres — não texto. Nenhuma conta é feita sobre ele: a trilha é para
    // LER, e `1000` aqui é o que a coluna tinha.
    expect(t.rows[0]!.para['milesimos']).toBe(1000)
  })
})

describe('importarItensEstoque — idempotente (regra 26) e sem sobrescrever (regra 27)', () => {
  const PLANILHA = {
    linhas: [
      { nome: 'Tirzepatida 5 mg', codigo: 'TZ5', categoria: 'Injetáveis', medida: 'ampola', local: 'Geladeira', custo: '45000' },
      { nome: 'Seringa 1 ml', codigo: 'SR1', categoria: 'Descartáveis', medida: 'un.', local: 'Sala de estoque' },
      { nome: '', codigo: 'VAZIO' },
    ],
  }

  it('TRÊS IMPORTAÇÕES do mesmo arquivo criam os itens UMA vez', async () => {
    const primeira = await importar(gestora, PLANILHA).expect(200)
    expect(primeira.body).toMatchObject({
      novos: 2,
      completados: 0,
      ignoradas: 1,
      locaisCriados: 2,
    })

    for (const volta of [2, 3]) {
      const r = await importar(gestora, PLANILHA).expect(200)
      expect(r.body, `volta ${volta}`).toMatchObject({
        novos: 0,
        completados: 0,
        locaisCriados: 0,
      })
    }

    const l = await listarItens(gestora).expect(200)
    expect((l.body.itens as { nome: string }[]).map((i) => i.nome).sort()).toEqual([
      'Seringa 1 ml',
      'Tirzepatida 5 mg',
    ])
    const locais = await srv().get('/v1/estoque/locais').set('Cookie', gestora).expect(200)
    expect((locais.body.locais as unknown[]).length).toBe(2)
  })

  it('o aviso "sem contagem inicial" conta os itens importados', async () => {
    const r = await importar(gestora, PLANILHA).expect(200)
    // A importação vem SEM quantidades (MANUAL cap. 12), então os dois itens
    // nascem sem contagem — e é esse número que o botão "Gerar contagem
    // inicial" usa.
    expect(r.body.semContagem).toBe(2)
  })

  it('COMPLETA o campo vazio e NUNCA sobrescreve o que a clínica digitou', async () => {
    // A clínica cadastrou o item à mão, com custo próprio e sem código.
    const meu = await criarItem(gestora, {
      nome: 'Tirzepatida 5 mg',
      medida: 'ampola',
      custo: '99900',
    }).expect(201)

    const r = await importar(gestora, {
      linhas: [
        { nome: 'Tirzepatida 5 mg', codigo: 'TZ5', categoria: 'Injetáveis', custo: '45000' },
      ],
    }).expect(200)
    expect(r.body).toMatchObject({ novos: 0, completados: 1 })

    const l = await listarItens(gestora).expect(200)
    const item = (l.body.itens as { id: string; codigo: string; categoria: string; custo: string }[]).find(
      (i) => i.id === meu.body.id,
    )!
    // O vazio foi COMPLETADO…
    expect(item.codigo).toBe('TZ5')
    expect(item.categoria).toBe('Injetáveis')
    // …e o que já estava lá NÃO foi tocado (regra 27).
    expect(item.custo).toBe('99900')
  })

  it('importar exige `estoque.gerir`', async () => {
    await importar(enfermagem, PLANILHA).expect(403)
  })

  it('a importação de uma clínica NÃO alcança a outra', async () => {
    await importar(gestora, PLANILHA).expect(200)
    const l = await listarItens(adminDaOutra).expect(200)
    expect((l.body.itens as { nome: string }[]).map((i) => i.nome)).toEqual(['Item da Vizinha'])
  })
})

/* ==========================================================================
 * A CONTAGEM ÀS CEGAS — `criarContagem` e `salvarContagem`
 * ========================================================================== */

const criarContagem = (sessao: string[], corpo: Record<string, unknown>) =>
  srv().post('/v1/estoque/contagens').set('Cookie', sessao).send(corpo)

const verContagem = (sessao: string[], id: string) =>
  srv().get(`/v1/estoque/contagens/${id}`).set('Cookie', sessao)

const salvarContagem = (sessao: string[], id: string, corpo: Record<string, unknown>) =>
  srv().put(`/v1/estoque/contagens/${id}`).set('Cookie', sessao).send(corpo)

/** O id da contagem, e os itens que ela pede para contar. */
const abrirContagem = async (
  sessao: string[],
  corpo: Record<string, unknown> = {},
): Promise<{ id: string; itens: { itemId: string; nome: string }[] }> => {
  const r = await criarContagem(sessao, {
    filtro: 'todos',
    responsavelId: pessoaDaGestora,
    prazo: HOJE_NA_CLINICA,
    ...corpo,
  }).expect(201)
  return { id: r.body.contagem.id, itens: r.body.contagem.itens }
}

describe('criarContagem e salvarContagem — a contagem ÀS CEGAS (regra 14)', () => {
  let frasco: string

  beforeEach(async () => {
    const r = await criarItem(gestora, {
      nome: 'Tirzepatida 5 mg',
      medida: 'ampola',
      custo: '45000',
      minimo: '4000',
      inicial: { quantidade: '10000' },
    }).expect(201)
    frasco = r.body.id
  })

  it('o ESPERADO não atravessa enquanto a contagem está ABERTA', async () => {
    await mover(gestora, {
      itemId: frasco, tipo: 'entrada', quantidade: '4000', unidade: 'ampola',
      dia: HOJE_NA_CLINICA,
    }).expect(201)

    const { id } = await abrirContagem(gestora)
    const r = await verContagem(gestora, id).expect(200)

    expect(r.body.concluida).toBe(false)
    // O que a pessoa precisa para contar está lá…
    expect(r.body.itens[0]).toMatchObject({ itemId: frasco, nome: 'Tirzepatida 5 mg', medida: 'ampola' })
    // …e o esperado NÃO EXISTE. Nem como `null`: um campo redigido conta ao
    // cliente que existe um número ali, e o próximo refactor o "conserta".
    for (const chave of ['esperadoEmEstoque', 'anteriorEmEstoque', 'diferencaEmEstoque', 'saldoEmEstoque']) {
      expect(Object.keys(r.body.itens[0]), chave).not.toContain(chave)
    }
    // E o NÚMERO não aparece sob nome nenhum: 14 = 10 + 4, e ele não existe em
    // nenhum movimento individual.
    expect(r.text).not.toContain('14000')
  })

  it('a ENFERMAGEM conta: a lista pede `estoque`, não `estoque.gerir`', async () => {
    // O ritual é dela — exigir `estoque.gerir` aqui mataria o produto. O que
    // exige a chave é `movEstoque` com `tipo: contagem`, que é a gestão
    // reescrevendo o saldo à mão, sem lista e sem cegueira.
    const r = await criarContagem(enfermagem, {
      filtro: 'todos',
      responsavelId: pessoaDaEnfermagem,
      prazo: HOJE_NA_CLINICA,
    }).expect(201)
    const id = r.body.contagem.id as string
    await salvarContagem(enfermagem, id, {
      itens: [{ itemId: frasco, lotes: [{ lote: null, quantidade: '9000' }] }],
      concluir: true,
      reposicao: false,
    }).expect(200)
    expect(await saldoDe(enfermagem, frasco)).toBe('9000')
  })

  it('a DIFERENÇA é RELATADA e NUNCA corrigida (regra 13)', async () => {
    await mover(gestora, {
      itemId: frasco, tipo: 'entrada', quantidade: '4000', unidade: 'ampola',
      dia: HOJE_NA_CLINICA,
    }).expect(201)
    await mover(gestora, {
      itemId: frasco, tipo: 'consumo', quantidade: '1000', unidade: 'ampola',
      dia: HOJE_NA_CLINICA, pacienteId,
    }).expect(201)

    const { id } = await abrirContagem(gestora)
    const r = await salvarContagem(gestora, id, {
      itens: [{ itemId: frasco, lotes: [{ lote: null, quantidade: '12000' }] }],
      concluir: true,
      reposicao: false,
    }).expect(200)

    const item = r.body.contagem.itens[0]
    expect(r.body.contagem.concluida).toBe(true)
    expect(item.anteriorEmEstoque.milesimos).toBe('10000')
    expect(item.entradasEmEstoque.milesimos).toBe('4000')
    expect(item.saidasEmEstoque.milesimos).toBe('1000')
    // 10 + 4 − 1 = 13 esperado, 12 contado: falta 1 ampola.
    expect(item.esperadoEmEstoque.milesimos).toBe('13000')
    expect(item.contadoEmEstoque.milesimos).toBe('12000')
    expect(item.diferencaEmEstoque.milesimos).toBe('-1000')
    expect(r.body.contagem.itensComFalta).toBe(1)
    // 1 ampola × R$ 450,00
    expect(r.body.contagem.valorDaFalta).toBe('45000')

    // **NENHUM AJUSTE NASCEU.** É a regra 13 inteira: corrigir a diferença
    // destruiria a única informação que justifica contar o estoque.
    const ajustes = await migrate.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM movimentos_de_estoque
        WHERE item_id = $1 AND tipo = 'ajuste'`,
      [frasco],
    )
    expect(ajustes.rows[0]!.n).toBe('0')
    // E o saldo passa a ser o CONTADO: a contagem é o novo ponto de partida.
    expect(await saldoDe(gestora, frasco)).toBe('12000')
  })

  it('o item COM VALIDADE é contado por LOTE, e as linhas são UM grupo', async () => {
    const comLote = await criarItem(gestora, {
      nome: 'Toxina botulínica 100 UI',
      medida: 'frasco',
      controlaValidade: true,
      inicial: { quantidade: '1000', lote: '2027-03-31' },
    }).expect(201)
    const itemId = comLote.body.id as string

    const { id } = await abrirContagem(gestora)
    const r = await salvarContagem(gestora, id, {
      itens: [
        {
          itemId,
          lotes: [
            { lote: '2027-06-30', quantidade: '2000' },
            { lote: '2027-09-30', quantidade: '1000' },
          ],
        },
      ],
      concluir: true,
      reposicao: false,
    }).expect(200)

    const item = (r.body.contagem.itens as { itemId: string; contadoEmEstoque: { milesimos: string } }[])
      .find((i) => i.itemId === itemId)!
    // O TOTAL do grupo: 2 + 1. Sem o grupo, o saldo leria só a última linha e
    // os outros frascos desapareceriam da prateleira sem erro na tela.
    expect(item.contadoEmEstoque.milesimos).toBe('3000')
    expect(await saldoDe(gestora, itemId)).toBe('3000')

    // DUAS linhas de movimento, amarradas pelo MESMO `contagem_id`.
    const movs = await migrate.query<{ lote: string; milesimos: string; contagem_id: string }>(
      `SELECT to_char(lote, 'YYYY-MM-DD') AS lote, milesimos::text AS milesimos, contagem_id
         FROM movimentos_de_estoque
        WHERE item_id = $1 AND tipo = 'contagem' AND contagem_id IS NOT NULL
        ORDER BY lote`,
      [itemId],
    )
    expect(movs.rows).toHaveLength(2)
    expect(movs.rows.map((m) => [m.lote, m.milesimos])).toEqual([
      ['2027-06-30', '2000'],
      ['2027-09-30', '1000'],
    ])
    expect(movs.rows[0]!.contagem_id).toBe(movs.rows[1]!.contagem_id)
    expect(movs.rows[0]!.contagem_id).toBe(id)

    // E o FIFO passa a ser o do que foi ACHADO: o lote de março, que ninguém
    // encontrou, deixa de ser oferecido para a próxima dose.
    const l = await listarItens(gestora).expect(200)
    const naLista = (l.body.itens as { id: string; loteSugerido: string | null }[]).find(
      (i) => i.id === itemId,
    )!
    expect(naLista.loteSugerido).toBe('2027-06-30')
  })

  it('a TAREFA DE REPOSIÇÃO nasce UMA VEZ por item — o índice garante', async () => {
    const { id } = await abrirContagem(gestora)
    const r = await salvarContagem(gestora, id, {
      // Mínimo 4, contado 2: abaixo.
      itens: [{ itemId: frasco, lotes: [{ lote: null, quantidade: '2000' }] }],
      concluir: true,
      reposicao: true,
    }).expect(200)
    expect(r.body.reposicoes).toBe(1)

    const tarefa = await migrate.query<{ descricao: string; prazo: string }>(
      `SELECT descricao, to_char(prazo, 'YYYY-MM-DD') AS prazo FROM tarefas
        WHERE clinica_id = $1 AND item_de_estoque_id = $2 AND status = 'aberta'`,
      [clinica, frasco],
    )
    expect(tarefa.rows).toHaveLength(1)
    expect(tarefa.rows[0]!.descricao).toBe(
      'Repor estoque: Tirzepatida 5 mg (tem 2 ampola, mínimo 4 ampola)',
    )
    // Dois dias: repor é urgente, mas não é hoje.
    expect(tarefa.rows[0]!.prazo).toBe('2026-11-03')

    // Uma SEGUNDA contagem, com o item ainda abaixo do mínimo, NÃO cria outra
    // tarefa — e quem garante isso é `tarefa_de_reposicao_viva`, não um `if`
    // que perde a corrida entre duas abas.
    const outra = await abrirContagem(gestora)
    const r2 = await salvarContagem(gestora, outra.id, {
      itens: [{ itemId: frasco, lotes: [{ lote: null, quantidade: '1000' }] }],
      concluir: true,
      reposicao: true,
    }).expect(200)
    expect(r2.body.reposicoes).toBe(0)
    const depois = await migrate.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM tarefas
        WHERE clinica_id = $1 AND item_de_estoque_id = $2 AND status = 'aberta'`,
      [clinica, frasco],
    )
    expect(depois.rows[0]!.n).toBe('1')
  })

  it('a ROTINA cria a próxima, e a aritmética de mês é a regra 25', async () => {
    const { id } = await abrirContagem(gestora, { repetir: 'mensal' })
    const r = await salvarContagem(gestora, id, {
      itens: [{ itemId: frasco, lotes: [{ lote: null, quantidade: '9000' }] }],
      concluir: true,
      reposicao: false,
    }).expect(200)
    // Hoje é 01/11 na clínica; um mês depois é 01/12.
    expect(r.body.proximaEm).toBe('2026-12-01')
    expect(r.body.proximaId).not.toBeNull()

    const lista = await srv().get('/v1/estoque/contagens').set('Cookie', gestora).expect(200)
    const abertas = (lista.body.contagens as { concluida: boolean; prazo: string }[]).filter(
      (x) => !x.concluida,
    )
    expect(abertas).toHaveLength(1)
    expect(abertas[0]!.prazo).toBe('2026-12-01')

    // E a próxima também virou TAREFA: é o que faz a contagem voltar a pedir
    // ação sozinha, que é o produto desta ferramenta.
    const tarefas = await migrate.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM tarefas
        WHERE clinica_id = $1 AND prazo = '2026-12-01' AND status = 'aberta'`,
      [clinica],
    )
    expect(tarefas.rows[0]!.n).toBe('1')
  })

  it('concluir DUAS VEZES é 409 — a segunda não reescreve o saldo', async () => {
    const { id } = await abrirContagem(gestora)
    await salvarContagem(gestora, id, {
      itens: [{ itemId: frasco, lotes: [{ lote: null, quantidade: '9000' }] }],
      concluir: true,
      reposicao: false,
    }).expect(200)
    await salvarContagem(gestora, id, {
      itens: [{ itemId: frasco, lotes: [{ lote: null, quantidade: '1000' }] }],
      concluir: true,
      reposicao: false,
    }).expect(409)
    expect(await saldoDe(gestora, frasco)).toBe('9000')
  })

  it('"Salvar e continuar depois" guarda o RASCUNHO e não gera movimento', async () => {
    const { id } = await abrirContagem(gestora)
    const r = await salvarContagem(gestora, id, {
      itens: [{ itemId: frasco, lotes: [{ lote: null, quantidade: '7000' }] }],
      concluir: false,
    }).expect(200)
    expect(r.body.contagem.concluida).toBe(false)
    expect(r.body.contagem.anotados).toBe(1)
    expect(r.body.contagem.itens[0].contadoEmEstoque.milesimos).toBe('7000')
    // O saldo NÃO mudou: o rascunho não é o livro-razão.
    expect(await saldoDe(gestora, frasco)).toBe('10000')

    // E salvar DE NOVO com o mesmo corpo deixa no mesmo estado — `PUT` é
    // idempotente, e é isso que torna seguro o balcão com conexão ruim.
    const outra = await salvarContagem(gestora, id, {
      itens: [{ itemId: frasco, lotes: [{ lote: null, quantidade: '7000' }] }],
      concluir: false,
    }).expect(200)
    expect(outra.body.contagem.itens[0].contadoEmEstoque.milesimos).toBe('7000')
  })

  it('`lotes: []` APAGA o rascunho — limpar o campo não deixa o número velho', async () => {
    /**
     * **O defeito que este teste pegou, e ele era de desenho.**
     *
     * A primeira versão da tela mandava só os itens COM quantidade, e o
     * contrato exigia `lotes` com ao menos uma linha. Com isso, apagar o número
     * de um item não apagava nada no servidor: o rascunho velho ficava, e
     * concluir fechava a contagem com o número que a pessoa tinha acabado de
     * corrigir para vazio.
     *
     * `PUT` é substituição: `lotes: []` apaga, e a tela manda **todos** os
     * itens da lista.
     */
    const { id } = await abrirContagem(gestora)
    await salvarContagem(gestora, id, {
      itens: [{ itemId: frasco, lotes: [{ lote: null, quantidade: '7000' }] }],
      concluir: false,
    }).expect(200)

    const limpo = await salvarContagem(gestora, id, {
      itens: [{ itemId: frasco, lotes: [] }],
      concluir: false,
    }).expect(200)
    expect(limpo.body.contagem.anotados).toBe(0)
    expect(limpo.body.contagem.itens[0].contadoEmEstoque).toBeNull()

    // E concluir sem nenhum item anotado é 422 — não uma contagem vazia que
    // reescreve o saldo para zero.
    await salvarContagem(gestora, id, {
      itens: [{ itemId: frasco, lotes: [] }],
      concluir: true,
    }).expect(422)
    expect(await saldoDe(gestora, frasco)).toBe('10000')
  })

  it('contar ZERO é diferente de não contar: o saldo vai a zero', async () => {
    // "Não achei nada na prateleira" é uma informação, e é a que mais importa
    // num item de alto valor. `lotes: []` seria "ainda não contei".
    const { id } = await abrirContagem(gestora)
    const r = await salvarContagem(gestora, id, {
      itens: [{ itemId: frasco, lotes: [{ lote: null, quantidade: '0' }] }],
      concluir: true,
      reposicao: false,
    }).expect(200)
    expect(r.body.contagem.itens[0].contadoEmEstoque.milesimos).toBe('0')
    expect(r.body.contagem.itens[0].diferencaEmEstoque.milesimos).toBe('-10000')
    expect(await saldoDe(gestora, frasco)).toBe('0')
  })

  it('o filtro `semContagem` acha só os itens que ninguém contou', async () => {
    const novo = await criarItem(gestora, { nome: 'Agulha 13x4,5' }).expect(201)
    const { itens } = await abrirContagem(gestora, { filtro: 'semContagem' })
    expect(itens.map((i) => i.itemId)).toEqual([novo.body.id])
  })

  it('o filtro `altoValor` sai da CURVA ABC do servidor — e vale para a ENFERMAGEM', async () => {
    // O barato: 1 unidade a R$ 1,00. O frasco do `beforeEach` vale 10 × 450.
    await criarItem(gestora, {
      nome: 'Gaze pacote',
      custo: '100',
      inicial: { quantidade: '1000' },
    }).expect(201)

    /**
     * **A razão de o filtro ser do servidor.** A curva ABC depende do CUSTO de
     * todos os itens, e custo é redigido para quem não tem `valores`
     * (regra 17). Resolvido na tela, o filtro "alto valor" da enfermagem
     * chegaria a uma lista de `custo: null` — a curva não existiria, e a lista
     * sairia com o catálogo inteiro.
     */
    const { itens } = await abrirContagem(enfermagem, {
      filtro: 'altoValor',
      responsavelId: pessoaDaEnfermagem,
    })
    expect(itens.map((i) => i.nome)).toEqual(['Tirzepatida 5 mg'])

    // E a letra da curva atravessa na lista, sem o custo.
    const l = await listarItens(enfermagem).expect(200)
    const naLista = (l.body.itens as { nome: string; curvaAbc: string; ehAltoValor: boolean; custo: null }[])
    expect(naLista.find((i) => i.nome === 'Tirzepatida 5 mg')).toMatchObject({
      curvaAbc: 'A',
      ehAltoValor: true,
      custo: null,
    })
    expect(naLista.find((i) => i.nome === 'Gaze pacote')).toMatchObject({
      curvaAbc: 'C',
      ehAltoValor: false,
    })
  })

  it('a lista VAZIA é 422, e a categoria sem filtro de categoria é 422', async () => {
    await criarContagem(gestora, {
      filtro: 'categoria',
      categoria: 'Não existe',
      responsavelId: pessoaDaGestora,
      prazo: HOJE_NA_CLINICA,
    }).expect(422)
    await criarContagem(gestora, {
      filtro: 'todos',
      categoria: 'Injetáveis',
      responsavelId: pessoaDaGestora,
      prazo: HOJE_NA_CLINICA,
    }).expect(422)
  })

  it('o PRAZO no passado é 422, contra o hoje da CLÍNICA (regra 24)', async () => {
    // Às 23h de São Paulo o UTC já virou: um teto calculado em UTC recusaria
    // justamente o dia de hoje da clínica.
    await criarContagem(gestora, {
      filtro: 'todos',
      responsavelId: pessoaDaGestora,
      prazo: '2026-10-31',
    }).expect(422)
    await criarContagem(gestora, {
      filtro: 'todos',
      responsavelId: pessoaDaGestora,
      prazo: HOJE_NA_CLINICA,
    }).expect(201)
  })

  it('a contagem de uma clínica NÃO é vista pela outra', async () => {
    const { id } = await abrirContagem(gestora)
    await verContagem(adminDaOutra, id).expect(404)
    await salvarContagem(adminDaOutra, id, { itens: [], concluir: false }).expect(404)
  })

  it('a ANÁLISE compara duas contagens e mostra a falta do período', async () => {
    await mover(gestora, {
      itemId: frasco, tipo: 'entrada', quantidade: '4000', unidade: 'ampola',
      dia: HOJE_NA_CLINICA,
    }).expect(201)
    const { id } = await abrirContagem(gestora)
    await salvarContagem(gestora, id, {
      itens: [{ itemId: frasco, lotes: [{ lote: null, quantidade: '12000' }] }],
      concluir: true,
      reposicao: false,
    }).expect(200)

    const r = await srv()
      .get('/v1/estoque/analise')
      .query({ de: '2026-10-01', ate: HOJE_NA_CLINICA })
      .set('Cookie', gestora)
      .expect(200)

    const item = (r.body.itens as { itemId: string; esperadoEmEstoque: { milesimos: string } | null; diferencaEmEstoque: { milesimos: string } | null }[])
      .find((i) => i.itemId === frasco)!
    expect(item.esperadoEmEstoque?.milesimos).toBe('14000')
    expect(item.diferencaEmEstoque?.milesimos).toBe('-2000')
    expect(r.body.itensComFalta).toBe(1)
    // 2 ampolas × R$ 450,00
    expect(r.body.valorDaFalta).toBe('90000')
  })
})

/* ==========================================================================
 * `ligarCodigoItem` — o código de barras da caixa
 * ========================================================================== */

const ligarCodigo = (sessao: string[], id: string, gtin: string) =>
  srv().post(`/v1/estoque/${id}/codigo`).set('Cookie', sessao).send({ gtin })

describe('ligarCodigoItem — GS1/EAN, normalizado para 14 dígitos', () => {
  it('o EAN-13 é gravado em 14 dígitos, e a etiqueta QR sai do servidor', async () => {
    const item = await criarItem(gestora, { nome: 'Tirzepatida 5 mg' }).expect(201)
    const r = await ligarCodigo(enfermagem, item.body.id, '7891234567895').expect(201)
    // EAN-13 e GTIN-14 do mesmo produto são o mesmo código: guardá-los sem
    // normalizar faria a leitura do DataMatrix não achar o item cadastrado
    // pelo EAN.
    expect(r.body.gtin).toBe('07891234567895')
    // E o conteúdo da etiqueta vem montado: com ele no navegador, imprimir no
    // desktop e ler no celular dependeria de duas implementações concordarem.
    expect(r.body.codigoQr).toBe(`FRMEST:${codigo}:${item.body.id}`)
  })

  it('o mesmo código em OUTRO item é 409, NOMEANDO o item que já o tem', async () => {
    const a = await criarItem(gestora, { nome: 'Tirzepatida 5 mg' }).expect(201)
    const b = await criarItem(gestora, { nome: 'Tirzepatida 10 mg' }).expect(201)
    await ligarCodigo(gestora, a.body.id, '7891234567895').expect(201)
    const r = await ligarCodigo(gestora, b.body.id, '07891234567895').expect(409)
    // Dizer QUAL item já tem o código é o que permite à pessoa descobrir que
    // leu a caixa errada.
    expect(r.body.message).toContain('Tirzepatida 5 mg')
  })

  it('religar o MESMO código no MESMO item é idempotente', async () => {
    const a = await criarItem(gestora, { nome: 'Tirzepatida 5 mg' }).expect(201)
    await ligarCodigo(gestora, a.body.id, '7891234567895').expect(201)
    const r = await ligarCodigo(gestora, a.body.id, '7891234567895').expect(201)
    expect(r.body.gtin).toBe('07891234567895')
  })

  it('código curto demais é 400 — um "quase" não é código de barras', async () => {
    const a = await criarItem(gestora, { nome: 'Tirzepatida 5 mg' }).expect(201)
    await ligarCodigo(gestora, a.body.id, '1234567').expect(400)
    await ligarCodigo(gestora, a.body.id, 'nao-e-numero').expect(400)
  })

  it('ligar código num item da OUTRA clínica é 404', async () => {
    await ligarCodigo(gestora, itemDaOutra, '7891234567895').expect(404)
  })
})

/* ==========================================================================
 * `entradaNota` — a NF-e, idempotente (regra 26)
 * ========================================================================== */

const lerNota = (sessao: string[], xml: string) =>
  srv().post('/v1/estoque/notas/ler').set('Cookie', sessao).send({ xml })

const registrarNota = (sessao: string[], corpo: Record<string, unknown>) =>
  srv().post('/v1/estoque/notas').set('Cookie', sessao).send(corpo)

const CHAVE = '29261012345678000190550010000123451000123456'

const XML = `<?xml version="1.0" encoding="UTF-8"?><nfeProc><NFe>
<infNFe Id="NFe${CHAVE}">
<ide><nNF>12345</nNF><dhEmi>2026-10-20T10:00:00-03:00</dhEmi></ide>
<emit><CNPJ>12345678000190</CNPJ><xNome>Distribuidora Saúde Nordeste Ltda</xNome><xFant>Saúde Nordeste</xFant></emit>
<det nItem="1"><prod><cProd>MJ5-01</cProd><xProd>TIRZEPATIDA 5MG/0,5ML SOL INJ AMP</xProd><uCom>CX</uCom><qCom>3.0000</qCom><vUnCom>1800.00</vUnCom>
  <rastro><nLote>L2611A</nLote><qLote>2</qLote><dVal>2027-06-30</dVal></rastro>
  <rastro><nLote>L2603C</nLote><qLote>1</qLote><dVal>2027-01-31</dVal></rastro></prod></det>
<det nItem="2"><prod><cProd>FRETE</cProd><xProd>TAXA DE ENTREGA</xProd><uCom>UN</uCom><qCom>1.0000</qCom><vUnCom>25.00</vUnCom></prod></det>
</infNFe></NFe></nfeProc>`

describe('entradaNota — a NF-e, e a idempotência é do ESQUEMA (regra 26)', () => {
  let frasco: string

  beforeEach(async () => {
    /**
     * **SEM contagem inicial, de propósito.** A nota é de 20/10 e o hoje da
     * clínica é 01/11: uma contagem de hoje seria o ponto de partida (regra
     * 11) e as entradas de 20/10 deixariam de somar — o saldo ficaria em zero,
     * corretamente, e o teste mediria a coisa errada. Medido: foi o que
     * aconteceu na primeira escrita deste arquivo.
     */
    const r = await criarItem(gestora, {
      ...FRASCO,
      controlaValidade: true,
      custo: '45000',
    }).expect(201)
    frasco = r.body.id
  })

  const corpoDaNota = (linhas: Record<string, unknown>[]) => ({
    nota: {
      chave: CHAVE,
      numero: '12345',
      fornecedor: 'Saúde Nordeste',
      cnpj: '12345678000190',
      dia: '2026-10-20',
    },
    linhas,
  })

  /** As duas linhas de rastro da Tirzepatida, em caixas de 4 ampolas. */
  const duasLinhas = [
    {
      como: 'nota', itemId: '', quantidade: '2000', unidadeDaNota: 'CX', fator: '4000',
      codigo: 'MJ5-01', descricao: 'TIRZEPATIDA 5MG', lote: '2027-06-30', custoDaNota: '180000',
    },
    {
      como: 'nota', itemId: '', quantidade: '1000', unidadeDaNota: 'CX', fator: '4000',
      codigo: 'MJ5-01', descricao: 'TIRZEPATIDA 5MG', lote: '2027-01-31', custoDaNota: '180000',
    },
  ]

  it('LER o XML casa os produtos pelo NOME e deixa o frete de fora', async () => {
    const r = await lerNota(gestora, XML).expect(200)
    expect(r.body.nota).toMatchObject({
      chave: CHAVE,
      numero: '12345',
      fornecedor: 'Saúde Nordeste',
      cnpj: '12345678000190',
      dia: '2026-10-20',
    })
    expect(r.body.jaRegistrada).toBe(false)
    // Duas linhas de rastro + o frete.
    expect(r.body.linhas).toHaveLength(3)
    const tirzepatida = r.body.linhas.filter((l: { codigo: string }) => l.codigo === 'MJ5-01')
    expect(tirzepatida).toHaveLength(2)
    for (const l of tirzepatida) {
      expect(l.itemId).toBe(frasco)
      /**
       * **`sugestao`, e não `nome` — medido, e o protótipo faz igual.**
       *
       * O item chama-se "Tirzepatida 5 mg"; as palavras que contam são
       * `tirzepatida` e `mg` (o "5" tem uma letra e sai). A nota diz
       * "TIRZEPATIDA 5MG/0,5ML SOL INJ AMP": `tirzepatida` casa, `mg` não casa
       * com `5mg` (o casamento por prefixo exige três letras dos dois lados, e
       * é o que impede `ml` de casar com `mg`). Uma de duas = 50%, que é
       * "sugestão: confira".
       *
       * A tela diz isso à pessoa, e a diferença entre as duas frases é a
       * diferença entre ela conferir e não conferir.
       */
      expect(l.casamento).toBe('sugestao')
      /**
       * O fator sugerido é **1 por 1**, e não as 4 ampolas da caixa.
       *
       * A unidade da nota é `CX` e a unidade de compra do cadastro é `caixa`:
       * elas não casam por nome normalizado. Sugerir o `fatorCompra` aqui
       * seria converter uma unidade pela conversão de OUTRA — a regra 10 ao
       * contrário. A tela pede a confirmação, e o que a clínica confirmar vira
       * vínculo.
       */
      expect(l.fator).toBe('1000')
    }
    // O frete não corresponde a item nenhum, e isso é o certo.
    const frete = r.body.linhas.find((l: { codigo: string }) => l.codigo === 'FRETE')
    expect(frete.itemId).toBeNull()
    expect(frete.casamento).toBe('sem')
  })

  it('TRÊS IMPORTAÇÕES da mesma nota criam os movimentos UMA vez', async () => {
    const corpo = corpoDaNota(duasLinhas.map((l) => ({ ...l, itemId: frasco })))

    const primeira = await registrarNota(gestora, corpo).expect(201)
    expect(primeira.body.jaRegistrada).toBe(false)
    expect(primeira.body.movimentos).toHaveLength(2)
    const ids = (primeira.body.movimentos as { id: string }[]).map((m) => m.id)
    // 2 CX × 4 + 1 CX × 4 = 12 ampolas.
    expect(await saldoDe(gestora, frasco)).toBe('12000')

    for (const volta of [2, 3]) {
      const r = await registrarNota(gestora, corpo).expect(201)
      expect(r.body.jaRegistrada, `volta ${volta}`).toBe(true)
      // Os MESMOS movimentos, com os MESMOS ids. Devolver o resultado — e não
      // um 409 — é o que faz a terceira importação parecer com a primeira:
      // quem apertou duas vezes precisa saber se o estoque entrou.
      expect((r.body.movimentos as { id: string }[]).map((m) => m.id), `volta ${volta}`).toEqual(ids)
      expect(await saldoDe(gestora, frasco), `volta ${volta}`).toBe('12000')
    }

    const n = await migrate.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM movimentos_de_estoque
        WHERE item_id = $1 AND tipo = 'entrada'`,
      [frasco],
    )
    expect(n.rows[0]!.n).toBe('2')
    const notas = await migrate.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM notas_de_entrada WHERE clinica_id = $1',
      [clinica],
    )
    expect(notas.rows[0]!.n).toBe('1')
  })

  it('a CHAVE DE ACESSO sozinha dedupa — sem número, sem emissor, sem nada', async () => {
    /**
     * **Este teste existe porque uma mutação sobreviveu.**
     *
     * Medido: trocar `chave: d.nota.chave` por `chave: null` no `INSERT` —
     * ou seja, jogar fora a chave de acesso da NF-e — **passou verde** no
     * teste das três importações. A razão é que aquela nota também tem
     * `numero` e `cnpj`, e o segundo índice (`emissor + número`) dedupava
     * sozinho. O teste provava "a nota não duplica", não "a chave de acesso é
     * a chave".
     *
     * Aqui o número é vazio e o CNPJ também: **o único índice que pode
     * recusar é o da chave de acesso**. Se ela for ignorada, a segunda
     * importação cria nota nova e o estoque dobra.
     */
    const outraChave = CHAVE.replace('1000123456', '1000555555')
    const corpo = {
      nota: { chave: outraChave, numero: '', fornecedor: '', cnpj: '', dia: '2026-10-20' },
      linhas: [
        {
          como: 'cadastro', itemId: frasco, quantidade: '1000', unidade: 'caixa',
          lote: '2027-06-30',
        },
      ],
    }
    await registrarNota(gestora, corpo).expect(201)
    expect(await saldoDe(gestora, frasco)).toBe('4000')

    for (const volta of [2, 3]) {
      const r = await registrarNota(gestora, corpo).expect(201)
      expect(r.body.jaRegistrada, `volta ${volta}`).toBe(true)
      expect(await saldoDe(gestora, frasco), `volta ${volta}`).toBe('4000')
    }
  })

  it('a nota DIGITADA (sem chave) dedupa por EMISSOR + NÚMERO', async () => {
    // O protótipo não dedupa este caminho, e lançar a nota duas vezes dobra o
    // estoque de um item caro sem nenhum aviso.
    const corpo = {
      nota: { numero: '999', fornecedor: 'Distribuidora da Esquina', cnpj: '', dia: '2026-10-20' },
      linhas: [
        {
          como: 'cadastro', itemId: frasco, quantidade: '2000', unidade: 'caixa',
          lote: '2027-06-30', custo: '45000',
        },
      ],
    }
    const primeira = await registrarNota(gestora, corpo).expect(201)
    expect(primeira.body.jaRegistrada).toBe(false)
    // 2 caixas × 4 ampolas = 8.
    expect(await saldoDe(gestora, frasco)).toBe('8000')

    const segunda = await registrarNota(gestora, corpo).expect(201)
    expect(segunda.body.jaRegistrada).toBe(true)
    expect(await saldoDe(gestora, frasco)).toBe('8000')
  })

  it('o VÍNCULO é gravado, e a nota seguinte do mesmo fornecedor já chega casada', async () => {
    await registrarNota(
      gestora,
      corpoDaNota(duasLinhas.map((l) => ({ ...l, itemId: frasco }))),
    ).expect(201)

    const vinculos = await migrate.query<{ codigo: string; fator: string; item_id: string }>(
      'SELECT codigo, fator::text AS fator, item_id FROM vinculos_de_nota WHERE clinica_id = $1',
      [clinica],
    )
    expect(vinculos.rows).toHaveLength(1)
    expect(vinculos.rows[0]).toMatchObject({ codigo: 'MJ5-01', fator: '4000', item_id: frasco })

    // A SEGUNDA nota do mesmo CNPJ: o casamento vem do vínculo, com o fator
    // que a clínica confirmou — "1 CX = 10 ampolas é conhecimento da clínica,
    // não do código".
    const outra = XML.replace(CHAVE, CHAVE.replace('1000123456', '1000999999')).replace(
      '<nNF>12345</nNF>',
      '<nNF>12346</nNF>',
    )
    const r = await lerNota(gestora, outra).expect(200)
    const linha = r.body.linhas.find((l: { codigo: string }) => l.codigo === 'MJ5-01')
    expect(linha.casamento).toBe('vinculo')
    expect(linha.fator).toBe('4000')
    expect(linha.itemId).toBe(frasco)
  })

  it('o CUSTO que subiu 10% ou mais é avisado, por NOME e sem valor', async () => {
    // O item nasceu com custo de R$ 450,00 por ampola. A nota traz R$ 1.800,00
    // por caixa de 4 = R$ 450,00 por ampola… e 10% acima disso é o que avisa.
    const r = await registrarNota(
      gestora,
      corpoDaNota([
        {
          como: 'nota', itemId: frasco, quantidade: '1000', unidadeDaNota: 'CX', fator: '4000',
          codigo: 'MJ5-01', descricao: 'TIRZEPATIDA', lote: '2027-06-30', custoDaNota: '200000',
        },
      ]),
    ).expect(201)
    // 200000 / 4 = 50000 por ampola, contra 45000: subiu 11%.
    // E o AVISO leva só o NOME. O número continua viajando no `custo` do
    // movimento — que é legítimo e é redigido para quem não tem `valores` —,
    // mas a lista de nomes não é um canal de dinheiro: ela é string, e string
    // nenhuma redação alcança.
    expect(r.body.custoSubiu).toEqual(['Tirzepatida 5 mg'])

    const l = await listarItens(gestora).expect(200)
    const item = (l.body.itens as { id: string; custo: string }[]).find((i) => i.id === frasco)!
    expect(item.custo).toBe('50000')
  })

  it('o item que CONTROLA VALIDADE exige o vencimento do que chegou', async () => {
    await registrarNota(
      gestora,
      corpoDaNota([
        {
          como: 'nota', itemId: frasco, quantidade: '1000', unidadeDaNota: 'CX', fator: '4000',
          codigo: 'MJ5-01', descricao: 'TIRZEPATIDA', custoDaNota: '180000',
        },
      ]),
    ).expect(422)
    expect(await saldoDe(gestora, frasco)).toBe('0')
  })

  it('a unidade que o item NÃO declarou é 422, nunca uma conversão em silêncio', async () => {
    const r = await registrarNota(
      gestora,
      corpoDaNota([
        {
          como: 'cadastro', itemId: frasco, quantidade: '1000', unidade: 'fardo',
          lote: '2027-06-30',
        },
      ]),
    ).expect(422)
    expect(r.body.codigo).toBe('UnidadeNaoDeclarada')
  })

  it('a NOTA exige `estoque.gerir` — ela carrega CUSTO', async () => {
    await lerNota(enfermagem, XML).expect(403)
    await registrarNota(enfermagem, corpoDaNota([])).expect(403)
    // E lançar entrada SEM custo continua sendo `movEstoque`, que ela pode.
    await mover(enfermagem, {
      itemId: frasco, tipo: 'entrada', quantidade: '1000', unidade: 'ampola',
      dia: HOJE_NA_CLINICA, lote: '2027-06-30',
    }).expect(201)
  })

  it('a data da nota NO FUTURO é recusada, com o dia do SERVIDOR (regra 24)', async () => {
    await registrarNota(gestora, {
      nota: { chave: null, numero: '777', fornecedor: 'Fornecedor', cnpj: '', dia: '2026-12-01' },
      linhas: [
        {
          como: 'cadastro', itemId: frasco, quantidade: '1000', unidade: 'ampola',
          lote: '2027-06-30',
        },
      ],
    }).expect(422)
  })

  it('a nota de uma clínica NÃO alcança o item da outra', async () => {
    await registrarNota(gestora, {
      nota: { chave: null, numero: '888', fornecedor: 'Fornecedor', cnpj: '', dia: '2026-10-20' },
      linhas: [
        { como: 'cadastro', itemId: itemDaOutra, quantidade: '1000', unidade: 'un.' },
      ],
    }).expect(404)
  })
})
