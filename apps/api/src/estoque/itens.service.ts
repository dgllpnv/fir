import type {
  EditarItemEstoque,
  ItemNaLista,
  ListaDeItens,
  SalvarItemEstoque,
} from '@fir/contracts'
import {
  type ClasseAbc,
  type ItemComUnidades,
  curvaABC,
  deMedidaParaExibicao,
  ehAltoValor,
  ehOk,
  gtinCanonico,
  lotesComSaldo,
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
import { pessoaDoAtor, type Ator, type PessoaId } from '../banco/ator'
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

/**
 * `clinicaCodigo` vem do CONTEXTO, e isto não é conveniência.
 *
 * A primeira escrita deste arquivo lia o código com
 * `SELECT codigo FROM clinicas LIMIT 1`, contando com a RLS para restringir —
 * e **`clinicas` não tem RLS**: ela é a tabela de tenants, não tem
 * `clinica_id`, e a policy por clínica não se aplica a ela. O `LIMIT 1`
 * devolvia a PRIMEIRA clínica do banco, então a etiqueta QR de um item saía
 * com o código de outra clínica — e a câmera não acharia o item. Pego por
 * `estoque.e2e.test.ts`, que esperava `est-…` e recebeu `demo`.
 *
 * O guard já leu a clínica da sessão (ver `contexto.ts`): o valor certo está
 * ali, provado pelo cookie, e não custa consulta nenhuma.
 */
type Contexto = {
  readonly clinicaId: ClinicaId
  readonly ator: Ator
  readonly clinicaCodigo: string
}

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
  local: string | null
  unidade_id: string | null
  responsavel_id: string | null
  gtin: string
  ativo: boolean
}

const COLUNAS = `
  id, nome, codigo, categoria, medida,
  unid_compra, fator_compra::text AS fator_compra,
  unid_uso, fator_uso::text AS fator_uso,
  aproveita_sobra, controla_validade, alta_rotatividade, alto_valor,
  minimo::text AS minimo, custo::text AS custo,
  local_id,
  (SELECT l.nome FROM locais_de_estoque l WHERE l.id = local_id) AS local,
  unidade_id, responsavel_id, gtin, ativo`

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
      const cat = await catalogo(c, ctx.clinicaCodigo)
      return { itens: cat.linhas.map((l) => paraSaida(l, cat)) }
    })
  }

  /**
   * `ligarCodigoItem` — o código de barras da caixa, ligado ao item.
   *
   * "Escolha o item uma vez: nas próximas leituras a ferramenta reconhece
   * sozinha" (MANUAL cap. 12). O código é normalizado para **14 dígitos** com
   * zeros à esquerda: EAN-13 e GTIN-14 do mesmo produto são o mesmo código, e
   * guardá-los sem normalizar faria a leitura do DataMatrix não achar o item
   * cadastrado pelo EAN. O protótipo compara com `padStart(14, '0')` dos dois
   * lados; aqui a forma canônica é GRAVADA, uma vez.
   */
  async ligarCodigo(ctx: Contexto, id: string, gtin: string): Promise<ItemNaLista> {
    return this.banco.naClinica(ctx.clinicaId, ctx.ator, async (c) => {
      await linhaPorId(c, id)
      await gravarGtin(c, ctx.clinicaId, id, gtin)
      return umPorId(c, id, ctx.clinicaCodigo)
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
          criadoPor: pessoaDoAtor(ctx.ator),
        })
      }

      return umPorId(c, id, ctx.clinicaCodigo)
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
      return umPorId(c, id, ctx.clinicaCodigo)
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
    // `gtin` NÃO entra nesta lista: ele passa por `gravarGtin`, o mesmo ponto
    // de `ligarCodigoItem` — a normalização e a frase do conflito existem uma
    // vez. Na edição, `mesclar` já trouxe o código atual quando o corpo não o
    // mandou, então um `PATCH { nome }` não apaga o que a leitura ligou.

    try {
      let gravado: string
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
          [...valores, ctx.clinicaId, pessoaDoAtor(ctx.ator)],
        )
        gravado = r.rows[0]!.id
      } else {
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
        gravado = r.rows[0]!.id
      }
      await gravarGtin(c, ctx.clinicaId, gravado, d.gtin)
      return gravado
    } catch (e) {
      throw traduzirRepetido(e, d)
    }
  }
}

