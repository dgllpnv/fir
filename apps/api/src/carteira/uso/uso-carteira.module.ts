import { Module } from '@nestjs/common'
import { provedorDeRelogio } from '../../comum/relogio'
import { UsoCarteiraController } from './uso-carteira.controller'
import { UsoCarteiraService } from './uso-carteira.service'

/** G8 1D — o uso diário da FIR Clinic lido pela carteira (F1, V12). */
@Module({
  controllers: [UsoCarteiraController],
  providers: [UsoCarteiraService, provedorDeRelogio],
})
export class CarteiraUsoModule {}
