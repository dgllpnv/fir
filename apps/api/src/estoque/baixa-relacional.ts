import { type Result, baixaDoItem, ehErro, ok } from '@fir/domain'
import { Injectable } from '@nestjs/common'
import type { PessoaId } from '../banco/ator'
import type { ClinicaId } from '../banco/clinica-id'
import type { Transacao } from '../banco/transacao'
import {
  BaixaDeInsumos,
  type MotivoDeDesfazer,
  type PedidoDeBaixa,
} from '../programas/baixa-de-insumos'
import {
  gravarMovimento,
  itemParaEscrita,
  loteParaSaida,
} from './movimentos.repositorio'

/**
 * **O SEAM `BaixaDeInsumos`, LIGADO.**
 *
 * Até aqui ele era `BaixaInerte` — um `ok(undefined)` que deixava o épico 5
 * funcionar sem estoque configurado. Esta é a implementação relacional que
 * `baixa-de-insumos.test.ts` descreve há um épico, e os três invariantes que
 * ela herda estão escritos lá:
 *
 *  1. `desfazer` restaura **exatamente** o que `baixar` tirou — mesma
 *     quantidade, **mesmo lote** — por movimento COMPENSATÓRIO ligado por
 *     `tarefaId`, nunca `DELETE`.
 *  2. A ida-e-volta é **idempotente**: concluir → reabrir → concluir → reabrir
 *     devolve saldo E LOTE ao ponto inicial.
 *  3. Item que não aproveita sobra gera **DOIS** movimentos na baixa, e
 *     `desfazer` compensa **os dois**.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * O QUE MUDOU EM RELAÇÃO À IMPLEMENTAÇÃO DE REFERÊNCIA EM MEMÓRIA
 *
 * Duas coisas que o teste do seam pedia ao esquema, e que o esquema entrega:
 *
 *  - **A idempotência não está aqui.** Ela é `UNIQUE (compensa_id)` na `0015`.
 *    O `BaixaEmMemoria` mantinha um `Set` de já-compensados; aqui a segunda
 *    chamada simplesmente não tem o que compensar, porque a consulta exclui o
 *    que já foi. E se duas abas corressem, o índice recusaria a segunda — que é
 *    a parte que nenhum `Set` em processo alcança.
 *  - **O espelhamento também não está aqui.** A trigger
 *    `compensacao_espelha_a_origem` confere item, tipo, lote e quantidade
 *    oposta. Escrever a conferência neste arquivo seria confiar em quem
 *    escrever o terceiro caminho de reversão.
 *
 * **Deliberadamente SEM recusa por saldo insuficiente.** A enfermagem aplicou a
 * dose; recusar o registro porque o saldo do sistema diz que não havia frasco
 * transformaria "o estoque está desatualizado" em "a aplicação não pode ser
 * registrada". O saldo negativo é a informação, e `saldoEmMedida` não o clampa
 * justamente para que ele apareça.
 * ────────────────────────────────────────────────────────────────────────────
 */
@Injectable()
export class BaixaRelacional extends BaixaDeInsumos {
  async baixar(tx: Transacao, pedido: PedidoDeBaixa): Promise<Result<void>> {
    for (const insumo of pedido.insumos) {
      /**
       * O ITEM QUE NÃO EXISTE É IGNORADO, não é erro — e isso é deliberado.
       *
       * O procedimento guarda `insumo_padrao_id`, que pode apontar para um item
       * excluído do estoque. Recusar a conclusão da sessão por causa disso
       * transformaria uma falha de cadastro em "a enfermagem não consegue
       * registrar que aplicou". O protótipo faz o mesmo
       * (`.filter(x => E0.itens.some(i => i.id === x.itemId))`).
       */
      const item = await itemSeExistir(tx, insumo.itemId)
      if (item === null) continue

      const b = baixaDoItem(insumo.quantidade, item)
      if (ehErro(b)) return b

      const lote = await loteParaSaida(tx, item)

      await gravarMovimento(tx, {
        clinicaId: pedido.clinicaId,
        itemId: item.id,
        tipo: 'consumo',
        milesimos: -b.valor.consumo.milesimos,
        dia: pedido.em,
        lote,
        obs: rotuloDoConsumo(pedido),
        pacienteId: pedido.pacienteId,
        procedimentoId: pedido.procedimentoId,
        aplicadoPorId: pedido.aplicadoPorId,
        tarefaId: pedido.tarefaId,
        programaId: pedido.programaId,
        itemChave: pedido.itemChave,
        criadoPor: pedido.aplicadoPorId,
      })

      /**
       * **A SOBRA, e ela é um movimento SEPARADO** (regra 15).
       *
       * `baixaDoItem` só a devolve para o item que declara unidade de uso e não
       * aproveita sobra. O `principal` do pedido é a segunda guarda: uma
       * seringa não tem sobra de frasco aberto, e tratar os dois igual somaria
       * unidades de descartável que ninguém abriu.
       *
       * `pacienteId` **não** viaja no descarte: a sobra não foi aplicada em
       * ninguém, e pô-la na ficha da paciente diria que ela recebeu o dobro da
       * dose. O protótipo faz a mesma limpeza (`pacienteId: ''`).
       */
      if (insumo.principal && b.valor.descarte !== null) {
        await gravarMovimento(tx, {
          clinicaId: pedido.clinicaId,
          itemId: item.id,
          tipo: 'descarte',
          milesimos: -b.valor.descarte.milesimos,
          dia: pedido.em,
          // MESMO LOTE do consumo: a sobra é do frasco que foi aberto.
          lote,
          motivo: 'Sobra de frasco aberto',
          obs: 'Sobra de frasco aberto',
          tarefaId: pedido.tarefaId,
          programaId: pedido.programaId,
          itemChave: pedido.itemChave,
          criadoPor: pedido.aplicadoPorId,
        })
      }
    }
    return ok(undefined)
  }

