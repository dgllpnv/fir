import { ok, type Quantidade, type Result } from '@fir/domain'
import { Injectable } from '@nestjs/common'
import type { PessoaId } from '../banco/ator'
import type { ClinicaId } from '../banco/clinica-id'
import type { Transacao } from '../banco/transacao'

/**
 * **A COSTURA COM O ÉPICO 6, declarada aqui e implementada lá.**
 *
 * Mesmo movimento que o épico 3 fez com o `MontadorDePrograma`: este épico não
 * constrói o estoque, ele declara a porta pela qual o estoque entra, e recebe
 * a transação **aberta por quem chama** para que a atomicidade seja de quem
 * chama. Concluir uma sessão e dar baixa na dose vivem ou morrem juntas: a
 * enfermagem precisa saber que o frasco acabou **antes** de registrar que
 * aplicou.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * O QUE O ÉPICO 6 TERÁ DE HONRAR, e que já tem teste nesta árvore
 * (`sessoes.test.ts`, contra o espião; e `baixa-de-insumos.test.ts`, contra
 * uma implementação de referência que mantém movimentos em memória):
 *
 *   1. **`desfazer` restaura EXATAMENTE o que `baixar` tirou** — mesma
 *      quantidade, mesmo lote — por movimento **compensatório** ligado por
 *      `tarefaId`, nunca `DELETE` (regra 12).
 *
 *   2. **A ida-e-volta é idempotente:** concluir → reabrir → concluir →
 *      reabrir devolve **saldo E LOTE** ao ponto inicial. Saldo certo com lote
 *      errado é a dose do frasco vencido aplicada na próxima paciente.
 *
 *   3. **Item que não aproveita sobra gera DOIS movimentos na baixa** —
 *      consumo da dose + descarte "Sobra de frasco aberto", somando a unidade
 *      inteira (regra 15) — e `desfazer` compensa **OS DOIS**. É o segundo que
 *      a implementação ingênua esquece, porque o descarte não está no que a
 *      sessão pediu: ele está no que o frasco perdeu.
 *
 * O protótipo **APAGA** os movimentos ao excluir a adesão
 * (`movs.filter(m => !removidos.includes(m.id))`). Essa linha não atravessa.
 * ────────────────────────────────────────────────────────────────────────────
 */

export type InsumoParaBaixa = {
  readonly itemId: string
  /** Na unidade DECLARADA no cadastro. A dose nunca anda sem a unidade. */
  readonly quantidade: Quantidade
  /**
   * O insumo do ITEM DO PROGRAMA (a dose), e não um descartável fixo.
   *
   * Só o principal pode gerar descarte de sobra de frasco aberto: uma seringa
   * não tem sobra, e tratar as duas igual faria o descarte somar unidades de
   * descartável que ninguém abriu.
   */
  readonly principal: boolean
}

export type PedidoDeBaixa = {
  readonly clinicaId: ClinicaId
  readonly tarefaId: string
  readonly pacienteId: string
  readonly procedimentoId: string
  readonly programaId: string | null
  readonly itemChave: string | null
  readonly aplicadoPorId: PessoaId
  /** Dia civil da realização, no fuso da clínica. */
  readonly em: string
  readonly insumos: readonly InsumoParaBaixa[]
}

/**
 * **Por que o motivo viaja, e por que ele é uma união fechada.**
 *
 * Os dois desfazeres parecem iguais e não são: `sessao-reaberta` é uma
 * correção de lançamento de uma sessão só, e `programa-excluido` desfaz tudo
 * de um registro feito por engano. O épico 6 grava o motivo no movimento
 * compensatório, e é por ele que a análise do estoque explica uma devolução
 * que ninguém contou na prateleira.
 */
export type MotivoDeDesfazer = 'sessao-reaberta' | 'programa-excluido'

export abstract class BaixaDeInsumos {
  abstract baixar(tx: Transacao, pedido: PedidoDeBaixa): Promise<Result<void>>

  /**
   * Compensação ligada por `tarefaId`. **NUNCA `DELETE`** (regra 12).
   *
   * Idempotente por contrato: chamar duas vezes para a mesma tarefa não
   * devolve a dose duas vezes. Reabrir, reabrir de novo (ou reabrir e depois
   * excluir o programa) acontece no balcão, e o estoque não pode crescer por
   * isso.
   */
  abstract desfazer(
    tx: Transacao,
    clinicaId: ClinicaId,
    tarefaId: string,
    motivo: MotivoDeDesfazer,
  ): Promise<Result<void>>
}

/**
 * **Até o épico 6. Não falha: o programa funciona sem estoque configurado.**
 *
 * Deliberadamente inerte, e não um `throw`: a clínica que ainda não cadastrou
 * item de estoque nenhum continua montando programas e concluindo sessões. Uma
 * recusa aqui transformaria "o estoque não entrou ainda" em "a enfermagem não
 * consegue registrar a aplicação".
 *
 * **Quando o épico 6 chegar, troque o provider em `programas.module.ts` — uma
 * linha — e APAGUE esta classe.** Provider alternativo que ninguém usa é o
 * lugar onde a próxima pessoa pluga sem perceber; foi a lição do
 * `MontadorIndisponivel`, que o épico 3 deixou e a Task 8 do épico 5 removeu.
 */
@Injectable()
export class BaixaInerte extends BaixaDeInsumos {
  async baixar(): Promise<Result<void>> {
    return ok(undefined)
  }

  async desfazer(): Promise<Result<void>> {
    return ok(undefined)
  }
}
