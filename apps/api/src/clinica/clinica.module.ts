import { Module } from '@nestjs/common'
import { provedorDeRelogio } from '../comum/relogio'
import { ClinicaController } from './clinica.controller'

@Module({ controllers: [ClinicaController], providers: [provedorDeRelogio] })
export class ClinicaModule {}
