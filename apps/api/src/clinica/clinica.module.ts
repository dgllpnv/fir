import { Module } from '@nestjs/common'
import { ClinicaController } from './clinica.controller'

@Module({ controllers: [ClinicaController] })
export class ClinicaModule {}
