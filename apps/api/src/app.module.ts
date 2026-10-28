import { Module } from '@nestjs/common'
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core'
import { AcessoInterceptor } from './auditoria/acesso.interceptor'
import { AuditoriaModule } from './auditoria/auditoria.module'
import { AutenticacaoModule } from './autenticacao/autenticacao.module'
import { SenhaProvisoriaGuard } from './autenticacao/senha-provisoria.guard'
import { SessaoGuard } from './autenticacao/sessao.guard'
import { AutorizacaoGuard } from './autorizacao/autorizacao.guard'
import { BancoModule } from './banco/banco.module'
import { ClinicaModule } from './clinica/clinica.module'
import { FinanceiroModule } from './financeiro/financeiro.module'
import { HojeModule } from './hoje/hoje.module'
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
    // Depois de `TarefasModule`, `FinanceiroModule` e `ProgramasModule`: a
    // tela Hoje compõe as três leituras, e não é dona de nenhuma.
    HojeModule,
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
    // ENTRE os dois, e não depois: quem está preso pela senha provisória tem
    // de receber 409 em TODA rota de negócio, inclusive nas que o perfil dele
    // não alcança. Depois de `AutorizacaoGuard`, a resposta seria 403 numa
    // rota sem permissão, e a tela — que redireciona pelo `codigo` — não
    // redirecionaria. "Termine isto primeiro" é precondição da sessão, não
    // resposta à pergunta "você pode?".
    { provide: APP_GUARD, useClass: SenhaProvisoriaGuard },
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
