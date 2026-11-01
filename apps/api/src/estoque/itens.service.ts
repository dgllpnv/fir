import type {
  EditarItemEstoque,
  ItemNaLista,
  ListaDeItens,
  SalvarItemEstoque,
} from '@fir/contracts'
import {
  type ItemComUnidades,
  deMedidaParaExibicao,
  ehOk,
  loteSugerido,
  saldoEmMedida,
} from '@fir/domain'
import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common'
import type pg from 'pg'
import type { PessoaId } from '../banco/ator'
import { BancoService } from '../banco/banco.service'
import type { ClinicaId } from '../banco/clinica-id'
import { RELOGIO, type Relogio } from '../comum/relogio'
import { diaDaClinica } from './dia-da-clinica'
import { gravarMovimento, movimentosDosItens, quantidadeNaSaida } from './movimentos.repositorio'

/**
 * **`salvarItemEstoque`** — o item com as três unidades.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * AS DUAS COISAS QUE ESTE SERVIÇO NÃO FAZ, E É POR ISSO QUE ELE ESTÁ CERTO
 *
 *  1. **Não grava saldo.** Saldo é derivado dos movimentos (regra 11). A
 *     "contagem inicial" do cadastro é um MOVIMENTO de tipo `contagem`, não um
 *     campo — e é o que faz "a quantidade de hoje é o ponto de partida"
 *     (MANUAL cap. 12) ser a mesma coisa que uma contagem feita depois.
 *
 *  2. **Não contém nenhum número de conversão** (regra 9). Os fatores entram
 *     pelo corpo, viram colunas, e quem os aplica é `paraMedida` no domínio.
 * ────────────────────────────────────────────────────────────────────────────
 */

type Contexto = { readonly clinicaId: ClinicaId; readonly ator: PessoaId }

type LinhaDeItem = {
  id: string
  nome: string
  codigo: string
  categoria: string
  medida: string
  unid_compra: string | null
  fator_compra: string | null
  unid_uso: string | null
  fator_uso: string | null
  aproveita_sobra: boolean
  controla_validade: boolean
  alta_rotatividade: boolean
  alto_valor: string
  minimo: string | null
  custo: string | null
  local_id: string | null
  unidade_id: string | null
  responsavel_id: string | null
  ativo: boolean
}

const COLUNAS = `
  id, nome, codigo, categoria, medida,
  unid_compra, fator_compra::text AS fator_compra,
  unid_uso, fator_uso::text AS fator_uso,
  aproveita_sobra, controla_validade, alta_rotatividade, alto_valor,
  minimo::text AS minimo, custo::text AS custo,
  local_id, unidade_id, responsavel_id, ativo`

const SELECT_ITEM = `SELECT ${COLUNAS} FROM itens_de_estoque WHERE excluido_em IS NULL`

const unidadesDe = (l: LinhaDeItem): ItemComUnidades => ({
  medida: l.medida,
  unidCompra: l.unid_compra,
  fatorCompra: l.fator_compra === null ? null : BigInt(l.fator_compra),
  unidUso: l.unid_uso,
  fatorUso: l.fator_uso === null ? null : BigInt(l.fator_uso),
  aproveitaSobra: l.aproveita_sobra,
})

@Injectable()
export class ItensService {
  // `@Inject` explícito: o esbuild não emite `design:paramtypes`.
  constructor(
    @Inject(BancoService) private readonly banco: BancoService,
    @Inject(RELOGIO) private readonly relogio: Relogio,
  ) {}

  /**
   * A lista, com **saldo derivado** de cada item.
   *
   * Os movimentos de todos os itens vêm numa consulta só: um `SELECT` por item
   * seria N+1 numa tela que a enfermagem abre várias vezes por dia. O cálculo é
   * do domínio — `saldoEmMedida` —, e não um `SUM` em SQL, porque a regra "a
   * última contagem é o ponto de partida" tem de existir **uma vez**. Escrita
   * em SQL aqui e em TypeScript no domínio, ela divergiria no dia em que
   * alguém mudasse uma das duas.
   */
  async listar(ctx: Contexto): Promise<ListaDeItens> {
    return this.banco.naClinica(ctx.clinicaId, ctx.ator, async (c) => {
      const r = await c.query<LinhaDeItem>(`${SELECT_ITEM} ORDER BY ativo DESC, nome`)
      const movs = await movimentosDosItens(
        c,
        r.rows.map((l) => l.id),
      )
      return { itens: r.rows.map((l) => paraSaida(l, movs.get(l.id) ?? [])) }
    })
  }

