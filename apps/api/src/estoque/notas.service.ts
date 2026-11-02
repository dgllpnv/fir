import type {
  LinhaDaNotaLida,
  MovimentoNaLista,
  NotaLida,
  RegistrarEntradaPelaNota,
  ResultadoDaEntradaPelaNota,
} from '@fir/contracts'
import {
  Quantidade,
  SEMELHANCA_CONFIAVEL,
  SEMELHANCA_SUGESTAO,
  ehErro,
  normalizarNome,
  paraMedida,
  semelhancaDeNome,
} from '@fir/domain'
import { Inject, Injectable, UnprocessableEntityException } from '@nestjs/common'
import type pg from 'pg'
import { pessoaDoAtor, type Ator, type PessoaId } from '../banco/ator'
import { BancoService } from '../banco/banco.service'
import type { ClinicaId } from '../banco/clinica-id'
import { RELOGIO, type Relogio } from '../comum/relogio'
import { diaDaClinica } from './dia-da-clinica'
import { LeitorDeNota } from './leitor-de-nota'
import {
  gravarMovimento,
  itemParaEscrita,
  quantidadeNaSaida,
} from './movimentos.repositorio'

/**
 * **`entradaNota`** — a entrada do estoque pela nota fiscal.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * A IDEMPOTÊNCIA É DO ESQUEMA, NÃO DE UM `if` (regra 26)
 *
 * A chave é a **chave de acesso da NF-e** (44 dígitos) e, para a nota digitada
 * à mão, o par **emissor + número**. Os dois são índices únicos parciais da
 * migration 0017, e o `INSERT … ON CONFLICT DO NOTHING` é o que torna
 * reimportar o mesmo XML três vezes não criar nada novo.
 *
 * **Não é um `SELECT` antes do `INSERT`**, e a diferença importa: duas abas
 * tocando "Registrar" ao mesmo tempo passam as duas pelo `SELECT` e inserem as
 * duas. Com o índice, a segunda é recusada pelo banco, e aí ela lê a nota que
 * a primeira criou e devolve **os mesmos movimentos**.
 *
 * **Divergimos do protótipo de propósito:** ele responde `fail("Esta nota já
 * foi registrada.")`. Uma escrita externa idempotente devolve o MESMO
 * resultado — a segunda e a terceira importação devolvem os mesmos movimentos,
 * com os mesmos ids, e `jaRegistrada: true`. A tela diz "esta nota já estava
 * lançada" e mostra o que ela criou, em vez de um vermelho que não diz se o
 * estoque entrou ou não.
 * ────────────────────────────────────────────────────────────────────────────
 */

type Contexto = {
  readonly clinicaId: ClinicaId
  readonly ator: Ator
  readonly fuso: string
}

/** O item do catálogo, como o casamento precisa dele. */
type ItemParaCasar = {
  id: string
  nome: string
  codigo: string
  medida: string
  unid_compra: string | null
  fator_compra: string | null
  custo: string | null
}

/** Quantas `medida` em 1 unidade da nota quando não há de onde tirar: uma. */
const UMA_POR_UMA = 1_000n

@Injectable()
export class NotasService {
  // `@Inject` explícito: o esbuild não emite `design:paramtypes`.
  constructor(
    @Inject(BancoService) private readonly banco: BancoService,
    @Inject(LeitorDeNota) private readonly leitor: LeitorDeNota,
    @Inject(RELOGIO) private readonly relogio: Relogio,
  ) {}

