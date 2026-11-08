import { Module } from '@nestjs/common'
import { provedorDeRelogio } from '../../comum/relogio'
import { PODE_VER_VALORES_NA_MENSAGEM, veValoresPeloPerfil } from './mensagens-comum'
import { MensagensCarteiraController } from './mensagens.controller'
import { MensagensCarteiraService } from './mensagens.service'

/**
 * G8 3A — mensagens prontas e WhatsApp da carteira. O `CarteiraGuard` global
 * protege as rotas por `@SoUsuarioDeGestao()`; `BancoService` vem do
 * `BancoModule` global. `MensagensCarteiraService` é exportado para as telas
 * de outros tickets que montarem mensagem pelo servidor.
 */
@Module({
  controllers: [MensagensCarteiraController],
  providers: [
    MensagensCarteiraService,
    provedorDeRelogio,
    { provide: PODE_VER_VALORES_NA_MENSAGEM, useValue: veValoresPeloPerfil },
  ],
  exports: [MensagensCarteiraService],
})
export class CarteiraMensagensModule {}
