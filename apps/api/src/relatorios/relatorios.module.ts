import { Module } from '@nestjs/common'
import { provedorDeRelogio } from '../comum/relogio'
import { FavoritosService } from './favoritos.service'
import { provedorDeLimites } from './limites'
import { MotorDeRelatorios } from './motor'
import { RelatoriosController } from './relatorios.controller'

/**
 * Indicadores & Insights (T8): o motor de relatórios, a exportação e os
 * favoritos. As consultas são funções sobre a conexão (as mesmas das telas de
 * origem), e não serviços de outros módulos: nenhum `imports` cruzado.
 */
@Module({
  controllers: [RelatoriosController],
  providers: [MotorDeRelatorios, FavoritosService, provedorDeLimites, provedorDeRelogio],
})
export class RelatoriosModule {}
