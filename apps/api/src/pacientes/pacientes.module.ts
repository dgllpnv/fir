import { Module } from '@nestjs/common'
import { provedorDeRelogio } from '../comum/relogio'
import { PacientesController } from './pacientes.controller'
import { PacientesService } from './pacientes.service'

/**
 * O relógio é provido AQUI, e não no `AppModule`, porque este é o primeiro
 * módulo que precisa dele. Quando o épico 2 trouxer tarefas e Hoje, o
 * provedor sobe para um módulo compartilhado — hoje subir já seria
 * antecipação sem uso.
 */
@Module({
  controllers: [PacientesController],
  providers: [PacientesService, provedorDeRelogio],
  exports: [PacientesService],
})
export class PacientesModule {}
