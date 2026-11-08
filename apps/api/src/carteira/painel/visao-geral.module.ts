import { Module } from '@nestjs/common'
import { provedorDeRelogio } from '../../comum/relogio'
import { ProspeccaoCarteiraModule } from '../prospeccao/prospeccao-carteira.module'
import { VisaoGeralController } from './visao-geral.controller'
import { VisaoGeralService } from './visao-geral.service'

/**
 * G8 3B — Visão geral da carteira (P1–P4, P6, P9–P11) e badges do menu (T4).
 * Importa a prospecção para REUSAR `LeadsService` (sinais) e
 * `RotinaInternaService` (aniversários) — agregar, não recalcular.
 * `BancoService` vem do `BancoModule` global.
 */
@Module({
  imports: [ProspeccaoCarteiraModule],
  controllers: [VisaoGeralController],
  providers: [VisaoGeralService, provedorDeRelogio],
})
export class CarteiraVisaoGeralModule {}
