import { Module } from '@nestjs/common'
import { provedorDeRelogio } from '../../comum/relogio'
import { ResumoSemanalController } from './resumo-semanal.controller'
import { ResumoSemanalService } from './resumo-semanal.service'

/** G8 3C — o resumo semanal da carteira (S1, `vResumo`). */
@Module({
  controllers: [ResumoSemanalController],
  providers: [ResumoSemanalService, provedorDeRelogio],
})
export class CarteiraResumoModule {}