  async criar(ctx: Contexto, d: SalvarItemEstoque, fuso: string): Promise<ItemNaLista> {
    return this.banco.naClinica(ctx.clinicaId, ctx.ator, async (c) => {
      const id = await this.gravar(c, ctx, d, null)

      /**
       * A CONTAGEM INICIAL, e ela é um movimento.
       *
       * Só na criação: depois dela, contar é `criarContagem` ou um movimento de
       * `contagem`. É o que o protótipo faz
       * (`!E.movs.some(m => m.itemId === it.id)`), e é o que impede o cadastro
       * reeditado de reiniciar a história do estoque sem ninguém ter contado a
       * prateleira.
       */
      if (d.inicial != null) {
        if (d.controlaValidade && d.inicial.lote == null && d.inicial.quantidade > 0n) {
          throw new UnprocessableEntityException(
            'Este item controla validade: informe o vencimento do que foi contado.',
          )
        }
        await gravarMovimento(c, {
          clinicaId: ctx.clinicaId,
          itemId: id,
          tipo: 'contagem',
          // Já em `medida`: é a prateleira que se conta, e o contrato declara a
          // quantidade inicial nessa unidade.
          milesimos: d.inicial.quantidade,
          dia: diaDaClinica(this.relogio, fuso),
          lote: d.inicial.lote ?? null,
          obs: 'Inventário inicial',
          criadoPor: ctx.ator,
        })
      }

      return umPorId(c, id)
    })
  }

  /**
   * Edição PARCIAL, que mescla sobre a linha atual.
   *
   * Com o esquema de criação, um `PATCH { ativo: false }` reescreveria `medida`
   * para `'un.'` e **apagaria as duas conversões** — sem erro nenhum, e a
   * clínica descobriria na próxima dose, convertida pelo fator que não existe
   * mais. É a mesma armadilha que `EditarProcedimento` registra.
   */
  async editar(ctx: Contexto, id: string, d: EditarItemEstoque): Promise<ItemNaLista> {
    return this.banco.naClinica(ctx.clinicaId, ctx.ator, async (c) => {
      const atual = await linhaPorId(c, id)
      await this.gravar(c, ctx, mesclar(atual, d), id)
      return umPorId(c, id)
    })
  }

  /**
   * SOFT DELETE, recusado quando o item **tem movimento**.
   *
   * O protótipo não tem exclusão de item; o que ele tem é `ativo: false`. A
   * recusa aqui existe porque excluir um item com movimento tiraria da análise
   * do estoque o consumo que já aconteceu — e a diferença de um período
   * fechado mudaria depois de fechado.
   */
  async excluir(ctx: Contexto, id: string): Promise<void> {
    await this.banco.naClinica(ctx.clinicaId, ctx.ator, async (c) => {
      await linhaPorId(c, id)
      const r = await c.query<{ n: string }>(
        'SELECT count(*)::text AS n FROM movimentos_de_estoque WHERE item_id = $1',
        [id],
      )
      const n = Number(r.rows[0]!.n)
      if (n > 0) {
        throw new ConflictException(
          `Este item tem ${n === 1 ? '1 movimento registrado' : `${n} movimentos registrados`} ` +
            'e não pode ser excluído — a análise do estoque depende deles. ' +
            'Desmarque "Ativo" para tirá-lo das listas.',
        )
      }
      await c.query(
        `UPDATE itens_de_estoque
            SET excluido_em = now(), ativo = false,
                desativado_em = coalesce(desativado_em, now())
          WHERE id = $1`,
        [id],
      )
    })
  }

