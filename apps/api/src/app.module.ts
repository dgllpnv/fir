import { Module } from '@nestjs/common'
import { APP_INTERCEPTOR } from '@nestjs/core'
import { AutenticacaoModule } from './autenticacao/autenticacao.module'
import { BancoModule } from './banco/banco.module'
import { RedacaoInterceptor } from './comum/redacao.interceptor'
import { SaudeController } from './saude/saude.controller'

@Module({
  imports: [BancoModule, AutenticacaoModule],
  controllers: [SaudeController],
  // Global de propósito: a redação não é opcional por rota.
  providers: [{ provide: APP_INTERCEPTOR, useClass: RedacaoInterceptor }],
})
export class AppModule {}
