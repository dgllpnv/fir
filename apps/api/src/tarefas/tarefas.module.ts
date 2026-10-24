import { Module } from '@nestjs/common'
import { provedorDeRelogio } from '../comum/relogio'
import { ConclusaoService } from './conclusao.service'
import { EdicaoDeTarefasService } from './edicao.service'
import { TarefasController } from './tarefas.controller'
import { TarefasService } from './tarefas.service'

@Module({
  controllers: [TarefasController],
  providers: [TarefasService, ConclusaoService, EdicaoDeTarefasService, provedorDeRelogio],
  exports: [TarefasService, ConclusaoService, EdicaoDeTarefasService],
})
export class TarefasModule {}
