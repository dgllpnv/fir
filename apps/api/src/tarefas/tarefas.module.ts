import { Module } from '@nestjs/common'
import { provedorDeRelogio } from '../comum/relogio'
import { HojeController } from '../hoje/hoje.controller'
import { ConclusaoService } from './conclusao.service'
import { ConsultaDeTarefasService } from './consulta.service'
import { EdicaoDeTarefasService } from './edicao.service'
import { TarefasController } from './tarefas.controller'
import { TarefasService } from './tarefas.service'

@Module({
  controllers: [TarefasController, HojeController],
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
