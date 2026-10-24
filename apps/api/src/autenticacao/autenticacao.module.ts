import { Module } from '@nestjs/common'
import { AutenticacaoController } from './autenticacao.controller'
import { AutenticacaoService } from './autenticacao.service'
import { SessaoGuard } from './sessao.guard'

@Module({
  controllers: [AutenticacaoController],
  providers: [AutenticacaoService, SessaoGuard],
  exports: [AutenticacaoService, SessaoGuard],
})
export class AutenticacaoModule {}
