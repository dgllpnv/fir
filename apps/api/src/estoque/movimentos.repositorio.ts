import {
  type ItemComUnidades,
  type MovimentoDeEstoque,
  type Quantidade,
  type TipoDeMovimento,
  loteSugerido,
  saldoEmMedida,
} from '@fir/domain'
import { NotFoundException } from '@nestjs/common'
import type { PessoaId } from '../banco/ator'
import type { ClinicaId } from '../banco/clinica-id'
import type { Transacao } from '../banco/transacao'

/**
 * A ESCRITA E A LEITURA DE MOVIMENTO, **num lugar só**.
 *
 * Quem grava movimento é: `movEstoque` (à mão), a contagem inicial do cadastro,
 * a baixa automática da sessão, e o `desfazer` dela. Quatro caminhos, e é
 * exatamente a situação que o `CLAUDE.md` descreve: o quarto não é revisado com
 * o cuidado do primeiro. Então os quatro passam por `gravarMovimento`, e as
 * invariantes que o banco não alcança — a conversão para `medida`, o sinal, o
 * lote — ficam aqui, antes do `INSERT`.
 *
 * **Nada aqui abre transação.** Todos recebem a transação de quem chama, porque
 * concluir uma sessão e dar baixa na dose vivem ou morrem juntas.
 */

type LinhaDeItem = {
  id: string
  nome: string
  medida: string
  unid_compra: string | null
  fator_compra: string | null
  unid_uso: string | null
  fator_uso: string | null
  aproveita_sobra: boolean
  controla_validade: boolean
  custo: string | null
  excluido_em: Date | null
}

export type ItemParaMovimento = ItemComUnidades & {
  readonly id: string
  readonly nome: string
  readonly controlaValidade: boolean
}

export const COLUNAS_DE_ITEM = `
  id, nome, medida, unid_compra, fator_compra::text AS fator_compra,
  unid_uso, fator_uso::text AS fator_uso, aproveita_sobra, controla_validade,
  custo::text AS custo, excluido_em`

const paraItem = (l: LinhaDeItem): ItemParaMovimento => ({
  id: l.id,
  nome: l.nome,
  medida: l.medida,
  unidCompra: l.unid_compra,
  fatorCompra: l.fator_compra === null ? null : BigInt(l.fator_compra),
  unidUso: l.unid_uso,
  fatorUso: l.fator_uso === null ? null : BigInt(l.fator_uso),
  aproveitaSobra: l.aproveita_sobra,
  controlaValidade: l.controla_validade,
})

/**
 * O item com as unidades, travado para a escrita.
 *
 * `FOR UPDATE` porque a conversão e o lote dependem do CADASTRO: sem o lock,
 * uma edição de `fator_uso` entre a leitura e o `INSERT` faria a dose ser
 * convertida por um fator que já não é o do item. Sem cláusula de clínica — a
 * RLS já a impõe, e o item da vizinha não existe visto daqui.
 */
export async function itemParaEscrita(
  tx: Transacao,
  itemId: string,
): Promise<ItemParaMovimento> {
  const r = await tx.query<LinhaDeItem>(
    `SELECT ${COLUNAS_DE_ITEM} FROM itens_de_estoque WHERE id = $1 FOR UPDATE`,
    [itemId],
  )
  const l = r.rows[0]
  if (l === undefined || l.excluido_em !== null) {
    throw new NotFoundException('Item de estoque não encontrado.')
  }
  return paraItem(l)
}

type LinhaDeMovimento = {
  id: string
  tipo: string
  milesimos: string
  sequencia: string
  dia: string
  em: Date
  lote: string | null
  compensa_id: string | null
  contagem_id: string | null
}

/**
 * Todos os movimentos de um item, na forma que o DOMÍNIO calcula.
 *
 * **Todos**, e não "a partir da última contagem": quem decide onde a contagem
 * corta é `saldoEmMedida`, no domínio, e duplicar esse recorte em SQL seria a
 * segunda implementação da regra 11. Um item de uma clínica tem dezenas de
 * movimentos por ano, não milhões.
 *
 * `dia` sai como texto (`to_char`) de propósito: `date` vira `Date` no driver,
 * e aí o fuso do processo decidiria o dia civil — exatamente o que a regra 22
 * proíbe.
 */
