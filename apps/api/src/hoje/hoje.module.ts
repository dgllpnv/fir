import { Module } from '@nestjs/common'
import { FinanceiroModule } from '../financeiro/financeiro.module'
import { ProgramasModule } from '../programas/programas.module'
import { TarefasModule } from '../tarefas/tarefas.module'
import { HojeController } from './hoje.controller'

/**
 * **A TELA HOJE TEM MÓDULO PRÓPRIO — e o épico 5 é quem a obrigou.**
 *
 * Até aqui `HojeController` morava em `TarefasModule`, porque ele compunha
 * duas leituras: as tarefas e o bloco financeiro (`tarefas → financeiro`, mão
 * única). O épico 5 acrescentou a terceira — as sessões de programas — e
 * `ProgramasModule` **importa** `TarefasModule`. Deixar o controlador onde
 * estava exigiria `tarefas → programas → tarefas`: um ciclo, cuja única saída
 * seria `forwardRef`, que é onde a ordem de inicialização vira defeito
 * intermitente.
 *
 * Com módulo próprio, o grafo volta a ser acíclico:
 *
 *     hoje → tarefas          hoje → financeiro          hoje → programas
 *                                                        programas → tarefas
 *                                                        tarefas   → financeiro
 *
 * E a casa fica mais honesta que antes: Hoje **não é uma tela de tarefas** —
 * ela é a composição de três leituras de três módulos, e nenhum deles a possui.
 * É a mesma razão pela qual a sessão ganhou rota própria (P-5): quando uma
 * coisa passa a depender de três, ela deixa de pertencer a uma.
 */
@Module({
  imports: [TarefasModule, FinanceiroModule, ProgramasModule],
  controllers: [HojeController],
})
export class HojeModule {}
