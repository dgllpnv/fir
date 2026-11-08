import { Module } from '@nestjs/common'
import { provedorDeRelogio } from '../../comum/relogio'
import { CampanhasCarteiraController } from './campanhas-carteira.controller'
import { CampanhasCarteiraService } from './campanhas-carteira.service'

/**
 * **G8 1C — campanhas da carteira.** Mesmo arranjo de
 * `CarteiraFinanceiroModule`: o `CarteiraGuard` é global (registrado pelo
 * `CarteiraModule`) e lê `@SoUsuarioDeGestao()` do controlador; `BancoService`
 * vem do `BancoModule` global. O worker da sincronização NÃO mora aqui — é
 * processo próprio (`worker-campanhas.ts`).
 */
@Module({
  controllers: [CampanhasCarteiraController],
  providers: [CampanhasCarteiraService, provedorDeRelogio],
})
export class CampanhasCarteiraModule {}
