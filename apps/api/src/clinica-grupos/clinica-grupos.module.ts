import { Module } from '@nestjs/common'
import { ClinicaGruposController } from './clinica-grupos.controller'
import { ClinicaGruposService } from './clinica-grupos.service'

@Module({
  controllers: [ClinicaGruposController],
  providers: [ClinicaGruposService],
})
export class ClinicaGruposModule {}