  /**
   * Lê o XML e **sugere** o casamento com o catálogo — nunca grava nada.
   *
   * `conciliação sugere, nunca sobrescreve` (regra 27): o que sai daqui é
   * proposta. Quem confirma é a pessoa, na tela de conferência, e é a
   * confirmação dela que vira vínculo.
   */
  async ler(ctx: Contexto, xml: string): Promise<NotaLida> {
    const lida = this.leitor.ler(xml)
    if (ehErro(lida)) {
      throw new UnprocessableEntityException({
        statusCode: 422,
        codigo: lida.erro.codigo,
        message: lida.erro.mensagem,
      })
    }
    const n = lida.valor

    return this.banco.naClinica(ctx.clinicaId, ctx.ator, async (c) => {
      const itens = (
        await c.query<ItemParaCasar>(
          `SELECT id, nome, codigo, medida, unid_compra, fator_compra::text AS fator_compra,
                  custo::text AS custo
             FROM itens_de_estoque
            WHERE excluido_em IS NULL AND ativo`,
        )
      ).rows
      const vinculos = new Map(
        (
          await c.query<{ codigo: string; item_id: string; fator: string }>(
            'SELECT codigo, item_id, fator::text AS fator FROM vinculos_de_nota WHERE cnpj = $1',
            [n.cnpj],
          )
        ).rows.map((v) => [normalizarNome(v.codigo), v]),
      )

      const jaRegistrada =
        (await this.notaExistente(c, n.chave, n.cnpj, n.fornecedor, n.numero)) !== null

      return {
        nota: {
          chave: n.chave,
          numero: n.numero,
          fornecedor: n.fornecedor,
          cnpj: n.cnpj,
          // O dia da nota, com teto no HOJE DA CLÍNICA: uma nota com data de
          // emissão no futuro (erro do emissor, ou fuso do emissor à frente)
          // poria movimento no futuro, e a análise de período o contaria no mês
          // errado. O protótipo faz o mesmo teto, com `today()` do navegador.
          dia: this.diaDaNota(n.dia, ctx.fuso),
        },
        linhas: n.linhas.map((l): LinhaDaNotaLida => {
          const casado = casar(l, itens, vinculos)
          return {
            codigo: l.codigo,
            descricao: l.descricao,
            unidadeDaNota: l.unidadeDaNota,
            quantidadeNaNota: l.quantidade.toString(),
            valorUnitario: l.valorUnitario.toString(),
            loteDoFabricante: l.loteDoFabricante,
            validade: l.validade,
            itemId: casado.itemId,
            casamento: casado.casamento,
            fator: casado.fator.toString(),
          }
        }),
        jaRegistrada,
      }
    })
  }

