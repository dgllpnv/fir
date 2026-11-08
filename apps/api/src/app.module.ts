import { Module } from '@nestjs/common'
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core'
import { AcessoInterceptor } from './auditoria/acesso.interceptor'
import { AuditoriaModule } from './auditoria/auditoria.module'
import { AutenticacaoModule } from './autenticacao/autenticacao.module'
import { SenhaProvisoriaGuard } from './autenticacao/senha-provisoria.guard'
import { SessaoGuard } from './autenticacao/sessao.guard'
import { AutorizacaoGuard } from './autorizacao/autorizacao.guard'
import { BancoModule } from './banco/banco.module'
import { AgendaModule } from './agenda/agenda.module'
import { ClinicaModule } from './clinica/clinica.module'
import { EstoqueModule } from './estoque/estoque.module'
import { FinanceiroModule } from './financeiro/financeiro.module'
import { HojeModule } from './hoje/hoje.module'
import { JornadaModule } from './jornada/jornada.module'
import { RedacaoInterceptor } from './comum/redacao.interceptor'
import { FiltroDeSessaoDeSuporte } from './comum/sessao-de-suporte.filtro'
import { PacientesModule } from './pacientes/pacientes.module'
import { PainelGuard } from './painel/painel.guard'
import { PainelModule } from './painel/painel.module'
import { CarteiraGuard } from './carteira/carteira.guard'
import { CarteiraModule } from './carteira/carteira.module'
import { CarteiraFinanceiroModule } from './carteira/financeiro/carteira-financeiro.module'
import { PortalGuard } from './carteira/portal/portal.guard'
import { CarteiraPortalModule } from './carteira/portal/portal.module'
import { CampanhasModule } from './campanhas/campanhas.module'
import { PainelGeralModule } from './painel-geral/painel.module'
import { PessoasModule } from './pessoas/pessoas.module'
import { ProgramasModule } from './programas/programas.module'
import { SaudeController } from './saude/saude.controller'
import { TarefasModule } from './tarefas/tarefas.module'

@Module({
  imports: [
    BancoModule,
    AutenticacaoModule,
    AuditoriaModule,
    PacientesModule,
    PessoasModule,
    PainelModule,
    CarteiraModule,
    CarteiraFinanceiroModule,
    CarteiraPortalModule,
    // O épico 8: as campanhas e o Painel geral da CLÍNICA.
    // `PainelGeralModule` não tem relação com `PainelModule`, que é o do
    // SUPERADMIN — ver a nota em `painel-geral/painel.module.ts`.
    CampanhasModule,
    PainelGeralModule,
    TarefasModule,
    JornadaModule,
    ClinicaModule,
    // A agenda do sistema da clínica (ADR 0019).
    AgendaModule,
    FinanceiroModule,
    // ANTES de `ProgramasModule`, que o importa pelo seam `BaixaDeInsumos` —
    // ligado no épico 6 e provido por `BaixaRelacional`.
    EstoqueModule,
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
    // LOGO DEPOIS de `SessaoGuard`, e antes dos dois de clínica: as rotas do
    // painel não têm `req.contexto`, e os guards de provisória e de
    // permissão nada têm a dizer sobre elas. Global pela mesma razão dos
    // outros — uma rota de painel sem guard não entrega UMA clínica,
    // entrega todas.
    { provide: APP_GUARD, useClass: PainelGuard },
    // MESMO NÍVEL do `PainelGuard`, logo depois: rota de carteira também não
    // tem `req.contexto`, e os guards de clínica nada têm a dizer sobre ela.
    // Global pela mesma razão — uma rota de carteira sem guard não entrega
    // um grupo, entrega todos.
    { provide: APP_GUARD, useClass: CarteiraGuard },
    // MESMO NÍVEL, quarto ator: rota do Portal do Grupo também não tem
    // `req.contexto` (G6, ADR 0018) — uma rota do portal sem guard não
    // entrega um grupo, entrega todos.
    { provide: APP_GUARD, useClass: PortalGuard },
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
    /**
     * A tradução de `SessaoDeSuporteNaoAssina` para 403, num lugar só (D-13).
     *
     * `@Catch` com o tipo exato: nenhuma outra exceção passa por ele, e o
     * tratamento de todo o resto continua sendo o do Nest.
     */
    { provide: APP_FILTER, useClass: FiltroDeSessaoDeSuporte },
  ],
})
export class AppModule {}
