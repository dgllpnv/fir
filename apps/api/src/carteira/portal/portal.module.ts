import { Module } from '@nestjs/common'
import { AuditoriaModule } from '../../auditoria/auditoria.module'
import { LimitePorOrigem } from '../../autenticacao/limite-por-origem'
import { provedorDeRelogio } from '../../comum/relogio'
import { LeituraDoPortalService } from './leitura-do-portal.service'
import { JANELA_PORTAL_POR_ORIGEM_MS, LIMITE_DO_PORTAL, MAX_PORTAL_POR_ORIGEM } from './limite-do-portal'
import { PortalAdminClienteController, PortalAdminGrupoController } from './portal-admin.controller'
import { PortalAdminService } from './portal-admin.service'
import { PortalController } from './portal.controller'
import { PortalGuard } from './portal.guard'
import { PortalService } from './portal.service'

/**
 * O PORTAL DO GRUPO (G6). Módulo próprio, controladores próprios, cookie
 * próprio — nada dele atravessa para o produto, o painel ou a carteira
 * (ADRs 0017, 0018), e nada deles atravessa para cá.
 *
 * `PortalGuard` é exportado porque é registrado como `APP_GUARD` em
 * `app.module.ts` — global, mesma razão dos outros três: uma rota sem guard
 * não entrega um grupo, entrega todos. A fiação (`CarteiraPortalModule` em
 * `imports`, `{ provide: APP_GUARD, useClass: PortalGuard }` logo depois de
 * `CarteiraGuard`) já está em `app.module.ts` — confirmado por auditoria de
 * segurança em 2026-11-05.
 */
@Module({
  imports: [AuditoriaModule],
  controllers: [PortalController, PortalAdminClienteController, PortalAdminGrupoController],
  providers: [
    PortalService,
    PortalAdminService,
    LeituraDoPortalService,
    PortalGuard,
    provedorDeRelogio,
    {
      provide: LIMITE_DO_PORTAL,
      useFactory: () => new LimitePorOrigem(MAX_PORTAL_POR_ORIGEM, JANELA_PORTAL_POR_ORIGEM_MS),
    },
  ],
  exports: [PortalService, PortalGuard, LIMITE_DO_PORTAL],
})
export class CarteiraPortalModule {}
