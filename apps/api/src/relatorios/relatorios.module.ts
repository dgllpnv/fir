import { Module } from '@nestjs/common'
import { CampanhasModule } from '../campanhas/campanhas.module'
import { provedorDeRelogio } from '../comum/relogio'
import { CampanhaDaListaService } from './campanha.service'
import { FavoritosService } from './favoritos.service'
import { provedorDeLimites } from './limites'
import { MotorDeRelatorios } from './motor'
import { RelatoriosController } from './relatorios.controller'

/**
 * Indicadores & Insights (T8): o motor de relatórios, a exportação e os
 * favoritos. As consultas são funções sobre a conexão (as mesmas das telas de
 * origem), e não serviços de outros módulos. A exceção é o T9: "Criar campanha
 * com esta lista" CRIA campanha, e quem cria campanha é `CampanhasService`
 * (`criarNaTransacao`, `adicionarPacientesNaTransacao`) — nunca um segundo
 * `INSERT INTO campanhas` aqui.
 */
@Module({
  imports: [CampanhasModule],
  controllers: [RelatoriosController],
  providers: [MotorDeRelatorios, FavoritosService, CampanhaDaListaService, provedorDeLimites, provedorDeRelogio],
})
export class RelatoriosModule {}
