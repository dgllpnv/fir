import { Module } from '@nestjs/common'
import { AutenticacaoController } from './autenticacao.controller'
import { AutenticacaoService } from './autenticacao.service'
import {
  JANELA_LOGIN_POR_ORIGEM_MS,
  LimitePorOrigem,
  MAX_LOGIN_POR_ORIGEM,
} from './limite-por-origem'
import { SessaoGuard } from './sessao.guard'

@Module({
  controllers: [AutenticacaoController],
  providers: [
    AutenticacaoService,
    SessaoGuard,
    // `useFactory` e não a classe nua: o limite e a janela são parâmetros do
    // construtor, e provedor é o que permite ao teste substituir a instância
    // por uma de janela curta para provar o 429 sem esperar cinco minutos.
    {
      provide: LimitePorOrigem,
      useFactory: () => new LimitePorOrigem(MAX_LOGIN_POR_ORIGEM, JANELA_LOGIN_POR_ORIGEM_MS),
    },
  ],
  exports: [AutenticacaoService, SessaoGuard, LimitePorOrigem],
})
export class AutenticacaoModule {}
