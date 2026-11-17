import { Module } from '@nestjs/common'
import { CampanhasService } from '../campanhas/campanhas.service'
import { provedorDeRelogio } from '../comum/relogio'
import { VisaoDoMesService } from '../financeiro/visao-do-mes.service'
import { MetasService } from '../pessoas/metas.service'
import { FontesDosKpis } from './fontes'
import { IndicadoresController } from './indicadores.controller'
import { IndicadoresService } from './indicadores.service'

/**
 * Indicadores & Insights (T2): a calculadora, as fontes, as rotas.
 *
 * As fontes de outros módulos (`VisaoDoMesService`, `MetasService`,
 * `CampanhasService`) entram como PROVEDORES, e não por `exports` dos módulos
 * deles: os três são sem estado (banco + relógio), e o módulo de pessoas é de
 * outra frente de trabalho, que não se edita daqui.
 */
@Module({
  controllers: [IndicadoresController],
  providers: [IndicadoresService, FontesDosKpis, VisaoDoMesService, MetasService, CampanhasService, provedorDeRelogio],
})
export class IndicadoresModule {}
