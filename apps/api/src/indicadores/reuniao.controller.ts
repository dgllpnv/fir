import type { ContadorDeIndicadores, IndicadoresDaSemana, ReuniaoDeIndicadores } from '@fir/contracts'
import { Controller, Get, Inject, Req } from '@nestjs/common'
import { Exige } from '../autorizacao/autorizacao.guard'
import type { RequisicaoComContexto } from '../comum/contexto'
import type { ContextoDeIndicadores } from './indicadores.service'
import { ReuniaoDeIndicadoresService } from './reuniao.service'

function ctxDe(req: RequisicaoComContexto): ContextoDeIndicadores {
  // `!` seguro: `SessaoGuard` é global e nenhuma rota daqui é `@Publico()`.
  const c = req.contexto!
  return { clinicaId: c.clinicaId, ator: c.ator, fuso: c.clinicaFuso, pode: c.pode }
}

/**
 * **T7: Hoje, o contador do menu e o Modo reunião** (spec I-45, I-46).
 * `indicadores` em todas; a `permissaoDoValor` é da calculadora (C5), e a
 * redação de `emDinheiro`, do `RedacaoInterceptor`. Sem cache (I-45): se o
 * p95 de `/contador` passar de 800 ms, materializar a situação, com ADR.
 */
@Controller('v1/indicadores')
export class ReuniaoDeIndicadoresController {
  // `@Inject` explícito: o esbuild não emite `design:paramtypes`.
  constructor(@Inject(ReuniaoDeIndicadoresService) private readonly servico: ReuniaoDeIndicadoresService) {}

  @Get('da-semana')
  @Exige('indicadores')
  async daSemana(@Req() req: RequisicaoComContexto): Promise<IndicadoresDaSemana> {
    return this.servico.daSemana(ctxDe(req))
  }

  @Get('contador')
  @Exige('indicadores')
  async contador(@Req() req: RequisicaoComContexto): Promise<ContadorDeIndicadores> {
    return this.servico.contador(ctxDe(req))
  }

  @Get('reuniao')
  @Exige('indicadores')
  async reuniao(@Req() req: RequisicaoComContexto): Promise<ReuniaoDeIndicadores> {
    return this.servico.reuniao(ctxDe(req))
  }
}
