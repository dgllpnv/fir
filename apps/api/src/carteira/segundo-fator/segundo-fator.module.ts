import { Module } from '@nestjs/common'
import { provedorDeRelogio } from '../../comum/relogio'
import { CofreDoSegundoFator } from './cifra'
import { ResetDoSegundoFatorDaCarteiraController } from './reset-pelo-operador.controller'
import { SegundoFatorDaCarteiraController } from './segundo-fator.controller'
import { SegundoFatorDaCarteiraGuard } from './segundo-fator.guard'
import { SegundoFatorDaCarteiraService } from './segundo-fator.service'

/**
 * O segundo fator (TOTP) do `Usuário de Gestão` — gate appsec A-12, ADR 0022.
 *
 * `CofreDoSegundoFator` é construído na SUBIDA (`useFactory`): sem
 * `FIR_CHAVE_SEGUNDO_FATOR_CARTEIRA` em produção, a API não sobe.
 *
 * `SegundoFatorDaCarteiraGuard` é exportado porque é registrado como
 * `APP_GUARD` em `app.module.ts`, logo depois do `CarteiraGuard`.
 */
@Module({
  controllers: [SegundoFatorDaCarteiraController, ResetDoSegundoFatorDaCarteiraController],
  providers: [
    SegundoFatorDaCarteiraService,
    SegundoFatorDaCarteiraGuard,
    provedorDeRelogio,
    { provide: CofreDoSegundoFator, useFactory: () => new CofreDoSegundoFator() },
  ],
  exports: [SegundoFatorDaCarteiraService, SegundoFatorDaCarteiraGuard],
})
export class SegundoFatorDaCarteiraModule {}
