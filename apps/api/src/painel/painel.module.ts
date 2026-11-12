import { Module } from '@nestjs/common'
import { LimitePorOrigem } from '../autenticacao/limite-por-origem'
import { CarteiraModule } from '../carteira/carteira.module'
import { CarteiraService } from '../carteira/carteira.service'
import { ABRIDOR_DA_CONTA_DE_GESTAO } from './abridor-da-conta-de-gestao'
import { provedorDeRelogio } from '../comum/relogio'
import {
  JANELA_PAINEL_POR_ORIGEM_MS,
  LIMITE_DO_PAINEL,
  MAX_PAINEL_POR_ORIGEM,
} from './limite-do-painel'
import { PainelAtividadesController } from './painel-atividades.controller'
import { PainelAtividadesService } from './painel-atividades.service'
import { PainelCarteiraController } from './painel-carteira.controller'
import { PainelCarteiraService } from './painel-carteira.service'
import { PainelClinicasController } from './painel-clinicas.controller'
import { PainelClinicasService } from './painel-clinicas.service'
import { PainelPessoasService } from './painel-pessoas.service'
import { PainelController } from './painel.controller'
import { PainelGuard } from './painel.guard'
import { PainelService } from './painel.service'
import { SessaoDeSuporteService } from './sessao-de-suporte.service'

/**
 * O painel do superadmin. Módulo próprio, controlador próprio, cookie
 * próprio — nada dele atravessa para o produto, e nada do produto atravessa
 * para cá (D-5 restrição 1).
 *
 * `PainelGuard` é exportado porque ele é registrado como `APP_GUARD` em
 * `app.module.ts`: global, pela mesma razão dos outros três — uma rota de
 * painel sem guard não entrega UMA clínica, entrega todas.
 */
@Module({
  // A entrada única (ADR 0024): o login do painel abre a sessão da conta de
  // gestão do operador pelo `CarteiraService` — a sessão de carteira nasce
  // só pela conexão `fir_carteira`.
  imports: [CarteiraModule],
  controllers: [
    PainelController,
    PainelClinicasController,
    PainelCarteiraController,
    PainelAtividadesController,
  ],
  providers: [
    PainelService,
    PainelClinicasService,
    PainelCarteiraService,
    PainelPessoasService,
    PainelAtividadesService,
    SessaoDeSuporteService,
    PainelGuard,
    { provide: ABRIDOR_DA_CONTA_DE_GESTAO, useExisting: CarteiraService },
    provedorDeRelogio,
    {
      provide: LIMITE_DO_PAINEL,
      useFactory: () => new LimitePorOrigem(MAX_PAINEL_POR_ORIGEM, JANELA_PAINEL_POR_ORIGEM_MS),
    },
  ],
  exports: [PainelService, PainelGuard, LIMITE_DO_PAINEL],
})
export class PainelModule {}
