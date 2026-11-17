import { Module } from '@nestjs/common'
import { AutenticacaoModule } from '../autenticacao/autenticacao.module'
import { provedorDeRelogio } from '../comum/relogio'
import { AcessoPorEmailController } from './acesso-por-email.controller'
import { AcessoPorEmailService } from './acesso-por-email.service'
import { ENVIO, envioDoAmbiente } from './correio'
import { provedoresDeLimiteDoAcesso } from './limites'

/**
 * O acesso por e-mail (ADR 2026-11-16). Importa `AutenticacaoModule` pelo
 * limite por origem do ENTRAR (que `consultar` e `usar` compartilham) e pela
 * `ChaveDeEmail`; exporta o serviço para Usuários e acessos.
 *
 * `ENVIO` vem do ambiente, e é o ponto que o teste substitui pelo correio que
 * captura — ligado ou desligado.
 */
@Module({
  imports: [AutenticacaoModule],
  controllers: [AcessoPorEmailController],
  providers: [
    AcessoPorEmailService,
    provedorDeRelogio,
    { provide: ENVIO, useFactory: () => envioDoAmbiente() },
    ...provedoresDeLimiteDoAcesso,
  ],
  exports: [AcessoPorEmailService],
})
export class AcessoPorEmailModule {}
