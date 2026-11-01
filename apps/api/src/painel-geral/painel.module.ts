import { Module } from '@nestjs/common'
import { provedorDeRelogio } from '../comum/relogio'
import { PainelController } from './painel.controller'
import { PainelService } from './painel.service'

/**
 * **Gestão › Painel geral** (épico 8) — a tela da CLÍNICA.
 *
 * A pasta chama-se `painel-geral` porque `src/painel` já é o painel do
 * SUPERADMIN, e os dois não têm nada em comum: espaços de identidade
 * disjuntos, cookies diferentes, prefixos de rota diferentes. O nome longo é
 * o preço de o outro ter nascido com o nome que `CONTEXT.md` proíbe.
 */
@Module({
  controllers: [PainelController],
  providers: [PainelService, provedorDeRelogio],
})
export class PainelGeralModule {}
