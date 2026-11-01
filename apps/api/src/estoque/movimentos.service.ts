import type { ListaDeMovimentos, MovimentoNaLista, RegistrarMovimento } from '@fir/contracts'
import {
  Quantidade,
  type TipoDeMovimento,
  baixaDoItem,
  ehErro,
  paraMedida,
  sinalDoTipo,
} from '@fir/domain'
import {
  Inject,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common'
import type { PessoaId } from '../banco/ator'
import { BancoService } from '../banco/banco.service'
import type { ClinicaId } from '../banco/clinica-id'
import { RELOGIO, type Relogio } from '../comum/relogio'
import { diaDaClinica } from './dia-da-clinica'
import {
  type ItemParaMovimento,
  gravarMovimento,
  itemParaEscrita,
  loteParaSaida,
  quantidadeNaSaida,
} from './movimentos.repositorio'

/**
 * **`movEstoque`** — entrada, saída e ajuste à mão.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * AS QUATRO COISAS QUE ESTA ROTA FAZ E O PROTÓTIPO NÃO
 *
 *  1. **Converte pela unidade DECLARADA.** O corpo traz `{ quantidade, unidade }`
 *     e `paraMedida` o leva para `medida` pelos fatores do CADASTRO (regras 9 e
 *     10). O protótipo recebe um número solto e grava como se já estivesse na
 *     medida — a entrada "2" de quem pensou em caixas vira 2 ampolas.
 *
 *  2. **O SINAL vem do tipo.** Nunca de um campo do corpo. No protótipo,
 *     `sinal` existe só para o ajuste e `Number(m.sinal)===1 ? 1 : -1` faz
 *     **qualquer coisa que não seja 1** virar saída — um corpo sem `sinal` tira
 *     do estoque em silêncio.
 *
 *  3. **O LOTE é obrigatório onde o item controla validade**, e sugerido por
 *     FIFO quando não vem. Sem isso o movimento fica fora do agrupamento por
 *     lote, e o saldo por lote passa a não corresponder a movimento nenhum.
 *
 *  4. **O consumo em paciente gera a SOBRA** quando o item não a aproveita
 *     (regra 15) — pelo MESMO `baixaDoItem` que a baixa automática da sessão
 *     usa. Uma segunda implementação da sobra é a que esquece o descarte.
 * ────────────────────────────────────────────────────────────────────────────
 */

type Contexto = {
  readonly clinicaId: ClinicaId
  readonly ator: PessoaId
  readonly fuso: string
}

/** O sentido do ajuste em palavras — nunca um `1 | -1` que o cliente escolhe. */
const SINAL_DO_AJUSTE = { sobrou: 1n, faltou: -1n } as const

@Injectable()
export class MovimentosService {
  // `@Inject` explícito: o esbuild não emite `design:paramtypes`.
  constructor(
    @Inject(BancoService) private readonly banco: BancoService,
    @Inject(RELOGIO) private readonly relogio: Relogio,
  ) {}

  /**
   * Os últimos movimentos, para a aba "Entradas e saídas".
   *
   * `compensada` é derivado por `EXISTS`, e não por uma coluna `compensado_em`:
   * a tabela é append-only, então marcar a origem exigiria um `UPDATE` que a
   * trigger recusa — e tentar contorná-lo é exatamente como o append-only
   * morre.
   */
  async listar(ctx: Contexto, limite: number): Promise<ListaDeMovimentos> {
    return this.banco.naClinica(ctx.clinicaId, ctx.ator, async (c) => {
      const r = await c.query<LinhaDaLista>(
        `SELECT m.id, m.item_id, i.nome AS item_nome, i.medida, m.tipo,
                m.milesimos::text AS milesimos,
                to_char(m.dia, 'YYYY-MM-DD') AS dia, m.em,
                to_char(m.lote, 'YYYY-MM-DD') AS lote,
                m.custo::text AS custo, m.motivo, m.obs, m.paciente_id,
                (m.compensa_id IS NOT NULL) AS compensa,
                EXISTS (SELECT 1 FROM movimentos_de_estoque x WHERE x.compensa_id = m.id)
                  AS compensada
           FROM movimentos_de_estoque m
           JOIN itens_de_estoque i ON i.id = m.item_id
          ORDER BY m.dia DESC, m.em DESC, m.sequencia DESC
          LIMIT $1`,
        [limite],
      )
      return { movimentos: r.rows.map(paraSaida) }
    })
  }

  /**
   * Registra o movimento — **ou os dois**, quando a dose abre um frasco que a
   * clínica não aproveita.
   *
   * Tudo numa transação só: consumo e descarte da sobra somam a unidade inteira
   * (regra 15), e um deles sem o outro é meio frasco desaparecido do estoque
   * sem nenhum erro na tela.
   */
  async registrar(ctx: Contexto, d: RegistrarMovimento): Promise<ListaDeMovimentos> {
    const hoje = diaDaClinica(this.relogio, ctx.fuso)
    /**
     * **DATA FUTURA É RECUSADA, com o dia do SERVIDOR** (regra 24).
     *
     * O protótipo compara com `today()`, que é o relógio do NAVEGADOR: a
     * recepcionista com o celular adiantado lança a entrada de amanhã, e o
     * estoque passa a ter movimento no futuro — que a análise de período conta
     * no mês errado.
     */
    if (d.dia > hoje) {
      throw new UnprocessableEntityException(
        'A data do movimento não pode ser no futuro. Hoje, nesta clínica, é ' + hoje + '.',
      )
    }

    return this.banco.naClinica(ctx.clinicaId, ctx.ator, async (c) => {
      const item = await itemParaEscrita(c, d.itemId)

      // A CONVERSÃO, pelo cadastro. Unidade não declarada é 422 com a frase do
      // domínio, que já manda conferir as unidades do item.
      const emMedida = paraMedida(Quantidade.deMilesimos(d.quantidade, d.unidade), item)
      if (ehErro(emMedida)) throw de422(emMedida.erro)

      const lote = await this.loteDoMovimento(c, item, d)
      const criados: string[] = []

      if (d.tipo === 'consumo') {
        /**
         * **O MESMO `baixaDoItem` da baixa automática.** Dois movimentos quando
         * o item não aproveita sobra, um quando aproveita — e a conta de qual
         * dos dois casos é este mora no domínio, num lugar só.
         */
        const b = baixaDoItem(Quantidade.deMilesimos(d.quantidade, d.unidade), item)
        if (ehErro(b)) throw de422(b.erro)

        criados.push(
          (
            await gravarMovimento(c, {
              clinicaId: ctx.clinicaId,
              itemId: item.id,
              tipo: 'consumo',
              milesimos: -b.valor.consumo.milesimos,
              dia: d.dia,
              lote,
              obs: d.obs,
              pacienteId: d.pacienteId,
              procedimentoId: d.procedimentoId ?? null,
              aplicadoPorId: d.aplicadoPorId ?? ctx.ator,
              criadoPor: ctx.ator,
            })
          ).id,
        )

        if (b.valor.descarte !== null) {
          criados.push(
            (
              await gravarMovimento(c, {
                clinicaId: ctx.clinicaId,
                itemId: item.id,
                tipo: 'descarte',
                milesimos: -b.valor.descarte.milesimos,
                dia: d.dia,
                // MESMO LOTE do consumo: a sobra é do frasco que foi aberto.
                lote,
                motivo: 'Sobra de frasco aberto',
                obs: d.obs,
                criadoPor: ctx.ator,
              })
            ).id,
          )
        }
      } else {
        const sinal =
          d.tipo === 'ajuste' ? SINAL_DO_AJUSTE[d.sentido] : BigInt(sinalDoTipo(d.tipo) ?? 0)
        criados.push(
          (
            await gravarMovimento(c, {
              clinicaId: ctx.clinicaId,
              itemId: item.id,
              tipo: d.tipo,
              // `contagem` tem sinal 0 e é um PONTO DE PARTIDA, não um delta:
              // ela grava a quantidade contada como está.
              milesimos: d.tipo === 'contagem' ? emMedida.valor.milesimos : sinal * emMedida.valor.milesimos,
              dia: d.dia,
              lote,
              custo: d.tipo === 'entrada' ? (d.custo ?? null) : null,
              motivo: 'motivo' in d ? d.motivo : '',
              obs: d.obs,
              criadoPor: ctx.ator,
            })
          ).id,
        )
      }

      const r = await c.query<LinhaDaLista>(
        `SELECT m.id, m.item_id, i.nome AS item_nome, i.medida, m.tipo,
                m.milesimos::text AS milesimos,
                to_char(m.dia, 'YYYY-MM-DD') AS dia, m.em,
                to_char(m.lote, 'YYYY-MM-DD') AS lote,
                m.custo::text AS custo, m.motivo, m.obs, m.paciente_id,
                (m.compensa_id IS NOT NULL) AS compensa, false AS compensada
           FROM movimentos_de_estoque m
           JOIN itens_de_estoque i ON i.id = m.item_id
          WHERE m.id = ANY($1::uuid[])
          ORDER BY m.sequencia`,
        [criados],
      )
      return { movimentos: r.rows.map(paraSaida) }
    })
  }

  /**
   * O LOTE do movimento: o informado, ou o sugerido por FIFO.
   *
   * Três regras, e cada uma fecha um caso que o protótipo deixa aberto:
   *  - item que **não** controla validade nunca tem lote (um lote ali seria
   *    dado que nenhuma tela sabe mostrar);
   *  - **entrada** exige o lote informado — o FIFO não pode adivinhar a
   *    validade do que acabou de chegar;
   *  - **saída** sem lote informado usa o que vence primeiro, e é recusada se
   *    não houver nenhum: um movimento sem lote num item que controla validade
   *    sai do agrupamento por lote, e aí o saldo por lote deixa de corresponder
   *    a movimento nenhum.
   */
  private async loteDoMovimento(
    c: Parameters<typeof itemParaEscrita>[0],
    item: ItemParaMovimento,
    d: RegistrarMovimento,
  ): Promise<string | null> {
    if (!item.controlaValidade) return null
    const informado = 'lote' in d ? (d.lote ?? null) : null
    if (informado !== null) return informado

    if (d.tipo === 'entrada') {
      throw new UnprocessableEntityException(
        `"${item.nome}" controla validade: informe o vencimento do que chegou.`,
      )
    }
    // A contagem é um ponto de partida: ela declara o que existe por lote, e
    // adivinhar o lote de uma contagem seria inventar a prateleira.
    if (d.tipo === 'contagem') {
      throw new UnprocessableEntityException(
        `"${item.nome}" controla validade: informe o vencimento do que foi contado.`,
      )
    }

    const sugerido = await loteParaSaida(c, item)
    if (sugerido === null) {
      throw new UnprocessableEntityException(
        `"${item.nome}" controla validade e não tem lote com saldo. ` +
          'Registre a entrada com o vencimento antes de dar saída.',
      )
    }
    return sugerido
  }
}

type LinhaDaLista = {
  id: string
  item_id: string
  item_nome: string
  medida: string
  tipo: string
  milesimos: string
  dia: string
  em: Date
  lote: string | null
  custo: string | null
  motivo: string
  obs: string
  paciente_id: string | null
  compensa: boolean
  compensada: boolean
}

const paraSaida = (l: LinhaDaLista): MovimentoNaLista => ({
  id: l.id,
  itemId: l.item_id,
  itemNome: l.item_nome,
  tipo: l.tipo as TipoDeMovimento,
  quantidade: quantidadeNaSaida(Quantidade.deMilesimos(BigInt(l.milesimos), l.medida)),
  dia: l.dia,
  em: l.em.toISOString(),
  lote: l.lote,
  custo: l.custo,
  motivo: l.motivo,
  obs: l.obs,
  pacienteId: l.paciente_id,
  compensa: l.compensa,
  compensada: l.compensada,
})

/**
 * `ErroDeDominio` → 422, com o `codigo` estável no corpo.
 *
 * 422 e não 400: o corpo está bem formado e a permissão existe; o que o
 * servidor recusa é a **coerência** entre o que veio e o cadastro do item.
 * A frase é a do domínio — ela já diz quais unidades o item declarou.
 */
const de422 = (e: { codigo: string; mensagem: string }) =>
  new UnprocessableEntityException({ statusCode: 422, codigo: e.codigo, message: e.mensagem })