  async registrar(
    ctx: Contexto,
    d: RegistrarEntradaPelaNota,
  ): Promise<ResultadoDaEntradaPelaNota> {
    const hoje = diaDaClinica(this.relogio, ctx.fuso)
    if (d.nota.dia > hoje) {
      throw new UnprocessableEntityException(
        `A data da nota não pode ser no futuro. Hoje, nesta clínica, é ${hoje}.`,
      )
    }

    return this.banco.naClinica(ctx.clinicaId, ctx.ator, async (c) => {
      const chave = d.nota.chave ?? null
      const novo = await c.query<{ id: string }>(
        `INSERT INTO notas_de_entrada
           (clinica_id, chave, numero, fornecedor, cnpj, dia, registrada_por)
         VALUES ($1,$2,$3,$4,$5,$6::date,$7)
         ON CONFLICT DO NOTHING
         RETURNING id`,
        [
          ctx.clinicaId,
          chave,
          d.nota.numero,
          d.nota.fornecedor,
          d.nota.cnpj,
          d.nota.dia,
          pessoaDoAtor(ctx.ator),
        ],
      )

      if (novo.rows[0] === undefined) {
        /**
         * A NOTA JÁ EXISTE — e aqui **nada é gravado**.
         *
         * Devolver os movimentos que ela criou é o que faz a terceira
         * importação parecer com a primeira. Um 409 estaria tecnicamente
         * correto e praticamente pior: quem apertou duas vezes não saberia se
         * o estoque entrou.
         */
        const id = await this.notaExistente(
          c,
          chave,
          d.nota.cnpj,
          d.nota.fornecedor,
          d.nota.numero,
        )
        if (id === null) {
          // O `ON CONFLICT DO NOTHING` cobre QUALQUER índice único da tabela, e
          // só os dois de idempotência existem — então chegar aqui é uma
          // terceira restrição nova e não classificada. Falhar alto é o certo:
          // em silêncio, a nota não entraria e a tela diria que entrou.
          throw new UnprocessableEntityException(
            'Não consegui registrar esta nota. Confira a chave de acesso e o número.',
          )
        }
        return this.resultado(c, id, true, [], 0)
      }

      const notaId = novo.rows[0].id
      const custoSubiu: string[] = []
      let vinculos = 0

      for (const l of d.linhas) {
        const item = await itemParaEscrita(c, l.itemId)

        /**
         * A CONVERSÃO, e ela vem sempre de um CADASTRO (regra 9).
         *
         *  - `cadastro`: a unidade é uma das três do item, e quem converte é
         *    `paraMedida`.
         *  - `nota`: a unidade é a da nota, com o fator que a clínica
         *    confirmou — e esse fator é **gravado no vínculo**, que é o
         *    cadastro do produto daquele fornecedor.
         *
         * Nos dois casos o número sai de uma tabela, nunca deste arquivo.
         */
        let milesimos: bigint
        let custo: bigint | null
        if (l.como === 'cadastro') {
          const emMedida = paraMedida(Quantidade.deMilesimos(l.quantidade, l.unidade), item)
          if (ehErro(emMedida)) {
            throw new UnprocessableEntityException({
              statusCode: 422,
              codigo: emMedida.erro.codigo,
              message: emMedida.erro.mensagem,
            })
          }
          milesimos = emMedida.valor.milesimos
          custo = l.custo ?? null
        } else {
          // `quantidade` está em milésimos da unidade da NOTA, e `fator` em
          // milésimos de `medida` por unidade da nota: o produto traz dois
          // fatores de mil, e um deles sai na divisão.
          milesimos = (l.quantidade * l.fator) / UMA_POR_UMA
          if (milesimos <= 0n) {
            throw new UnprocessableEntityException(
              `A quantidade de "${item.nome}" fica em zero com esse fator de conversão.`,
            )
          }
          /**
           * O custo POR `medida`, a partir do custo por unidade da nota.
           *
           * Arredondado para o mais próximo com aritmética inteira — `custo` é
           * **preço de referência** do item (alimenta a curva ABC e o "valor em
           * estoque"), não dinheiro que se moveu: nenhum recebimento, nenhuma
           * conta a pagar e nenhuma conferência de caixa passa por aqui. O
           * meio centavo por ampola que o arredondamento decide não entra em
           * resultado nenhum.
           */
          custo =
            l.custoDaNota == null
              ? null
              : (l.custoDaNota * UMA_POR_UMA + l.fator / 2n) / l.fator

          if (l.codigo !== '') {
            await c.query(
              `INSERT INTO vinculos_de_nota (clinica_id, cnpj, codigo, item_id, fator, descricao)
               VALUES ($1,$2,$3,$4,$5,$6)
               ON CONFLICT (clinica_id, cnpj, codigo)
                 DO UPDATE SET item_id = excluded.item_id, fator = excluded.fator,
                               descricao = excluded.descricao`,
              [ctx.clinicaId, d.nota.cnpj, l.codigo, l.itemId, l.fator.toString(), l.descricao],
            )
            vinculos++
          }
        }

        if (item.controlaValidade && (l.lote ?? null) === null) {
          throw new UnprocessableEntityException(
            `"${item.nome}" controla validade: informe o vencimento do que chegou.`,
          )
        }

        await gravarMovimento(c, {
          clinicaId: ctx.clinicaId,
          itemId: item.id,
          tipo: 'entrada',
          milesimos,
          dia: d.nota.dia,
          lote: l.lote ?? null,
          custo,
          notaId,
          obs: observacao(d.nota, l.como === 'nota' ? l.descricao : ''),
          criadoPor: pessoaDoAtor(ctx.ator),
        })

        if (custo !== null) {
          const anterior = await c.query<{ custo: string | null }>(
            'SELECT custo::text AS custo FROM itens_de_estoque WHERE id = $1',
            [item.id],
          )
          const antes = anterior.rows[0]?.custo
          /**
           * O AVISO DE 10%, e ele é do protótipo: `custo >= it.custo * 1.1`.
           *
           * Em inteiros: `novo * 10 >= antes * 11`. A multiplicação por 1.1 em
           * ponto flutuante daria um limiar que oscila no último centavo, e o
           * aviso apareceria ou não conforme o preço — o que é exatamente o
           * tipo de "às vezes" que ninguém consegue depurar no balcão.
           */
          if (antes != null && BigInt(antes) > 0n && custo * 10n >= BigInt(antes) * 11n) {
            custoSubiu.push(item.nome)
          }
          // O custo do item passa a ser o da nota mais recente. É o protótipo,
          // e é a leitura certa de "quanto vale o que está na prateleira".
          await c.query('UPDATE itens_de_estoque SET custo = $2 WHERE id = $1', [
            item.id,
            custo.toString(),
          ])
        }
      }

      return this.resultado(c, notaId, false, custoSubiu, vinculos)
    })
  }