  /** O `INSERT`/`UPDATE`, num caminho só — senão os dois divergem na regra de `ativo`. */
  private async gravar(
    c: pg.PoolClient,
    ctx: Contexto,
    d: SalvarItemEstoque,
    id: string | null,
  ): Promise<string> {
    const valores = [
      d.nome,
      d.codigo,
      d.categoria,
      d.medida,
      d.compra.tem ? d.compra.unidade : null,
      d.compra.tem ? d.compra.fator.toString() : null,
      d.uso.tem ? d.uso.unidade : null,
      d.uso.tem ? d.uso.fator.toString() : null,
      d.aproveitaSobra,
      d.controlaValidade,
      d.altaRotatividade,
      d.altoValor,
      d.minimo == null ? null : d.minimo.toString(),
      d.custo == null ? null : d.custo.toString(),
      d.localId ?? null,
      d.unidadeId ?? null,
      d.responsavelId ?? null,
      d.ativo,
    ]

    try {
      if (id === null) {
        const r = await c.query<{ id: string }>(
          `INSERT INTO itens_de_estoque
             (nome, codigo, categoria, medida, unid_compra, fator_compra, unid_uso, fator_uso,
              aproveita_sobra, controla_validade, alta_rotatividade, alto_valor,
              minimo, custo, local_id, unidade_id, responsavel_id, ativo,
              clinica_id, desativado_em, criado_por)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,
                   $19, CASE WHEN $18 THEN NULL ELSE now() END, $20)
           RETURNING id`,
          [...valores, ctx.clinicaId, ctx.ator],
        )
        return r.rows[0]!.id
      }
      const r = await c.query<{ id: string }>(
        `UPDATE itens_de_estoque
            SET nome = $1, codigo = $2, categoria = $3, medida = $4,
                unid_compra = $5, fator_compra = $6, unid_uso = $7, fator_uso = $8,
                aproveita_sobra = $9, controla_validade = $10, alta_rotatividade = $11,
                alto_valor = $12, minimo = $13, custo = $14, local_id = $15,
                unidade_id = $16, responsavel_id = $17, ativo = $18,
                desativado_em = CASE WHEN $18 THEN NULL ELSE coalesce(desativado_em, now()) END
          WHERE id = $19 AND excluido_em IS NULL
          RETURNING id`,
        [...valores, id],
      )
      if (r.rowCount === 0) throw new NotFoundException('Item de estoque não encontrado.')
      return r.rows[0]!.id
    } catch (e) {
      throw traduzirRepetido(e, d)
    }
  }
}

async function linhaPorId(c: pg.PoolClient, id: string): Promise<LinhaDeItem> {
  const r = await c.query<LinhaDeItem>(`${SELECT_ITEM} AND id = $1`, [id])
  const l = r.rows[0]
  // Sem cláusula de clínica: a RLS já a impõe, e o item da vizinha não existe
  // visto daqui.
  if (l === undefined) throw new NotFoundException('Item de estoque não encontrado.')
  return l
}

async function umPorId(c: pg.PoolClient, id: string): Promise<ItemNaLista> {
  const l = await linhaPorId(c, id)
  const movs = await movimentosDosItens(c, [id])
  return paraSaida(l, movs.get(id) ?? [])
}

function paraSaida(
  l: LinhaDeItem,
  movs: Parameters<typeof saldoEmMedida>[0],
): ItemNaLista {
  const u = unidadesDe(l)
  const { saldo, semContagem } = saldoEmMedida(movs, l.medida)
  const minimo = l.minimo === null ? null : BigInt(l.minimo)

  /**
   * O saldo na UNIDADE DE USO, para a tela mostrar "0,5 ampola · 2,5 mg" —
   * a frase do MANUAL.
   *
   * `ehOk` e não `exigir`: um saldo que não converte exatamente (fator trocado
   * depois de haver movimento) não pode derrubar a listagem inteira. A tela
   * mostra só a `medida`, que é a verdade do estoque, e a conversão de
   * exibição some.
   */
  const emUso = deMedidaParaExibicao(saldo, u, 'uso')

  return {
    id: l.id,
    nome: l.nome,
    codigo: l.codigo,
    categoria: l.categoria,
    medida: l.medida,
    compra: u.unidCompra === null ? null : { unidade: u.unidCompra, fator: String(u.fatorCompra) },
    uso: u.unidUso === null ? null : { unidade: u.unidUso, fator: String(u.fatorUso) },
    aproveitaSobra: l.aproveita_sobra,
    controlaValidade: l.controla_validade,
    altaRotatividade: l.alta_rotatividade,
    altoValor: l.alto_valor as '' | 'sim' | 'nao',
    minimo: l.minimo,
    custo: l.custo,
    localId: l.local_id,
    unidadeId: l.unidade_id,
    responsavelId: l.responsavel_id,
    ativo: l.ativo,
    saldoEmEstoque: quantidadeNaSaida(saldo),
    saldoEmUso: ehOk(emUso) ? quantidadeNaSaida(emUso.valor) : null,
    semContagem,
    /**
     * **Só com mínimo DECLARADO.** `minimo` nulo é "este item não tem mínimo",
     * e tratá-lo como zero faria nenhum item ficar abaixo dele — a tarefa de
     * reposição nunca nasceria. O protótipo escreve `Number(it.minimo) > 0`, o
     * que acerta por acidente e perde o item cujo mínimo legítimo é zero.
     */
    abaixoDoMinimo: minimo !== null && saldo.milesimos < minimo,
    loteSugerido: loteSugerido(movs, l.medida),
  }
}

