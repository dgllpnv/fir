import { Quantidade, ehOk, saldoEmMedida } from '@fir/domain'
import pg from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { Ator, PessoaId } from '../banco/ator'
import type { ClinicaId } from '../banco/clinica-id'
import {
  apagarClinicaDeTeste,
  apagarMovimentosDeEstoqueDeTeste,
  declararAtorSistema,
} from '../banco/limpeza-de-teste'
import type { Transacao } from '../banco/transacao'
import type { PedidoDeBaixa } from '../programas/baixa-de-insumos'
import { BaixaRelacional } from './baixa-relacional'
import { movimentosDoItem } from './movimentos.repositorio'

/**
 * **O INVARIANTE DO SEAM `BaixaDeInsumos`, AGORA CONTRA O BANCO.**
 *
 * `programas/baixa-de-insumos.test.ts` escreveu estas asserções um épico antes
 * de o estoque existir, contra uma implementação de referência em memória, e
 * deixou a instrução:
 *
 *   > **COMO O ÉPICO 6 USA ESTE ARQUIVO:** copie as asserções deste `describe`
 *   > para `estoque/baixa.test.ts` trocando `new BaixaEmMemoria(CADASTRO)` pela
 *   > implementação relacional e `saldoPorLote()` por uma leitura do banco. Se
 *   > alguma delas ficar vermelha, a implementação relacional está errada — não
 *   > o teste.
 *
 * É o que este arquivo é. **Os números mudaram de unidade e nada mais:** lá a
 * referência trabalhava em mg (frasco = 5.000 milésimos de mg); aqui o
 * movimento é em `medida`, que é a unidade de estoque, e um frasco inteiro é
 * `1000` milésimos de ampola. A regra é a mesma, e a conversão é a do cadastro.
 *
 * E ele prova as duas coisas que a referência em memória **não podia** provar,
 * e que o próprio arquivo apontava como dívida do épico 6:
 *
 *  - que o banco **recusa** o `DELETE` (append-only em duas camadas);
 *  - que a idempotência está no **esquema** (`UNIQUE (compensa_id)`), e não num
 *    `Set` em processo que a corrida entre duas abas vence.
 */
const URL_MIG =
  process.env['DATABASE_URL_MIGRATE'] ?? 'postgresql://fir_migrate:fir_local_dev@127.0.0.1:4832/fir'
const URL_APP =
  process.env['DATABASE_URL'] ?? 'postgresql://fir_app:fir_local_dev@127.0.0.1:4832/fir'

let migrate: pg.Client
/** Conexão `fir_app` — SUJEITA À RLS, como a aplicação. */
let app: pg.Client
let clinica: ClinicaId
let ator: PessoaId
let pacienteId: string
let procedimentoId: string
let tarefaS1: string
let tarefaS2: string
let frasco: string
let seringa: string

const codigo = `bxa-${Date.now()}`
const DIA = '2026-11-02'
const LOTE_PERTO = '2026-12-31'
const LOTE_LONGE = '2027-06-30'

const baixa = new BaixaRelacional()

/**
 * Cada teste roda numa TRANSAÇÃO da conexão `fir_app`, com `app.clinica_id`
 * fixado — exatamente como `BancoService.naClinica` faz. É a mesma conexão
 * sujeita à RLS, e não a do dono: um teste rodando como `fir_migrate` provaria
 * que a aritmética fecha e nada sobre as camadas que protegem a tabela.
 */
async function emTransacao<T>(fn: (tx: Transacao) => Promise<T>): Promise<T> {
  await app.query('BEGIN')
  try {
    await app.query('SELECT set_config($1,$2,true)', ['app.clinica_id', clinica])
    await app.query('SELECT set_config($1,$2,true)', ['app.pessoa_id', ator])
    const r = await fn(app as unknown as Transacao)
    await app.query('COMMIT')
    return r
  } catch (e) {
    await app.query('ROLLBACK')
    throw e
  }
}

const pedido = (tarefaId: string, insumos: PedidoDeBaixa['insumos']): PedidoDeBaixa => ({
  clinicaId: clinica,
  tarefaId,
  pacienteId,
  procedimentoId,
  programaId: null,
  itemChave: 'i1',
  aplicadoPorId: ator,
  em: DIA,
  insumos,
})