export async function movimentosDoItem(
  tx: Transacao,
  itemId: string,
): Promise<MovimentoDeEstoque[]> {
  const r = await tx.query<LinhaDeMovimento>(
    `SELECT id, tipo, milesimos::text AS milesimos, sequencia::text AS sequencia,
            to_char(dia, 'YYYY-MM-DD') AS dia, em,
            to_char(lote, 'YYYY-MM-DD') AS lote, compensa_id, contagem_id
       FROM movimentos_de_estoque
      WHERE item_id = $1
      ORDER BY dia, em, sequencia`,
    [itemId],
  )
  return r.rows.map((l) => ({
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
}

/** Os movimentos de VÁRIOS itens de uma vez, para a lista não fazer N consultas. */
export async function movimentosDosItens(
  tx: Transacao,
  itemIds: readonly string[],
): Promise<Map<string, MovimentoDeEstoque[]>> {
  const fora = new Map<string, MovimentoDeEstoque[]>()
  if (itemIds.length === 0) return fora
  const r = await tx.query<LinhaDeMovimento & { item_id: string }>(
    `SELECT item_id, id, tipo, milesimos::text AS milesimos, sequencia::text AS sequencia,
            to_char(dia, 'YYYY-MM-DD') AS dia, em,
            to_char(lote, 'YYYY-MM-DD') AS lote, compensa_id, contagem_id
       FROM movimentos_de_estoque
      WHERE item_id = ANY($1::uuid[])
      ORDER BY dia, em, sequencia`,
    [[...itemIds]],
  )
  for (const l of r.rows) {
    const m: MovimentoDeEstoque = {
      id: l.id,
      sequencia: BigInt(l.sequencia),
      tipo: l.tipo as TipoDeMovimento,
      milesimos: BigInt(l.milesimos),
      dia: l.dia,
      em: l.em.toISOString(),
      lote: l.lote,
      compensaId: l.compensa_id,
      contagemId: l.contagem_id,
    }
    const lista = fora.get(l.item_id)
    if (lista === undefined) fora.set(l.item_id, [m])
    else lista.push(m)
  }
  return fora
}

/**
 * O lote SUGERIDO para uma saída: o que vence primeiro com saldo (FIFO,
 * regra 15).
 *
 * `null` quando o item não tem lote nenhum — e isso não é erro: item que não
 * controla validade nunca tem lote.
 */
export async function loteParaSaida(
  tx: Transacao,
  item: ItemParaMovimento,
): Promise<string | null> {
  if (!item.controlaValidade) return null
  return loteSugerido(await movimentosDoItem(tx, item.id), item.medida)
}

export async function saldoDoItem(tx: Transacao, item: ItemParaMovimento) {
  return saldoEmMedida(await movimentosDoItem(tx, item.id), item.medida)
}

export type MovimentoParaGravar = {
  readonly clinicaId: ClinicaId
  readonly itemId: string
  readonly tipo: TipoDeMovimento
  /**
   * **ASSINADO e em `medida`.** Quem chama já converteu por `paraMedida` e já
   * aplicou o sinal. O `CHECK sinal_combina_com_tipo` da 0015 é a rede: um
   * consumo positivo é recusado pelo banco, não por este arquivo.
   */
  readonly milesimos: bigint
  /** Dia civil no fuso da CLÍNICA (regra 22). */
  readonly dia: string
  readonly lote: string | null
  readonly custo?: bigint | null
  readonly motivo?: string
  readonly obs?: string
  readonly pacienteId?: string | null
  readonly procedimentoId?: string | null
  readonly aplicadoPorId?: string | null
  readonly tarefaId?: string | null
  readonly programaId?: string | null
  readonly itemChave?: string | null
  readonly compensaId?: string | null
  readonly compensaMotivo?: string
  /**
   * O GRUPO de contagem: uma linha por lote contado, todas da mesma contagem.
   *
   * Só em `tipo = 'contagem'` (a 0017 cobra com um `CHECK`). Sem ele, o saldo
   * leria só a última linha e os outros lotes desapareceriam da prateleira.
   */
  readonly contagemId?: string | null
  /** A NOTA que trouxe esta entrada. Só em `tipo = 'entrada'`. */
  readonly notaId?: string | null
  readonly criadoPor: PessoaId
}

/**
 * O `INSERT`, e **nada mais**.
 *
 * Deliberadamente burro: as validações de forma estão no contrato, as de
 * coerência entre colunas estão nos `CHECK` da 0015, e a de espelhamento da
 * compensação está na trigger. Repeti-las aqui criaria uma segunda versão de
 * cada uma — e seria a desta camada que ficaria desatualizada, porque é a que
 * se edita com mais frequência.
 */
export async function gravarMovimento(
  tx: Transacao,
  m: MovimentoParaGravar,
): Promise<{ id: string }> {
  const r = await tx.query<{ id: string }>(
    `INSERT INTO movimentos_de_estoque
       (clinica_id, item_id, tipo, milesimos, dia, lote, custo, motivo, obs,
        paciente_id, procedimento_id, aplicado_por_id,
        tarefa_id, programa_id, item_chave,
        compensa_id, compensa_motivo, contagem_id, nota_id, criado_por)
     VALUES ($1,$2,$3,$4,$5::date,$6::date,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
     RETURNING id`,
    [
      m.clinicaId,
      m.itemId,
      m.tipo,
      m.milesimos.toString(),
      m.dia,
      m.lote,
      m.custo === undefined || m.custo === null ? null : m.custo.toString(),
      m.motivo ?? '',
      m.obs ?? '',
      m.pacienteId ?? null,
      m.procedimentoId ?? null,
      m.aplicadoPorId ?? null,
      m.tarefaId ?? null,
      m.programaId ?? null,
      m.itemChave ?? null,
      m.compensaId ?? null,
      m.compensaMotivo ?? '',
      m.contagemId ?? null,
      m.notaId ?? null,
      m.criadoPor,
    ],
  )
  return r.rows[0]!
}

/** A quantidade de saída, já formatada pelo domínio — a tela não formata número. */
export const quantidadeNaSaida = (q: Quantidade) => ({
  milesimos: q.milesimos.toString(),
  unidade: q.unidade,
  texto: q.formatar(),
})
