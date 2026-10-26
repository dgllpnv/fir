import { Module } from '@nestjs/common'
import { provedorDeRelogio } from '../comum/relogio'
import { TarefasModule } from '../tarefas/tarefas.module'
import { FechamentoService } from './fechamento.service'
import { FunilController } from './funil.controller'
import { FunilService } from './funil.service'
import { JornadaController } from './jornada.controller'
import { JornadaService } from './jornada.service'
import { MotivosController, MotivosService } from './motivos.controller'
import { ProgramasModule } from '../programas/programas.module'

/**
 * `TarefasModule` é importado porque `reabrir` DELEGA para
 * `ConclusaoService.reabrir` — uma implementação, duas portas. Reescrever o
 * estorno do recebimento aqui seria a segunda cópia da regra que mexe em
 * dinheiro, e a segunda cópia é a que esquece o estorno.
 *
 * `ProgramasModule` é importado porque `fechar` MONTA O PROGRAMA — e esta é a
 * linha que o épico 3 prometeu e que a Task 8 do épico 5 cumpriu. Ele exporta
 * `MontadorDePrograma` ligado ao `MontadorRelacional`; o `MontadorIndisponivel`
 * que devolvia 501 foi **apagado**, não deixado para trás: provider
 * alternativo que ninguém usa é o lugar onde a próxima pessoa pluga sem
 * perceber.
 *
 * A dependência é de mão única — `jornada → programas` é a que o DADO já tem
 * (`tarefas.programa_orcado` guarda `procedimentoId` desde o épico 3). O
 * inverso seria ciclo de módulo, e a saída para o ciclo seria um `forwardRef`,
 * que é onde a ordem de inicialização vira defeito intermitente.
 */
@Module({
  imports: [TarefasModule, ProgramasModule],
  controllers: [JornadaController, FunilController, MotivosController],
  providers: [JornadaService, FechamentoService, FunilService, MotivosService, provedorDeRelogio],
  exports: [JornadaService],
})
export class JornadaModule {}
