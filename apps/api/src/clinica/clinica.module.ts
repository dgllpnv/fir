import { Module } from '@nestjs/common'
import { provedorDeRelogio } from '../comum/relogio'
import { ClinicaController } from './clinica.controller'
import { UnidadesController } from './unidades.controller'
import { UnidadesService } from './unidades.service'

@Module({
  controllers: [ClinicaController, UnidadesController],
  providers: [provedorDeRelogio, UnidadesService],
})
export class ClinicaModule {}
