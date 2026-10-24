import { Module } from '@nestjs/common'
import { AutenticacaoController } from './autenticacao.controller.js'
import { AutenticacaoService } from './autenticacao.service.js'
import { SessaoGuard } from './sessao.guard.js'

@Module({
  controllers: [AutenticacaoController],
  providers: [AutenticacaoService, SessaoGuard],
  exports: [AutenticacaoService, SessaoGuard],
})
export class AutenticacaoModule {}