  /**
   * A COMPENSAÇÃO, ligada por `tarefaId` — **nunca `DELETE`** (regra 12).
   *
   * Uma linha nova por movimento de origem, com o MESMO item, o MESMO tipo, o
   * MESMO lote e a quantidade OPOSTA. A trigger `compensacao_espelha_a_origem`
   * recusa qualquer desvio; este `INSERT … SELECT` é o que produz os valores
   * certos, e ele os tira da própria origem em vez de recalculá-los.
   *
   * **Recalcular seria o defeito.** Se a dose do item do programa mudasse entre
   * a conclusão e a reabertura — ou se o `fator_uso` do item fosse corrigido —,
   * uma compensação recalculada devolveria uma quantidade diferente da que
   * saiu, e a diferença ficaria no estoque para sempre, sem erro nenhum.
   *
   * **IDEMPOTENTE** pelo `NOT EXISTS` mais o `UNIQUE (compensa_id)` da `0015`:
   * reabrir duas vezes não devolve a dose duas vezes, e duas abas correndo têm
   * a segunda recusada pelo banco.
   */
  async desfazer(
    tx: Transacao,
    clinicaId: ClinicaId,
    tarefaId: string,
    motivo: MotivoDeDesfazer,
  ): Promise<Result<void>> {
    await tx.query(
      `INSERT INTO movimentos_de_estoque
         (clinica_id, item_id, tipo, milesimos, dia, lote, motivo, obs,
          tarefa_id, programa_id, item_chave,
          compensa_id, compensa_motivo, criado_por)
       SELECT o.clinica_id, o.item_id, o.tipo, -o.milesimos, o.dia, o.lote,
              o.motivo, $3, o.tarefa_id, o.programa_id, o.item_chave,
              o.id, $2, $4
         FROM movimentos_de_estoque o
        WHERE o.tarefa_id = $1
          AND o.compensa_id IS NULL
          AND NOT EXISTS (SELECT 1 FROM movimentos_de_estoque x WHERE x.compensa_id = o.id)`,
      [tarefaId, motivo, rotuloDoDesfazer(motivo), atorDoDesfazer(clinicaId)],
    )
    return ok(undefined)
  }
}

/**
 * O item, ou `null` — sem lançar.
 *
 * `itemParaEscrita` lança 404, que é o certo para `movEstoque` (a recepção
 * escolheu um item que não existe) e errado aqui (o procedimento aponta para um
 * item excluído, e a sessão tem de concluir de qualquer forma).
 */
async function itemSeExistir(
  tx: Transacao,
  itemId: string,
): Promise<Awaited<ReturnType<typeof itemParaEscrita>> | null> {
  try {
    return await itemParaEscrita(tx, itemId)
  } catch {
    return null
  }
}

/**
 * O rótulo do movimento — "Sessão 5 · Fernanda" no protótipo.
 *
 * **SEM NOME DE PACIENTE.** `obs` é texto livre que atravessa para a trilha de
 * auditoria e para a lista de movimentos, e `paciente_id` já diz de quem é a
 * aplicação — com a RLS e a permissão protegendo a leitura. Copiar o nome para
 * dentro de um campo de texto cria um segundo lugar com PII, que a redação não
 * alcança e a desativação de paciente não limpa (regra 21).
 */
const rotuloDoConsumo = (p: PedidoDeBaixa): string =>
  p.itemChave === null ? 'Procedimento' : `Sessão do item ${p.itemChave}`

const rotuloDoDesfazer = (motivo: MotivoDeDesfazer): string =>
  motivo === 'sessao-reaberta' ? 'Sessão reaberta' : 'Programa excluído'

/**
 * O ATOR do movimento compensatório.
 *
 * O seam não recebe a pessoa que reabriu — ele recebe a clínica e a tarefa. E
 * não deveria receber: quem reabriu já está na TRILHA, gravada pelo trigger
 * `registrar_auditoria` a partir de `app.pessoa_id`, que é o ator da transação
 * de quem chamou. Um `criado_por` aqui seria um segundo registro de quem fez a
 * coisa, e o segundo é o que fica errado.
 *
 * `criado_por` fica nulo de propósito, e a pergunta "quem reabriu" se responde
 * na trilha — que é onde ela já tem resposta.
 */
const atorDoDesfazer = (_clinicaId: ClinicaId): PessoaId | null => null
