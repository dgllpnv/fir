import { Module } from '@nestjs/common'
import { LimitePorOrigem } from '../autenticacao/limite-por-origem'
import { provedorDeRelogio } from '../comum/relogio'
import { CarteiraController } from './carteira.controller'
import { CarteiraGuard } from './carteira.guard'
import { CarteiraService } from './carteira.service'
import { LinksDeAcessoClienteController } from './links-de-acesso-cliente.controller'
import { LinksDeAcessoClienteService } from './links-de-acesso-cliente.service'
import { ProspeccaoCarteiraModule } from './prospeccao/prospeccao-carteira.module'
import {
  JANELA_CARTEIRA_POR_ORIGEM_MS,
  LIMITE_DA_CARTEIRA,
  MAX_CARTEIRA_POR_ORIGEM,
} from './limite-da-carteira'

/**
 * A carteira comercial da Firmare. Módulo próprio, controlador próprio,
 * cookie próprio — nada dela atravessa para o produto ou para o painel do
 * superadmin, e nada deles atravessa para cá (ADRs 0011, 0012).
 *
 * `CarteiraGuard` é exportado porque é registrado como `APP_GUARD` em
 * `app.module.ts` — global, mesma razão dos outros: uma rota sem guard não
 * entrega um grupo, entrega todos.
 */
@Module({
  imports: [ProspeccaoCarteiraModule],
  controllers: [CarteiraController, LinksDeAcessoClienteController],
  providers: [
    CarteiraService,
    LinksDeAcessoClienteService,
    CarteiraGuard,
    provedorDeRelogio,
    {
      provide: LIMITE_DA_CARTEIRA,
      useFactory: () => new LimitePorOrigem(MAX_CARTEIRA_POR_ORIGEM, JANELA_CARTEIRA_POR_ORIGEM_MS),
    },
  ],
  exports: [CarteiraService, CarteiraGuard, LIMITE_DA_CARTEIRA],
})
export class CarteiraModule {}