/** `23505` nos três índices únicos do item, cada um com a frase da recepção. */
function traduzirRepetido(e: unknown, d: SalvarItemEstoque): unknown {
  const erro = e as { code?: string; constraint?: string }
  if (erro.code !== '23505') return e
  if (erro.constraint === 'itens_de_estoque_nome_unico') {
    return new ConflictException(`Já existe um item chamado "${d.nome}" no estoque.`)
  }
  if (erro.constraint === 'itens_de_estoque_codigo_unico') {
    return new ConflictException(`O código "${d.codigo}" já está em outro item do estoque.`)
  }
  return e
}

/**
 * A MESCLA DA EDIÇÃO PARCIAL: o que veio vence, o que não veio permanece.
 *
 * **A redação de valores não alcança este ponto**, e é por isso que a mescla é
 * segura: o `RedacaoInterceptor` roda na borda HTTP, depois do serviço, então
 * `atual.custo` aqui vem do banco inteiro mesmo para quem não tem `valores`. Se
 * a redação fosse feita no serviço — que é a tentação óbvia —, um
 * `PATCH { nome }` da enfermagem APAGARIA o custo do item, sem erro nenhum. É a
 * mesma nota que `catalogo.service.ts` carrega, e a mesma razão da regra 17.
 */
function mesclar(atual: LinhaDeItem, d: EditarItemEstoque): SalvarItemEstoque {
  const compraAtual: SalvarItemEstoque['compra'] =
    atual.unid_compra === null
      ? { tem: false }
      : { tem: true, unidade: atual.unid_compra, fator: BigInt(atual.fator_compra!) }
  const usoAtual: SalvarItemEstoque['uso'] =
    atual.unid_uso === null
      ? { tem: false }
      : { tem: true, unidade: atual.unid_uso, fator: BigInt(atual.fator_uso!) }

  return {
    nome: d.nome ?? atual.nome,
    codigo: d.codigo ?? atual.codigo,
    categoria: d.categoria ?? atual.categoria,
    medida: d.medida ?? atual.medida,
    compra: d.compra ?? compraAtual,
    uso: d.uso ?? usoAtual,
    aproveitaSobra: d.aproveitaSobra ?? atual.aproveita_sobra,
    controlaValidade: d.controlaValidade ?? atual.controla_validade,
    altaRotatividade: d.altaRotatividade ?? atual.alta_rotatividade,
    altoValor: d.altoValor ?? (atual.alto_valor as '' | 'sim' | 'nao'),
    // `null` explícito no corpo APAGA o mínimo; ausente preserva. `??` sozinho
    // confundiria os dois e nunca haveria como tirar um mínimo cadastrado.
    minimo: 'minimo' in d ? (d.minimo ?? null) : atual.minimo === null ? null : BigInt(atual.minimo),
    custo: 'custo' in d ? (d.custo ?? null) : atual.custo === null ? null : BigInt(atual.custo),
    localId: 'localId' in d ? (d.localId ?? null) : atual.local_id,
    unidadeId: 'unidadeId' in d ? (d.unidadeId ?? null) : atual.unidade_id,
    responsavelId: 'responsavelId' in d ? (d.responsavelId ?? null) : atual.responsavel_id,
    ativo: d.ativo ?? atual.ativo,
    inicial: null,
  }
}