/**
 * O CÓDIGO DE BARRAS DA CAIXA, gravado num ponto só — `ligarCodigoItem` e o
 * campo do cadastro passam por aqui.
 *
 * Normalizado para **14 dígitos** com zeros à esquerda (`gtinCanonico`, do
 * domínio — a mesma função com que a tela compara o que leu com o catálogo):
 * EAN-13 e GTIN-14 do mesmo produto são o mesmo código, e guardá-los sem
 * normalizar faria a leitura do DataMatrix não achar o item cadastrado pelo
 * EAN. `''` tira o código, e não vira catorze zeros.
 *
 * Gravar o código que o item já tem não muda nada: o conflito exclui o próprio
 * item, e o `UPDATE` só escreve quando o valor difere — sem linha nova na
 * trilha por um "salvar" que não mudou o código.
 *
 * **`clinica_id` nas duas consultas**, além da RLS (regra 19: o filtro da
 * aplicação é a segunda camada, nunca a única). Sem ele, uma conexão que
 * escapasse da RLS diria o NOME do item de outra clínica no 409 — e o `UPDATE`
 * por id gravaria o código num item alheio.
 *
 * **A corrida também é 409.** A conferência acima não vê a gravação de outra
 * transação ainda aberta: duas pessoas ligando o mesmo código a dois itens ao
 * mesmo tempo passam as duas por ela, e quem decide é o índice
 * `itens_de_estoque_gtin_unico`. O `23505` dele vira aqui a mesma frase legível
 * — para os DOIS caminhos (`ligarCodigoItem` não passa por `traduzirRepetido`).
 * Sem o nome do outro item: o índice não diz qual é, e ler de novo numa
 * transação já abortada não é possível.
 *
 * Exportada para o teste da segunda camada, que a chama com uma conexão que
 * IGNORA a RLS (`fir_migrate`) — único jeito de provar que o filtro está aqui.
 */
export async function gravarGtin(
  c: Pick<pg.ClientBase, 'query'>,
  clinicaId: ClinicaId,
  id: string,
  gtin: string,
): Promise<void> {
  const canonico = gtin === '' ? '' : gtinCanonico(gtin)
  if (canonico !== '') {
    const outro = await c.query<{ nome: string }>(
      `SELECT nome FROM itens_de_estoque
        WHERE clinica_id = $3 AND gtin = $1 AND id <> $2 AND excluido_em IS NULL`,
      [canonico, id, clinicaId],
    )
    // A frase do protótipo, e ela é útil: dizer QUAL item já tem o código é
    // o que permite à pessoa descobrir que leu a caixa errada.
    if (outro.rows[0] !== undefined) {
      throw new ConflictException(`Este código já está ligado a "${outro.rows[0].nome}".`)
    }
  }
  try {
    await c.query(
      `UPDATE itens_de_estoque SET gtin = $2
        WHERE clinica_id = $3 AND id = $1 AND gtin IS DISTINCT FROM $2`,
      [id, canonico, clinicaId],
    )
  } catch (e) {
    throw traduzirGtinRepetido(e)
  }
}

/** O `23505` do índice do código de barras, a frase única dos dois caminhos. */
function traduzirGtinRepetido(e: unknown): unknown {
  const erro = e as { code?: string; constraint?: string }
  if (erro.code === '23505' && erro.constraint === 'itens_de_estoque_gtin_unico') {
    return new ConflictException('Este código de barras já está ligado a outro item do estoque.')
  }
  return e
}

async function linhaPorId(c: pg.PoolClient, id: string): Promise<LinhaDeItem> {
  const r = await c.query<LinhaDeItem>(`${SELECT_ITEM} AND id = $1`, [id])
  const l = r.rows[0]
  // Sem cláusula de clínica: a RLS já a impõe, e o item da vizinha não existe
  // visto daqui.
  if (l === undefined) throw new NotFoundException('Item de estoque não encontrado.')
  return l
}