/** 2,5 mg = meia ampola de um frasco de 5 mg que não aproveita sobra. */
const DOSE = Quantidade.deMilesimos(2_500n, 'mg')
const UMA_SERINGA = Quantidade.deMilesimos(1_000n, 'un.')

/** O saldo por (item, lote), DERIVADO — a leitura que substitui `saldoPorLote()`. */
async function saldoPorLote(): Promise<Map<string, bigint>> {
  const r = await migrate.query<{ item_id: string; lote: string | null; soma: string }>(
    `SELECT item_id, to_char(lote, 'YYYY-MM-DD') AS lote, sum(milesimos)::text AS soma
       FROM movimentos_de_estoque
      WHERE clinica_id = $1
      GROUP BY item_id, lote
      ORDER BY 1, 2`,
    [clinica],
  )
  return new Map(r.rows.map((l) => [`${l.item_id}#${l.lote ?? '-'}`, BigInt(l.soma)]))
}

type LinhaCrua = {
  id: string
  item_id: string
  tipo: string
  milesimos: string
  lote: string | null
  compensa_id: string | null
  compensa_motivo: string
  tarefa_id: string | null
  paciente_id: string | null
}

async function movimentos(): Promise<LinhaCrua[]> {
  const r = await migrate.query<LinhaCrua>(
    `SELECT id, item_id, tipo, milesimos::text AS milesimos,
            to_char(lote, 'YYYY-MM-DD') AS lote, compensa_id, compensa_motivo,
            tarefa_id, paciente_id
       FROM movimentos_de_estoque WHERE clinica_id = $1 ORDER BY sequencia`,
    [clinica],
  )
  return r.rows
}

beforeAll(async () => {
  migrate = new pg.Client({ connectionString: URL_MIG })
  await migrate.connect()
  await declararAtorSistema(migrate)
  app = new pg.Client({ connectionString: URL_APP })
  await app.connect()

  clinica = (
    await migrate.query<{ id: string }>(
      `INSERT INTO clinicas (codigo, nome) VALUES ($1, 'Clínica da Baixa') RETURNING id`,
      [codigo],
    )
  ).rows[0]!.id as unknown as ClinicaId

  ator = (
    await migrate.query<{ id: string }>(
      `INSERT INTO pessoas (clinica_id, nome, usuario, senha_hash, admin)
       VALUES ($1, 'Camila', 'camila', 'x', true) RETURNING id`,
      [clinica],
    )
  ).rows[0]!.id as unknown as PessoaId

  pacienteId = (
    await migrate.query<{ id: string }>(
      `INSERT INTO pacientes (clinica_id, nome) VALUES ($1, 'Fernanda') RETURNING id`,
      [clinica],
    )
  ).rows[0]!.id

  /**
   * O FRASCO que **não aproveita sobra**: 1 ampola = 5 mg, e a dose de 2,5 mg
   * abre um frasco inteiro. É o caso da regra 15, e é o único em que a baixa
   * gera DOIS movimentos.
   */
  frasco = (
    await migrate.query<{ id: string }>(
      `INSERT INTO itens_de_estoque
         (clinica_id, nome, medida, unid_uso, fator_uso, aproveita_sobra, controla_validade)
       VALUES ($1, 'Tirzepatida', 'ampola', 'mg', 5000, false, true) RETURNING id`,
      [clinica],
    )
  ).rows[0]!.id
  /** Descartável: sem unidade de uso, logo sem sobra de frasco aberto. */
  seringa = (
    await migrate.query<{ id: string }>(
      `INSERT INTO itens_de_estoque (clinica_id, nome, medida) VALUES ($1, 'Seringa', 'un.')
       RETURNING id`,
      [clinica],
    )
  ).rows[0]!.id

  procedimentoId = (
    await migrate.query<{ id: string }>(
      /**
       * O procedimento NÃO é inserido: toda clínica nova nasce com os cinco do
       * protótipo, pelo trigger `clinicas_semeia_procedimentos` da `0010`.
       * Inserir "Tirzepatida" aqui colide com `procedimentos_nome_unico` — e
       * descobrir isso foi bom: o insumo padrão é configurado no procedimento
       * que a clínica JÁ TEM, que é exatamente o que a usuária faz.
       */
      `UPDATE procedimentos
          SET insumo_padrao_id = $2, insumo_padrao_milesimos = 2500,
              insumo_padrao_unidade = 'mg'
        WHERE clinica_id = $1 AND nome = 'Tirzepatida'
        RETURNING id`,
      [clinica, frasco],
    )
  ).rows[0]!.id

  const tarefa = async (desc: string) =>
    (
      await migrate.query<{ id: string }>(
        /**
         * Tarefa COMUM, e não `tipo = 'Sessão de plano'`: o CHECK
         * `sessao_e_do_programa` (0010) exige que ser sessão implique ter
         * `programa_id`, `item_chave`, `sessao_indice` e `sessao_total` — e montar
         * um programa inteiro aqui mediria o épico 5, não a baixa.
         *
         * A baixa só precisa de um `tarefa_id` ao qual ligar a compensação; é a
         * SESSÃO que decide quando chamar, e isso é medido em
         * `baixa-na-sessao.e2e.test.ts`.
         */
        `INSERT INTO tarefas (clinica_id, descricao, prazo, responsavel_id, solicitante_id)
         VALUES ($1, $2, $3, $4, $4) RETURNING id`,
        [clinica, desc, DIA, ator],
      )
    ).rows[0]!.id
  tarefaS1 = await tarefa('Sessão 1')
  tarefaS2 = await tarefa('Sessão 2')
})

