import { Module } from '@nestjs/common'
import { provedorDeRelogio } from '../comum/relogio'
import { CampanhasController } from './campanhas.controller'
import { CampanhasService } from './campanhas.service'

/**
 * **Comercial › Campanhas** (épico 8).
 *
 * Módulo próprio e não um apêndice de `PacientesModule`: a campanha é um
 * conceito com ciclo de vida, meta e período, e a importação dela só CRIA
 * paciente de passagem — o dono do cadastro continua sendo o outro módulo.
 */
@Module({
  controllers: [CampanhasController],
  providers: [CampanhasService, provedorDeRelogio],
})
export class CampanhasModule {}
