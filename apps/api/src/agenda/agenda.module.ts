import { Module } from '@nestjs/common'
import { AgendaExternaController } from './agenda-externa.controller'
import { AgendaExternaService, PEDIDO_DE_SINCRONIZACAO, PedidoPelaFila } from './agenda-externa.service'

@Module({
  controllers: [AgendaExternaController],
  providers: [AgendaExternaService, { provide: PEDIDO_DE_SINCRONIZACAO, useClass: PedidoPelaFila }],
})
export class AgendaModule {}
