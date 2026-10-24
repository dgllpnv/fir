import { Module } from '@nestjs/common'
import { provedorDeRelogio } from '../comum/relogio'
import { TarefasController } from './tarefas.controller'
import { TarefasService } from './tarefas.service'

@Module({
  controllers: [TarefasController],
  providers: [TarefasService, provedorDeRelogio],
  exports: [TarefasService],
})
export class TarefasModule {}
