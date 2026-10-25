import { Module } from '@nestjs/common'
import { provedorDeRelogio } from '../comum/relogio'
import { TarefasModule } from '../tarefas/tarefas.module'
import { JornadaController } from './jornada.controller'
import { JornadaService } from './jornada.service'
import { MotivosController, MotivosService } from './motivos.controller'

/**
 * `TarefasModule` é importado porque `reabrir` DELEGA para
 * `ConclusaoService.reabrir` — uma implementação, duas portas. Reescrever o
 * estorno do recebimento aqui seria a segunda cópia da regra que mexe em
 * dinheiro, e a segunda cópia é a que esquece o estorno.
 */
@Module({
  imports: [TarefasModule],
  controllers: [JornadaController, MotivosController],
  providers: [JornadaService, MotivosService, provedorDeRelogio],
  exports: [JornadaService],
})
export class JornadaModule {}