/**
 * O CATÁLOGO INTEIRO: linhas, movimentos e a curva ABC, lidos **uma vez**.
 *
 * Existe como uma função só porque a curva é relativa por definição — "este
 * item está entre os 80% do valor em estoque" só existe contra os outros. Dois
 * caminhos calculando-a (a lista e a resposta de uma escrita) seriam duas
 * respostas para a mesma pergunta, e a segunda é a que ficaria errada: medido
 * na primeira escrita deste arquivo, `umPorId` devolvia `'C'` para um item que
 * a lista mostrava como `'A'`, e a tela pintava e despintava o selo "Alto
 * valor" conforme a pessoa salvasse ou recarregasse.
 *
 * Calculada na TELA, ela seria calculada sobre uma lista de `custo: null` para
 * quem não tem `valores` (regra 17) — e o filtro "Só alto valor" da enfermagem
 * devolveria o catálogo todo.
 */
type Catalogo = {
  readonly linhas: readonly LinhaDeItem[]
  readonly movs: Map<string, Parameters<typeof saldoEmMedida>[0]>
  readonly abc: Map<string, ClasseAbc>
  readonly codigoDaClinica: string
}

async function catalogo(c: pg.PoolClient, clinicaCodigo: string): Promise<Catalogo> {
  const r = await c.query<LinhaDeItem>(`${SELECT_ITEM} ORDER BY ativo DESC, nome`)
  // Os movimentos de todos os itens numa consulta só: um `SELECT` por item
  // seria N+1 numa tela que a enfermagem abre várias vezes por dia.
  const movs = await movimentosDosItens(
    c,
    r.rows.map((l) => l.id),
  )
  return {
    linhas: r.rows,
    movs,
    // Só os ATIVOS entram na curva, como no protótipo (`i.ativo !== false`): um
    // item desativado com estoque parado puxaria o denominador e rebaixaria
    // itens que a clínica usa toda semana. Quem não entrou sai como `'C'`.
    abc: curvaABC(
      r.rows
        .filter((l) => l.ativo)
        .map((l) => ({
          id: l.id,
          valor:
            saldoEmMedida(movs.get(l.id) ?? [], l.medida).saldo.milesimos *
            BigInt(l.custo ?? '0'),
        })),
    ),
    codigoDaClinica: clinicaCodigo,
  }
}

async function umPorId(
  c: pg.PoolClient,
  id: string,
  clinicaCodigo: string,
): Promise<ItemNaLista> {
  const cat = await catalogo(c, clinicaCodigo)
  const l = cat.linhas.find((x) => x.id === id)
  if (l === undefined) throw new NotFoundException('Item de estoque não encontrado.')
  return paraSaida(l, cat)
}

function paraSaida(l: LinhaDeItem, cat: Catalogo): ItemNaLista {
  const movs = cat.movs.get(l.id) ?? []
  const classe = cat.abc.get(l.id) ?? 'C'
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
  // Os lotes com saldo, em ordem de validade — o FIFO inteiro (regra 15). A
  // ficha do item os mostra, e `loteSugerido` é o primeiro deles: uma segunda
  // consulta para "qual vence antes" seria a segunda implementação do FIFO.
  const lotes = lotesComSaldo(movs, l.medida)

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
    local: l.local,
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
    loteSugerido: lotes[0]?.lote ?? null,
    lotes: lotes.map((x) => ({ lote: x.lote, quantidade: quantidadeNaSaida(x.saldo) })),
    gtin: l.gtin,
    /**
     * A ETIQUETA QR, montada no SERVIDOR.
     *
     * `FRMEST:<código da clínica>:<id>` — o mesmo formato do protótipo
     * (`codigoQrItem`). Montado no navegador, imprimir no desktop e ler no
     * celular dependeria de duas implementações concordarem, e a que não
     * concordasse imprimiria etiqueta que a câmera não reconhece — numa folha
     * já colada na geladeira.
     */
    codigoQr: `FRMEST:${cat.codigoDaClinica}:${l.id}`,
    curvaAbc: classe,
    ehAltoValor: ehAltoValor(l.alto_valor as '' | 'sim' | 'nao', classe),
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
  // A corrida do código de barras já sai de `gravarGtin` traduzida; isto
  // cobre só o caso de o índice disparar fora dela.
  return traduzirGtinRepetido(e)
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
    // Ausente preserva o código que a leitura ligou; `''` explícito o tira.
    gtin: d.gtin ?? atual.gtin,
    inicial: null,
  }
}
