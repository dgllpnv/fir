import { Module } from '@nestjs/common'
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core'
import { AcessoInterceptor } from './auditoria/acesso.interceptor'
import { AuditoriaModule } from './auditoria/auditoria.module'
import { AutenticacaoModule } from './autenticacao/autenticacao.module'
import { SessaoGuard } from './autenticacao/sessao.guard'
import { AutorizacaoGuard } from './autorizacao/autorizacao.guard'
import { BancoModule } from './banco/banco.module'
import { ClinicaModule } from './clinica/clinica.module'
import { FinanceiroModule } from './financeiro/financeiro.module'
import { JornadaModule } from './jornada/jornada.module'
import { RedacaoInterceptor } from './comum/redacao.interceptor'
import { PacientesModule } from './pacientes/pacientes.module'
import { ProgramasModule } from './programas/programas.module'
import { SaudeController } from './saude/saude.controller'
import { TarefasModule } from './tarefas/tarefas.module'

@Module({
  imports: [
    BancoModule,
    AutenticacaoModule,
    AuditoriaModule,
    PacientesModule,
    TarefasModule,
    JornadaModule,
    ClinicaModule,
    FinanceiroModule,
    ProgramasModule,
  ],
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
    //
    // E A ORDEM ENTRE OS DOIS INTERCEPTORS TAMBÉM IMPORTA. No Nest, o
    // registrado PRIMEIRO envolve os seguintes — logo a transformação de
    // resposta dele roda POR ÚLTIMO. Com a redação primeiro, o
    // `AcessoInterceptor` fica por dentro e observa o que o handler
    // produziu, não o que sobrou da redação. Hoje a linha de trilha não
    // copia o corpo (minimização, ver `auditoria.service.ts`), então a
    // diferença é invisível; ela deixa de ser no dia em que alguém quiser
    // registrar quais campos foram entregues, e inverter isto então seria
    // uma mudança silenciosa de significado.
    { provide: APP_INTERCEPTOR, useClass: RedacaoInterceptor },
    { provide: APP_INTERCEPTOR, useClass: AcessoInterceptor },
  ],
})
export class AppModule {}
