import { Module } from '@nestjs/common'
import { provedorDeRelogio } from '../../comum/relogio'
import { CofreDoSegundoFator } from './cifra'
import { segundoFatorLigado } from './ligado'
import { ResetDoSegundoFatorDaCarteiraController } from './reset-pelo-operador.controller'
import { SegundoFatorDaCarteiraController, SoComSegundoFatorLigado } from './segundo-fator.controller'
import { SegundoFatorDaCarteiraGuard } from './segundo-fator.guard'
import { SegundoFatorDaCarteiraService } from './segundo-fator.service'

/**
 * O segundo fator (TOTP) do `Usuário de Gestão` — gate appsec A-12, ADR 0022;
 * desligado por padrão desde a ADR 0023 (`SEGUNDO_FATOR_CARTEIRA_LIGADO`).
 *
 * `CofreDoSegundoFator` é construído na SUBIDA (`useFactory`): sem
 * `FIR_CHAVE_SEGUNDO_FATOR_CARTEIRA` em produção, a API não sobe — mesmo com
 * o segundo fator desligado, porque os segredos já cifrados dependem dela.
 *
 * `SegundoFatorDaCarteiraGuard` é exportado porque é registrado como
 * `APP_GUARD` em `app.module.ts`, logo depois do `CarteiraGuard`.
 */
@Module({
  controllers: [SegundoFatorDaCarteiraController, ResetDoSegundoFatorDaCarteiraController],
  providers: [
    SegundoFatorDaCarteiraService,
    SegundoFatorDaCarteiraGuard,
    SoComSegundoFatorLigado,
    provedorDeRelogio,
    { provide: CofreDoSegundoFator, useFactory: () => new CofreDoSegundoFator() },
  ],
  exports: [SegundoFatorDaCarteiraService, SegundoFatorDaCarteiraGuard],
})
export class SegundoFatorDaCarteiraModule {
  constructor() {
    // Valor mal escrito na chave derruba a subida, não desliga em silêncio.
    segundoFatorLigado()
  }
}
