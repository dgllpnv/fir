import { Module } from '@nestjs/common'
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core'
import { AutenticacaoModule } from './autenticacao/autenticacao.module'
import { SessaoGuard } from './autenticacao/sessao.guard'
import { AutorizacaoGuard } from './autorizacao/autorizacao.guard'
import { BancoModule } from './banco/banco.module'
import { RedacaoInterceptor } from './comum/redacao.interceptor'
import { SaudeController } from './saude/saude.controller'

@Module({
  imports: [BancoModule, AutenticacaoModule],
  controllers: [SaudeController],
  providers: [
    // A ORDEM IMPORTA. O Nest executa os `APP_GUARD` na ordem de registro, e
    // `AutorizacaoGuard` lê `req.contexto`, que só existe depois de
    // `SessaoGuard` rodar. Invertidos, toda rota com `@Exige` daria 403.
    //
    // Globais de propósito, os dois: autenticação e autorização por rota
    // (`@UseGuards`) fazem do ESQUECIMENTO uma rota aberta. Com guard global,
    // esquecer significa rota protegida, e abrir exige `@Publico()` —
    // deliberado, e conferido por teste/rotas-protegidas.test.ts.
    { provide: APP_GUARD, useClass: SessaoGuard },
    { provide: APP_GUARD, useClass: AutorizacaoGuard },
    // Global de propósito: a redação não é opcional por rota.
    { provide: APP_INTERCEPTOR, useClass: RedacaoInterceptor },
  ],
})
export class AppModule {}
