import {
  ConfigFinanceira,
  ConsultaDaVisao,
  type PercentualDaMeta,
  type RotinaDeFechamento,
  SalvarMeta,
  type VisaoDoMes,
} from '@fir/contracts'
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common'
import { Exige } from '../autorizacao/autorizacao.guard'
import type { RequisicaoComContexto } from '../comum/contexto'
import { primeiroErro } from '../tarefas/tarefas.controller'
import { VisaoDoMesService } from './visao-do-mes.service'

const MES = /^\d{4}-\d{2}$/

/**
 * **`finmes` depende de `valores`, e isso não é um `if` neste arquivo.**
 *
 * A dependência vive em `PERMS` (`['Financeiro','finmes',…,'valores']`),
 * `temPerm` a resolve, e o guard chama `temPerm`. Marcar `finmes` sem
 * `valores` não abre nada — e há teste provando isso, para que ninguém
 * "conserte" a tabela um dia.
 */
@Controller('v1')
export class VisaoDoMesController {
  // `@Inject` explícito: o esbuild não emite `design:paramtypes`.
  constructor(@Inject(VisaoDoMesService) private readonly visao: VisaoDoMesService) {}

  @Get('visao-do-mes')
  @Exige('finmes')
  async doMes(
    @Req() req: RequisicaoComContexto,
    @Query() consulta: unknown,
  ): Promise<VisaoDoMes> {
    const dados = ConsultaDaVisao.safeParse(consulta)
    if (!dados.success) throw new BadRequestException(primeiroErro(dados.error))
    const ctx = ctxDe(req)
    return this.visao.visao(ctx, dados.data.mes ?? this.visao.mesCorrente(ctx.fuso))
  }

  /**
   * **SEM `@Exige`** — é o que a equipe lê no topo da tela Recebimentos.
   *
   * A rota devolve `{ meta, recebido, percentual }`; `meta` e `recebido` estão
   * em `CAMPOS_MONETARIOS` e saem `null` para quem não tem `valores`;
   * `percentual` não é monetário e atravessa. **Zero linha de código decide
   * isso** — é o `RedacaoInterceptor`, num ponto único.
   */
  @Get('metas/:mes/percentual')
  async percentual(
    @Req() req: RequisicaoComContexto,
    @Param('mes') mes: string,
  ): Promise<PercentualDaMeta> {
    return this.visao.percentualDaMeta(ctxDe(req), exigirMes(mes))
  }

  @Put('metas/:mes')
  @Exige('finmes')
  async salvarMeta(
    @Req() req: RequisicaoComContexto,
    @Param('mes') mes: string,
    @Body() corpo: unknown,
  ): Promise<PercentualDaMeta> {
    const dados = SalvarMeta.safeParse(corpo)
    if (!dados.success) throw new BadRequestException(primeiroErro(dados.error))
    return this.visao.salvarMeta(ctxDe(req), exigirMes(mes), dados.data.valor)
  }

  /** Remover é o mesmo que gravar zero — e as duas portas levam ao mesmo lugar. */
  @Delete('metas/:mes')
  @Exige('finmes')
  async removerMeta(
    @Req() req: RequisicaoComContexto,
    @Param('mes') mes: string,
  ): Promise<PercentualDaMeta> {
    return this.visao.salvarMeta(ctxDe(req), exigirMes(mes), 0n)
  }

  @Get('configuracoes/financeiro')
  @Exige('finmes')
  async config(@Req() req: RequisicaoComContexto): Promise<ConfigFinanceira> {
    return this.visao.config(ctxDe(req))
  }

  @Patch('configuracoes/financeiro')
  @Exige('finmes')
  async salvarConfig(
    @Req() req: RequisicaoComContexto,
    @Body() corpo: unknown,
  ): Promise<ConfigFinanceira> {
    const dados = ConfigFinanceira.safeParse(corpo)
    if (!dados.success) throw new BadRequestException(primeiroErro(dados.error))
    return this.visao.salvarConfig(ctxDe(req), dados.data)
  }

  @Post('visao-do-mes/rotina')
  @Exige('finmes')
  async criarRotina(@Req() req: RequisicaoComContexto): Promise<RotinaDeFechamento> {
    return this.visao.criarRotina(ctxDe(req))
  }
}

/**
 * `:mes` vem do CAMINHO, e caminho não passa por Zod de corpo.
 *
 * Sem esta checagem, `/v1/metas/outubro/percentual` chegaria ao SQL como
 * `'outubro-01'::date` e viraria 500. A borda recusa, com a mensagem do
 * contrato.
 */
function exigirMes(mes: string): string {
  if (!MES.test(mes)) throw new BadRequestException('use o formato aaaa-mm')
  return mes
}

function ctxDe(req: RequisicaoComContexto) {
  // `!` seguro: `SessaoGuard` é global e nenhuma rota daqui é `@Publico()`.
  const c = req.contexto!
  return { clinicaId: c.clinicaId, ator: c.ator, fuso: c.clinicaFuso }
}
