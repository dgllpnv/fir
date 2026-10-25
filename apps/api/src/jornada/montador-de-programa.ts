import type { ItemOrcadoNaSaida } from '@fir/contracts'
import { erro, erroDe, type Result } from '@fir/domain'
import { Injectable } from '@nestjs/common'
import type pg from 'pg'

/**
 * A COSTURA COM O ÉPICO 5, declarada aqui e implementada lá.
 *
 * O fechamento de um orçamento com programa precisa montar o `Programa` na
 * **mesma transação** do recebimento e da etapa — senão a paciente paga, o
 * cartão fecha, e as doze aplicações não existem. Este épico não constrói o
 * épico 5: ele declara a porta pela qual o épico 5 entra, e **recebe a
 * transação aberta** para que a atomicidade seja de quem chama, não de quem é
 * chamado.
 *
 * `programa_orcado` guarda a proposta inteira desde o `registrarOrcamento`.
 * Nada se perde enquanto esta porta não tem implementação: o épico 5 lê a
 * coluna e monta.
 *
 * **Aviso para quem implementar o épico 5:** o `procedimentoId` de cada item
 * NÃO foi validado contra catálogo nenhum — a tabela `procedimentos` não
 * existe nesta árvore. A proposta pode carregar um id que nunca existiu, e a
 * validação é na montagem. Está em `docs/dividas.md`.
 */
export type ProgramaOrcado = {
  readonly tarefaId: string
  readonly pacienteId: string
  readonly itens: readonly ItemOrcadoNaSaida[]
}

export abstract class MontadorDePrograma {
  abstract montar(
    tx: pg.PoolClient,
    dados: ProgramaOrcado,
  ): Promise<Result<{ readonly programaId: string }>>
}

/**
 * O código de domínio que a borda HTTP traduz para **501**.
 *
 * Não é 409: 409 diria que o estado do cartão está errado, e ele não está — o
 * cartão está impecável, o SERVIDOR é que está incompleto. Dizer "conflito"
 * mandaria a recepção procurar o erro no que ela fez.
 */
export const PROGRAMA_AINDA_NAO = 'PROGRAMA_AINDA_NAO'

export const MENSAGEM_PROGRAMA_AINDA_NAO =
  'O programa será montado quando o módulo Programas entrar. ' +
  'Registre o recebimento pela tela Recebimentos.'

/**
 * Até o épico 5. **Recusa em vez de montar pela metade.**
 *
 * A recusa derruba a transação inteira — o recebimento que já tinha sido
 * inserido volta atrás. É a diferença entre "o fechamento não aconteceu" e "o
 * dinheiro entrou e o programa não existe", e só a primeira é recuperável
 * pela recepção sozinha.
 *
 * **O épico 5 troca UMA linha** em `jornada.module.ts`
 * (`useClass: MontadorIndisponivel` → o montador de verdade), e o teste
 * *"o montador indisponível DESFAZ a escrita do dinheiro"* vira o teste do
 * caminho feliz.
 */
@Injectable()
export class MontadorIndisponivel extends MontadorDePrograma {
  async montar(): Promise<Result<{ readonly programaId: string }>> {
    return erro(erroDe(PROGRAMA_AINDA_NAO, MENSAGEM_PROGRAMA_AINDA_NAO))
  }
}