afterAll(async () => {
  await app.end()
  await apagarClinicaDeTeste(migrate, clinica)
  await migrate.end()
})

/**
 * Cada teste começa com **um lote de 4 ampolas** no frasco (o que vence longe)
 * e nada mais. O estoque da seringa fica em zero de propósito: a baixa não
 * recusa por saldo, e um teste que dependesse de haver seringa esconderia isso.
 */
beforeEach(async () => {
  await apagarMovimentosDeEstoqueDeTeste(migrate, clinica)
  await migrate.query(
    `INSERT INTO movimentos_de_estoque (clinica_id, item_id, tipo, milesimos, dia, lote)
     VALUES ($1, $2, 'contagem', 4000, $3, $4)`,
    [clinica, frasco, DIA, LOTE_LONGE],
  )
})

describe('BaixaRelacional — a baixa', () => {
  it('a baixa de item que NÃO aproveita sobra gera DOIS movimentos', async () => {
    await emTransacao((tx) =>
      baixa.baixar(
        tx,
        pedido(tarefaS1, [
          { itemId: frasco, quantidade: DOSE, principal: true },
          { itemId: seringa, quantidade: UMA_SERINGA, principal: false },
        ]),
      ),
    )

    const ms = await movimentos()
    const doFrasco = ms.filter((m) => m.item_id === frasco && m.tipo !== 'contagem')
    expect(doFrasco.map((m) => m.tipo)).toEqual(['consumo', 'descarte'])
    // 0,5 ampola na paciente + 0,5 ampola de sobra = **o FRASCO INTEIRO** saiu
    // da prateleira. Nunca um arredondamento (regra 15).
    expect(doFrasco.reduce((s, m) => s + BigInt(m.milesimos), 0n)).toBe(-1_000n)
    // E a seringa gera UM: descartável não tem sobra de frasco aberto.
    expect(ms.filter((m) => m.item_id === seringa)).toHaveLength(1)
  })

  it('o LOTE sai do FIFO de validade, e a sobra vai no MESMO lote', async () => {
    await migrate.query(
      `INSERT INTO movimentos_de_estoque (clinica_id, item_id, tipo, milesimos, dia, lote)
       VALUES ($1, $2, 'entrada', 2000, $3, $4)`,
      [clinica, frasco, DIA, LOTE_PERTO],
    )

    await emTransacao((tx) =>
      baixa.baixar(tx, pedido(tarefaS1, [{ itemId: frasco, quantidade: DOSE, principal: true }])),
    )

    const saidas = (await movimentos()).filter((m) => m.tipo === 'consumo' || m.tipo === 'descarte')
    expect(saidas).toHaveLength(2)
    // O que vence primeiro, nos DOIS movimentos: a sobra é do frasco que foi
    // aberto, e não de outro lote.
    expect(new Set(saidas.map((m) => m.lote))).toEqual(new Set([LOTE_PERTO]))
  })

  it('o DESCARTE não leva o paciente — a sobra não foi aplicada em ninguém', async () => {
    await emTransacao((tx) =>
      baixa.baixar(tx, pedido(tarefaS1, [{ itemId: frasco, quantidade: DOSE, principal: true }])),
    )
    const ms = (await movimentos()).filter((m) => m.tarefa_id !== null)
    expect(ms.map((m) => [m.tipo, m.paciente_id !== null])).toEqual([
      ['consumo', true],
      ['descarte', false],
    ])
  })

  it('item de estoque INEXISTENTE é ignorado, e a sessão não quebra', async () => {
    /**
     * O procedimento pode apontar para um item EXCLUÍDO do estoque. Recusar a
     * conclusão por causa disso transformaria uma falha de cadastro em "a
     * enfermagem não consegue registrar que aplicou".
     */
    const fantasma = '00000000-0000-4000-8000-000000000000'
    const r = await emTransacao((tx) =>
      baixa.baixar(tx, pedido(tarefaS1, [{ itemId: fantasma, quantidade: DOSE, principal: true }])),
    )
    expect(ehOk(r)).toBe(true)
    expect((await movimentos()).filter((m) => m.tarefa_id !== null)).toHaveLength(0)
  })
})