  /* ── privado ───────────────────────────────────────────────────────────── */

  private diaDaNota(dia: string | null, fuso: string): string {
    const hoje = diaDaClinica(this.relogio, fuso)
    if (dia === null || dia > hoje) return hoje
    return dia
  }

  /**
   * A nota já registrada, pelas DUAS chaves de idempotência — **as mesmas dos
   * dois índices únicos da 0017**, e nessa ordem.
   *
   * `emissor_chave` é coluna GERADA no banco (`CNPJ`, ou o nome normalizado do
   * fornecedor quando não há CNPJ), e aqui ela é montada com o mesmo
   * `normalizarNome` do domínio — que é a forma de `normalizar_nome` do
   * Postgres. Duas formas diferentes de normalizar e esta consulta não acharia
   * a linha que o índice recusou: a nota não entraria, e a tela diria que
   * entrou.
   */
  private async notaExistente(
    c: pg.PoolClient,
    chave: string | null,
    cnpj: string,
    fornecedor: string,
    numero: string,
  ): Promise<string | null> {
    if (chave !== null) {
      const r = await c.query<{ id: string }>(
        'SELECT id FROM notas_de_entrada WHERE chave = $1',
        [chave],
      )
      if (r.rows[0] !== undefined) return r.rows[0].id
    }
    const emissor = cnpj !== '' ? cnpj : normalizarNome(fornecedor)
    if (numero === '' || emissor === '') return null
    const r = await c.query<{ id: string }>(
      'SELECT id FROM notas_de_entrada WHERE numero = $1 AND emissor_chave = $2',
      [numero, emissor],
    )
    return r.rows[0]?.id ?? null
  }

  private async resultado(
    c: pg.PoolClient,
    notaId: string,
    jaRegistrada: boolean,
    custoSubiu: readonly string[],
    vinculosGravados: number,
  ): Promise<ResultadoDaEntradaPelaNota> {
    const r = await c.query<{
      id: string
      item_id: string
      item_nome: string
      medida: string
      milesimos: string
      dia: string
      em: Date
      lote: string | null
      custo: string | null
      obs: string
    }>(
      `SELECT m.id, m.item_id, i.nome AS item_nome, i.medida,
              m.milesimos::text AS milesimos,
              to_char(m.dia, 'YYYY-MM-DD') AS dia, m.em,
              to_char(m.lote, 'YYYY-MM-DD') AS lote, m.custo::text AS custo, m.obs
         FROM movimentos_de_estoque m
         JOIN itens_de_estoque i ON i.id = m.item_id
        WHERE m.nota_id = $1
        ORDER BY m.sequencia`,
      [notaId],
    )
    return {
      notaId,
      jaRegistrada,
      movimentos: r.rows.map(
        (l): MovimentoNaLista => ({
          id: l.id,
          itemId: l.item_id,
          itemNome: l.item_nome,
          tipo: 'entrada',
          quantidade: quantidadeNaSaida(
            Quantidade.deMilesimos(BigInt(l.milesimos), l.medida),
          ),
          dia: l.dia,
          em: l.em.toISOString(),
          lote: l.lote,
          custo: l.custo,
          motivo: '',
          obs: l.obs,
          pacienteId: null,
          compensa: false,
          compensada: false,
        }),
      ),
      custoSubiu: [...custoSubiu],
      vinculosGravados,
    }
  }
}

