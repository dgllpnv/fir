import {
  type CaixaFechado,
  type ConferenciaDeCaixa,
  ConsultaDeCaixa,
  FecharCaixa,
  type ListaDeFechamentos,
} from '@fir/contracts'
import { diaCivil } from '@fir/domain'
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Query,
  Req,
} from '@nestjs/common'
import { Exige } from '../autorizacao/autorizacao.guard'
import type { RequisicaoComContexto } from '../comum/contexto'
import { RELOGIO, type Relogio } from '../comum/relogio'
import { primeiroErro } from '../tarefas/tarefas.controller'
import { CaixaService } from './caixa.service'

/**
 * O caixa do dia — **e a permissão que o protótipo não exige**.
 *
 * Medido: `demoApiBase({action:'fecharCaixa', uid:'u3'})` com a Enfermagem
 * (perfil sem `caixa` e sem `valores`) devolveu `ok:true` e gravou o caixa. A
 * tela guarda por `VIEW_PERM`, e um POST direto não passa pela tela. Aqui é
 * `@Exige('caixa')` na CLASSE — regra 16, o servidor sempre valida.
 */
@Controller('v1/caixa')
@Exige('caixa')
export class CaixaController {
  // `@Inject` explícito: o esbuild não emite `design:paramtypes`.
  constructor(
    @Inject(CaixaService) private readonly caixa: CaixaService,
    @Inject(RELOGIO) private readonly relogio: Relogio,
  ) {}

  /**
   * **A rota que a regra 6 governa.** Ver `caixa.service.ts`: enquanto o dia
   * está aberto, a resposta não tem campo `esperado` — a chave não existe.
   */
  @Get()
  async doDia(
    @Req() req: RequisicaoComContexto,
    @Query() consulta: unknown,
  ): Promise<ConferenciaDeCaixa> {
    const dados = ConsultaDeCaixa.safeParse(consulta)
    if (!dados.success) throw new BadRequestException(primeiroErro(dados.error))
    // `!` seguro: `SessaoGuard` é global e esta rota não é `@Publico()`.
    const c = req.contexto!
    const ctx = { clinicaId: c.clinicaId, ator: c.ator, fuso: c.clinicaFuso }
    // Sem `dia`, é HOJE — e o hoje é o do SERVIDOR, no fuso da clínica. O
    // navegador não decide que dia a clínica está fechando (regra 24).
    return this.caixa.doDia(ctx, dados.data.dia ?? diaCivil(this.relogio.agora(), c.clinicaFuso))
  }

  @Get('ultimos')
  async ultimos(@Req() req: RequisicaoComContexto): Promise<ListaDeFechamentos> {
    const c = req.contexto!
    const itens = await this.caixa.ultimos({
      clinicaId: c.clinicaId,
      ator: c.ator,
      fuso: c.clinicaFuso,
    })
    return { itens: [...itens] }
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async fechar(@Req() req: RequisicaoComContexto, @Body() corpo: unknown): Promise<CaixaFechado> {
    const dados = FecharCaixa.safeParse(corpo)
    if (!dados.success) throw new BadRequestException(primeiroErro(dados.error))
    const c = req.contexto!
    return this.caixa.fechar(
      { clinicaId: c.clinicaId, ator: c.ator, fuso: c.clinicaFuso },
      dados.data,
    )
  }
}
