import { Module } from '@nestjs/common'
import { provedorDeRelogio } from '../comum/relogio'
import { FinanceiroModule } from '../financeiro/financeiro.module'
import { HojeController } from '../hoje/hoje.controller'
import { ConclusaoService } from './conclusao.service'
import { ConsultaDeTarefasService } from './consulta.service'
import { EdicaoDeTarefasService } from './edicao.service'
import { TarefasController } from './tarefas.controller'
import { TarefasService } from './tarefas.service'

/**
 * `FinanceiroModule` entra porque `HojeController` mora aqui e a tela Hoje
 * ganhou o bloco financeiro (épico 4). A dependência é de mão única: o
 * financeiro não importa tarefas.
 */
@Module({
  imports: [FinanceiroModule],
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
