import { Module } from '@nestjs/common'
import { provedorDeRelogio } from '../comum/relogio'
import { FinanceiroModule } from '../financeiro/financeiro.module'
import { ConclusaoService } from './conclusao.service'
import { ConsultaDeTarefasService } from './consulta.service'
import { EdicaoDeTarefasService } from './edicao.service'
import { TarefasController } from './tarefas.controller'
import { TarefasService } from './tarefas.service'

/**
 * `FinanceiroModule` entra porque a conclusão de tarefa mexe em recebimento. A
 * dependência é de mão única: o financeiro não importa tarefas.
 *
 * **`HojeController` MUDOU DE CASA no épico 5**, para `HojeModule`. Ele passou
 * a compor TRÊS leituras — tarefas, financeiro e programas — e
 * `ProgramasModule` importa este módulo. Deixá-lo aqui exigiria
 * `tarefas → programas → tarefas`, e a única saída para o ciclo seria
 * `forwardRef`, que é onde a ordem de inicialização vira defeito intermitente.
 */
@Module({
  imports: [FinanceiroModule],
  controllers: [TarefasController],
  providers: [
    TarefasService,
    ConclusaoService,
    EdicaoDeTarefasService,
    ConsultaDeTarefasService,
    provedorDeRelogio,
  ],
  exports: [TarefasService, ConclusaoService, EdicaoDeTarefasService, ConsultaDeTarefasService],
})
export class TarefasModule {}