/**
 * O CASAMENTO de uma linha da nota com um item do catálogo — **sugestão**.
 *
 * A ordem é a do protótipo, e cada degrau é mais fraco que o anterior:
 * vínculo salvo → código igual → nome muito parecido → nome parecido o
 * bastante para pedir conferência → nada.
 */
function casar(
  l: { codigo: string; descricao: string; unidadeDaNota: string },
  itens: readonly ItemParaCasar[],
  vinculos: ReadonlyMap<string, { item_id: string; fator: string }>,
): { itemId: string | null; casamento: LinhaDaNotaLida['casamento']; fator: bigint } {
  const porId = new Map(itens.map((i) => [i.id, i]))

  const salvo = l.codigo === '' ? undefined : vinculos.get(normalizarNome(l.codigo))
  if (salvo !== undefined && porId.has(salvo.item_id)) {
    return { itemId: salvo.item_id, casamento: 'vinculo', fator: BigInt(salvo.fator) }
  }

  const porCodigo =
    l.codigo === ''
      ? undefined
      : itens.find(
          (i) => i.codigo !== '' && normalizarNome(i.codigo) === normalizarNome(l.codigo),
        )
  if (porCodigo !== undefined) {
    return { itemId: porCodigo.id, casamento: 'codigo', fator: fatorDoItem(porCodigo, l.unidadeDaNota) }
  }

  let melhor: ItemParaCasar | null = null
  let nota = 0
  for (const i of itens) {
    const s = semelhancaDeNome(i.nome, l.descricao)
    if (s > nota) {
      nota = s
      melhor = i
    }
  }
  if (melhor === null || nota < SEMELHANCA_SUGESTAO) {
    return { itemId: null, casamento: 'sem', fator: UMA_POR_UMA }
  }
  return {
    itemId: melhor.id,
    casamento: nota >= SEMELHANCA_CONFIAVEL ? 'nome' : 'sugestao',
    fator: fatorDoItem(melhor, l.unidadeDaNota),
  }
}

/**
 * O fator sugerido quando não há vínculo: o `fatorCompra` do item **se** a
 * unidade da nota for a unidade de compra dele; senão, uma por uma.
 *
 * A comparação é por nome normalizado porque a nota escreve `CX` e o cadastro
 * `caixa` — e quando elas não batem, sugerir o `fatorCompra` seria converter
 * uma unidade pela conversão de outra, que é a regra 10 ao contrário.
 */
function fatorDoItem(i: ItemParaCasar, unidadeDaNota: string): bigint {
  if (i.unid_compra === null || i.fator_compra === null) return UMA_POR_UMA
  return normalizarNome(i.unid_compra) === normalizarNome(unidadeDaNota)
    ? BigInt(i.fator_compra)
    : UMA_POR_UMA
}

/** "NF 12345 · Saúde Nordeste · Tirzepatida 5mg" — a frase do extrato. */
function observacao(
  nota: { numero: string; fornecedor: string },
  descricao: string,
): string {
  return [
    nota.numero === '' ? '' : `NF ${nota.numero}`,
    nota.fornecedor,
    descricao,
  ]
    .filter((x) => x !== '')
    .join(' · ')
    .slice(0, 120)
}
