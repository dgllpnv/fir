import { erro, erroDe, type Result } from '@fir/domain'
import { Injectable } from '@nestjs/common'
import {
  MontadorDePrograma,
  type ProgramaMontado,
} from '../programas/montador-de-programa'

/**
 * A COSTURA MUDOU DE CASA — e aqui ficou só o provider de transição.
 *
 * `MontadorDePrograma` nasceu neste arquivo, no épico 3. O épico 5 o moveu
 * para `apps/api/src/programas/montador-de-programa.ts`, porque o seam
 * pertence ao módulo que POSSUI o conceito, e `jornada → programas` é a
 * dependência que o DADO já tem (`tarefas.programa_orcado` guarda
 * `procedimentoId` desde o épico 3). O inverso seria ciclo de módulo.
 *
 * A ASSINATURA TAMBÉM MUDOU, e isso era inevitável: `ProgramaOrcado` era só a
 * lista de itens — não dizia de que clínica, qual o início, quem é o ator,
 * qual o recebimento que precisa receber `programa_id`, nem qual é a data de
 * negócio do servidor. Montar com `new Date()` lá dentro quebraria a regra 24
 * em silêncio.
 *
 * **O QUE FALTA PARA `fechar` FUNCIONAR (Task 8 do plano do épico 5):**
 * trocar o provider em `jornada.module.ts` por `MontadorRelacional` (via
 * `imports: [ProgramasModule]`) e APAGAR este arquivo. Ele fica até lá
 * porque `MontadorRelacional` já existe e funciona: deixá-lo ligado sem os
 * testes do fechamento seria entregar o caminho do dinheiro sem a prova de
 * que ele é atômico.
 */

export const PROGRAMA_AINDA_NAO = 'PROGRAMA_AINDA_NAO'

export const MENSAGEM_PROGRAMA_AINDA_NAO =
  'O programa será montado quando o módulo Programas entrar. ' +
  'Registre o recebimento pela tela Recebimentos.'

/**
 * **Recusa em vez de montar pela metade.**
 *
 * A recusa derruba a transação inteira — o recebimento que já tinha sido
 * inserido volta atrás. É a diferença entre "o fechamento não aconteceu" e "o
 * dinheiro entrou e o programa não existe", e só a primeira é recuperável
 * pela recepção sozinha.
 */
@Injectable()
export class MontadorIndisponivel extends MontadorDePrograma {
  async montar(): Promise<Result<ProgramaMontado>> {
    return erro(erroDe(PROGRAMA_AINDA_NAO, MENSAGEM_PROGRAMA_AINDA_NAO))
  }
}
