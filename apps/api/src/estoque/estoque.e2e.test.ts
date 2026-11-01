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
    migrate.query(
      `INSERT INTO pessoas (clinica_id, nome, usuario, senha_hash, admin, perfil_id)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [c, nome, usuario, hash, perfilId === null, perfilId],
    )
  await pessoa(clinica, 'Helena Prado', 'helena', pfGestora)
  await pessoa(clinica, 'Camila Enf', 'camila', pfEnf)
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
  await migrate.query('DELETE FROM itens_de_estoque WHERE clinica_id = $1', [clinica])
  await migrate.query('DELETE FROM locais_de_estoque WHERE clinica_id = $1', [clinica])
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
