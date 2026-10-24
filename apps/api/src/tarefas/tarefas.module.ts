import { Module } from '@nestjs/common'
import { provedorDeRelogio } from '../comum/relogio'
import { ConclusaoService } from './conclusao.service'
import { TarefasController } from './tarefas.controller'
import { TarefasService } from './tarefas.service'

@Module({
  controllers: [TarefasController],
  providers: [TarefasService, ConclusaoService, provedorDeRelogio],
  exports: [TarefasService, ConclusaoService],
})
export class TarefasModule {}
