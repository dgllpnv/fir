import type { Dinheiro, Quantidade, Result } from '@fir/domain'
import type { PessoaId } from '../banco/ator'
import type { ClinicaId } from '../banco/clinica-id'
import type { Transacao } from '../banco/transacao'

/**
 * O SEAM QUE O ÉPICO 3 DECLAROU — e que MUDA DE CASA.
 *
 * O épico 3 o anunciou em `apps/api/src/jornada/montador-de-programa.ts`; ele
 * mora aqui porque o seam pertence ao módulo que POSSUI o conceito, e
 * `jornada → programas` é a dependência que o DADO já tem
 * (`tarefas.programa_orcado` guarda `procedimentoId` desde o épico 3). O
 * inverso seria ciclo de módulo, e a saída para o ciclo seria um
 * `forwardRef`, que é onde a ordem de inicialização vira defeito
 * intermitente.
 *
 * A ASSINATURA DO ÉPICO 3 ERA INSUFICIENTE, e ampliá-la é parte desta
 * entrega. Ele declarou `montar(tx, dados: ProgramaOrcado)`, e
 * `ProgramaOrcado` é só a lista de itens: não diz de que PACIENTE é, de que
 * CLÍNICA, qual o INÍCIO, quem é o ATOR, qual o RECEBIMENTO que precisa
 * receber `programa_id`, nem qual é a DATA DE NEGÓCIO DO SERVIDOR. Montar com
 * `new Date()` dentro do montador quebraria a regra 24 em silêncio.
 */

export type ItemParaMontar = {
  readonly chave: string
  readonly procedimentoId: string
  readonly sessoes: number
  readonly intervaloDias: number
  readonly inicio: string | null
  readonly depoisDe: string | null
  /** `null` → o responsável padrão do procedimento. */
  readonly responsavelId: string | null
  readonly dose: string | null
  /** `null` → rateado do `valorTotal`. */
  readonly valor: Dinheiro | null
  readonly insumo: { readonly itemId: string; readonly quantidade: Quantidade } | null
}

export type PedidoDeMontagem = {
  readonly clinicaId: ClinicaId
  readonly pacienteId: string
  /** Dia civil, no fuso da clínica. NUNCA do relógio do cliente (regra 24). */
  readonly inicio: string
  readonly itens: readonly ItemParaMontar[]
  readonly hora: string | null
  readonly unidadeId: string | null
  /** O cartão de orçamento que fechou, ou `null` em `POST /v1/programas`. */
  readonly tarefaDeOrigemId: string | null
  /**
   * O recebimento da adesão, criado por QUEM CHAMA, na mesma transação.
   * Recebe `programa_id` para que o saldo do épico 4 agrupe (regra 5).
   */
  readonly recebimentoDaAdesaoId: string | null
  /**
   * O total negociado. `null` = programa sem total (cada sessão registra o
   * que foi pago no dia). Rateado entre os itens que não trazem valor.
   */
  readonly valorTotal: Dinheiro | null
  readonly modoDeCobranca: 'avulso' | 'saldo'
  readonly atorId: PessoaId
  readonly hojeDaClinica: string
}

export type ProgramaMontado = {
  readonly programaId: string
  readonly sessoes: readonly {
    readonly tarefaId: string
    readonly itemChave: string
    readonly indice: number
    readonly prazo: string
  }[]
  /** Contatos de retorno cancelados por "Paciente refez o procedimento". */
  readonly retornosCancelados: readonly string[]
}

export abstract class MontadorDePrograma {
  /**
   * Monta o programa inteiro — itens, sessões e o cancelamento dos contatos
   * de retorno — DENTRO da transação de quem chama.
   *
   * A atomicidade é de quem chama, não de quem é chamado: `fechar` precisa
   * que o recebimento, a etapa e o programa vivam ou morram juntos. Senão a
   * paciente paga, o cartão fecha, e as doze aplicações não existem.
   */
  abstract montar(tx: Transacao, pedido: PedidoDeMontagem): Promise<Result<ProgramaMontado>>
}

/**
 * O código de domínio que a borda HTTP traduz para **409**.
 *
 * Não é 400: o corpo está bem formado e os ids são uuids de verdade. O que
 * mudou foi o ESTADO do catálogo — alguém excluiu o procedimento entre o
 * orçamento e o fechamento. A mensagem nomeia o item, porque "procedimento
 * não encontrado" num programa de doze itens não diz à recepção o que
 * corrigir.
 */
export const PROCEDIMENTO_FORA_DO_CATALOGO = 'PROCEDIMENTO_FORA_DO_CATALOGO'

/** 400: o responsável saiu da clínica, ou nunca foi desta clínica. */
export const RESPONSAVEL_INVALIDO = 'RESPONSAVEL_INVALIDO'