describe('BaixaRelacional — desfazer', () => {
  it('DESFAZER COMPENSA OS DOIS — é o descarte que a implementação ingênua esquece', async () => {
    await emTransacao((tx) =>
      baixa.baixar(tx, pedido(tarefaS1, [{ itemId: frasco, quantidade: DOSE, principal: true }])),
    )
    await emTransacao((tx) => baixa.desfazer(tx, clinica, tarefaS1, 'sessao-reaberta'))

    // O saldo volta ao ponto inicial: 4 ampolas. Compensar só o consumo
    // deixaria 3,5 para sempre — meio frasco desaparecido, sem erro na tela.
    expect(await saldoPorLote()).toEqual(new Map([[`${frasco}#${LOTE_LONGE}`, 4_000n]]))

    const ms = await movimentos()
    expect(ms.filter((m) => m.compensa_id !== null)).toHaveLength(2)
    // E compensação, nunca DELETE: as linhas de origem continuam lá.
    expect(ms.filter((m) => m.compensa_id === null && m.tarefa_id !== null)).toHaveLength(2)
  })

  it('desfazer usa o MESMO LOTE — saldo certo com lote errado é a dose do frasco vencido', async () => {
    await migrate.query(
      `INSERT INTO movimentos_de_estoque (clinica_id, item_id, tipo, milesimos, dia, lote)
       VALUES ($1, $2, 'entrada', 2000, $3, $4)`,
      [clinica, frasco, DIA, LOTE_PERTO],
    )
    await emTransacao((tx) =>
      baixa.baixar(tx, pedido(tarefaS1, [{ itemId: frasco, quantidade: DOSE, principal: true }])),
    )
    await emTransacao((tx) => baixa.desfazer(tx, clinica, tarefaS1, 'sessao-reaberta'))

    // Os dois lotes voltaram EXATAMENTE ao que eram: 4 no que vence longe, 2 no
    // que vence perto. Devolver ao lote errado daria o mesmo saldo TOTAL.
    expect(await saldoPorLote()).toEqual(
      new Map([
        [`${frasco}#${LOTE_LONGE}`, 4_000n],
        [`${frasco}#${LOTE_PERTO}`, 2_000n],
      ]),
    )
  })

  it('a compensação fica LIGADA pelo `tarefaId`, e carrega o MOTIVO', async () => {
    await emTransacao((tx) =>
      baixa.baixar(tx, pedido(tarefaS1, [{ itemId: frasco, quantidade: DOSE, principal: true }])),
    )
    await emTransacao((tx) => baixa.desfazer(tx, clinica, tarefaS1, 'programa-excluido'))
    for (const m of (await movimentos()).filter((x) => x.compensa_id !== null)) {
      expect(m.tarefa_id).toBe(tarefaS1)
      expect(m.compensa_motivo).toBe('programa-excluido')
    }
  })

  it('DESFAZER É IDEMPOTENTE: reabrir duas vezes não devolve a dose duas vezes', async () => {
    await emTransacao((tx) =>
      baixa.baixar(tx, pedido(tarefaS1, [{ itemId: frasco, quantidade: DOSE, principal: true }])),
    )
    await emTransacao((tx) => baixa.desfazer(tx, clinica, tarefaS1, 'sessao-reaberta'))
    await emTransacao((tx) => baixa.desfazer(tx, clinica, tarefaS1, 'sessao-reaberta'))
    await emTransacao((tx) => baixa.desfazer(tx, clinica, tarefaS1, 'programa-excluido'))

    expect(await saldoPorLote()).toEqual(new Map([[`${frasco}#${LOTE_LONGE}`, 4_000n]]))
    expect((await movimentos()).filter((m) => m.compensa_id !== null)).toHaveLength(2)
  })

  it('a IDEMPOTÊNCIA está no ESQUEMA: um movimento é compensado no máximo uma vez', async () => {
    /**
     * **A parte que nenhum `Set` em processo alcança.** O `BaixaEmMemoria` da
     * referência guardava os já-compensados num `Set`; com duas abas
     * reabrindo a mesma sessão, os dois processos leriam "ainda não
     * compensado" e os dois inseririam. Quem recusa a segunda é
     * `UNIQUE (compensa_id)` — e é isto que o teste do seam pedia ao esquema.
     */
    await emTransacao((tx) =>
      baixa.baixar(tx, pedido(tarefaS1, [{ itemId: frasco, quantidade: DOSE, principal: true }])),
    )
    const origem = (await movimentos()).find((m) => m.tipo === 'consumo')!

    await expect(
      migrate.query(
        `INSERT INTO movimentos_de_estoque
           (clinica_id, item_id, tipo, milesimos, dia, lote, compensa_id, compensa_motivo)
         SELECT clinica_id, item_id, tipo, -milesimos, dia, lote, id, 'correcao'
           FROM movimentos_de_estoque WHERE id = $1`,
        [origem.id],
      ),
    ).resolves.toBeTruthy()

    // A segunda, idêntica, é recusada pelo ÍNDICE.
    await expect(
      migrate.query(
        `INSERT INTO movimentos_de_estoque
           (clinica_id, item_id, tipo, milesimos, dia, lote, compensa_id, compensa_motivo)
         SELECT clinica_id, item_id, tipo, -milesimos, dia, lote, id, 'correcao'
           FROM movimentos_de_estoque WHERE id = $1`,
        [origem.id],
      ),
    ).rejects.toThrow(/movimentos_compensa_uma_vez/)
  })

  it('a COMPENSAÇÃO ESPELHA A ORIGEM — o banco recusa lote, item e quantidade diferentes', async () => {
    /**
     * `CHECK` não vê outra linha, então quem cobra é a trigger
     * `compensacao_espelha_a_origem`. Deixar isso só no serviço seria confiar
     * em quem escrever o terceiro caminho de reversão — e a exclusão de
     * programa já é o segundo.
     */
    await emTransacao((tx) =>
      baixa.baixar(tx, pedido(tarefaS1, [{ itemId: frasco, quantidade: DOSE, principal: true }])),
    )
    const origem = (await movimentos()).find((m) => m.tipo === 'consumo')!

    const compensarCom = (campos: string, valores: unknown[]) =>
      migrate.query(
        `INSERT INTO movimentos_de_estoque
           (clinica_id, item_id, tipo, milesimos, dia, lote, compensa_id, compensa_motivo)
         VALUES ($1, ${campos}, $2, 'correcao')`,
        [clinica, origem.id, ...valores],
      )

    // Quantidade que não espelha: a dose voltaria pela metade.
    await expect(
      compensarCom("$3, 'consumo', 250, $4::date, $5::date", [frasco, DIA, LOTE_LONGE]),
    ).rejects.toThrow(/não espelha a quantidade/)
    // LOTE diferente: o saldo total fecharia e a dose seguinte sairia do
    // frasco errado — o erro que nenhuma tela mostra.
    await expect(
      compensarCom("$3, 'consumo', 500, $4::date, $5::date", [frasco, DIA, LOTE_PERTO]),
    ).rejects.toThrow(/LOTE diferente/)
    // Item diferente.
    await expect(
      compensarCom("$3, 'consumo', 500, $4::date, NULL", [seringa, DIA]),
    ).rejects.toThrow(/item diferente/)
    // Tipo diferente: o consumo do período passaria a não fechar.
    await expect(
      compensarCom("$3, 'descarte', 500, $4::date, $5::date", [frasco, DIA, LOTE_LONGE]),
    ).rejects.toThrow(/tipo diferente/)
  })

  it('desfazer de UMA sessão não toca na outra', async () => {
    await emTransacao((tx) =>
      baixa.baixar(tx, pedido(tarefaS1, [{ itemId: frasco, quantidade: DOSE, principal: true }])),
    )
    await emTransacao((tx) =>
      baixa.baixar(tx, pedido(tarefaS2, [{ itemId: frasco, quantidade: DOSE, principal: true }])),
    )
    await emTransacao((tx) => baixa.desfazer(tx, clinica, tarefaS1, 'sessao-reaberta'))

    // Uma sessão voltou, a outra não: −1 ampola, de uma aplicação só.
    expect(await saldoPorLote()).toEqual(new Map([[`${frasco}#${LOTE_LONGE}`, 3_000n]]))
  })

  /**
   * **A IDA-E-VOLTA, com as doses CONSTRUÍDAS em vez de sorteadas.**
   *
   * Copiada do teste do seam, com as doses nas fronteiras do `fatorUso`: a
   * medida exata (onde o descarte NÃO deve nascer), um milésimo a menos, um a
   * mais, e múltiplos. É só no não-múltiplo que o descarte existe, e é só nele
   * que esquecer de compensá-lo aparece.
   *
   * Cada volta roda em transação própria, como no balcão: concluir, reabrir,
   * concluir, reabrir.
   */
  it('IDA-E-VOLTA: concluir → reabrir, 1 a 3 vezes, devolve saldo E LOTE ao inicial', async () => {
    const doses = [1n, 2_499n, 2_500n, 5_000n, 5_001n, 12_500n]
    for (const emMg of doses) {
      for (let voltas = 1; voltas <= 3; voltas++) {
        await apagarMovimentosDeEstoqueDeTeste(migrate, clinica)
        await migrate.query(
          `INSERT INTO movimentos_de_estoque (clinica_id, item_id, tipo, milesimos, dia, lote)
           VALUES ($1, $2, 'contagem', 4000, $3, $4)`,
          [clinica, frasco, DIA, LOTE_LONGE],
        )

        for (let i = 0; i < voltas; i++) {
          await emTransacao((tx) =>
            baixa.baixar(
              tx,
              pedido(tarefaS1, [
                { itemId: frasco, quantidade: Quantidade.deMilesimos(emMg, 'mg'), principal: true },
              ]),
            ),
          )
          await emTransacao((tx) => baixa.desfazer(tx, clinica, tarefaS1, 'sessao-reaberta'))
        }

        // Saldo E LOTE no ponto inicial. Nada de ponto flutuante em ponto
        // nenhum: `bigint` de milésimos, do banco ao domínio.
        expect(await saldoPorLote(), `dose ${emMg} mg, ${voltas} voltas`).toEqual(
          new Map([[`${frasco}#${LOTE_LONGE}`, 4_000n]]),
        )
      }
    }
  })

  it('na dose EXATAMENTE igual à unidade, não nasce descarte de zero', async () => {
    // A fronteira que o sorteio uniforme não distingue. Um descarte de zero é
    // uma linha de perda que a análise tem de explicar e que nunca aconteceu.
    await emTransacao((tx) =>
      baixa.baixar(
        tx,
        pedido(tarefaS1, [
          { itemId: frasco, quantidade: Quantidade.deMilesimos(5_000n, 'mg'), principal: true },
        ]),
      ),
    )
    const ms = (await movimentos()).filter((m) => m.tarefa_id !== null)
    expect(ms.map((m) => m.tipo)).toEqual(['consumo'])
  })

  it('o SALDO DERIVADO do domínio lê o mesmo número que a soma do banco', async () => {
    /**
     * A ponte entre as duas leituras: `saldoEmMedida` (domínio, a partir dos
     * movimentos) e o `sum()` do Postgres. Elas têm de concordar — e concordam
     * porque **não há contagem no meio** neste cenário; onde houver, só o
     * domínio está certo, porque a contagem REINICIA em vez de somar. É por
     * isso que o serviço não usa `SUM` em SQL.
     */
    await emTransacao((tx) =>
      baixa.baixar(tx, pedido(tarefaS1, [{ itemId: frasco, quantidade: DOSE, principal: true }])),
    )
    const doDominio = await emTransacao(async (tx) =>
      saldoEmMedida(await movimentosDoItem(tx, frasco), 'ampola'),
    )
    expect(doDominio.saldo.milesimos).toBe(3_000n)
    expect(doDominio.semContagem).toBe(false)
    expect([...(await saldoPorLote()).values()]).toEqual([3_000n])
  })
})
