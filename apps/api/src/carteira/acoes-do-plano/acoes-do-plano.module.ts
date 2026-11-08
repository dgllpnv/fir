import { Module } from '@nestjs/common'
import { provedorDeRelogio } from '../../comum/relogio'
import { AcoesDoPlanoController } from './acoes-do-plano.controller'
import { AcoesDoPlanoService } from './acoes-do-plano.service'

/**
 * G8 2B — `Ação do plano` (V8). O `CarteiraGuard` global protege as rotas
 * pela metadata de `@SoUsuarioDeGestao()`; `BancoService` vem do
 * `BancoModule` global.
 */
@Module({
  controllers: [AcoesDoPlanoController],
  providers: [AcoesDoPlanoService, provedorDeRelogio],
})
export class CarteiraAcoesDoPlanoModule {}
