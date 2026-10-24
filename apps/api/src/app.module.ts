import { Module } from '@nestjs/common'
import { APP_INTERCEPTOR } from '@nestjs/core'
import { AutenticacaoModule } from './autenticacao/autenticacao.module.js'
import { BancoModule } from './banco/banco.module.js'
import { RedacaoInterceptor } from './comum/redacao.interceptor.js'
import { SaudeController } from './saude/saude.controller.js'

@Module({
  imports: [BancoModule, AutenticacaoModule],
  controllers: [SaudeController],
  // Global de propósito: a redação não é opcional por rota.
  providers: [{ provide: APP_INTERCEPTOR, useClass: RedacaoInterceptor }],
})
export class AppModule {}
