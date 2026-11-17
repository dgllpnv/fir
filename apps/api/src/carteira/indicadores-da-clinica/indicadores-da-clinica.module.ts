import { Module } from '@nestjs/common'
import { IndicadoresDaClinicaController } from './indicadores-da-clinica.controller'
import { IndicadoresDaClinicaService } from './indicadores-da-clinica.service'

/** T10 — os KPIs da clínica lidos pela carteira (`kpis_na_carteira`). */
@Module({
  controllers: [IndicadoresDaClinicaController],
  providers: [IndicadoresDaClinicaService],
})
export class CarteiraIndicadoresDaClinicaModule {}
