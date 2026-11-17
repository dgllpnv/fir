import { type ComposicaoDoKpi, ConsultaDaComposicao, ConsultaDeLancamentos, type ListaDeLancamentos } from '@fir/contracts'
import { BadRequestException, Controller, Get, Inject, Param, ParseUUIDPipe, Query, Req } from '@nestjs/common'
import type { z } from 'zod'
import { Exige } from '../autorizacao/autorizacao.guard'
import type { RequisicaoComContexto } from '../comum/contexto'
import { primeiroErro } from '../comum/primeiro-erro'
import { DetalheDoKpiService } from './detalhe.service'
import type { ContextoDeIndicadores } from './indicadores.service'

function ler<T extends z.ZodTypeAny>(schema: T, entrada: unknown): z.infer<T> {
  const r = schema.safeParse(entrada ?? {})
  if (!r.success) throw new BadRequestException(primeiroErro(r.error))
  return r.data
}

function ctxDe(req: RequisicaoComContexto): ContextoDeIndicadores {
  // `!` seguro: `SessaoGuard` é global e nenhuma rota daqui é `@Publico()`.
  const c = req.contexto!
  return { clinicaId: c.clinicaId, ator: c.ator, fuso: c.clinicaFuso, pode: c.pode }
}

/**
 * **T6: "De onde vem o número"** (backlog 1.9 E). `indicadores` nas duas; a
 * `permissaoDoValor` é da porta `kpiVisivel` (C5 → 404) e a
 * `permissaoDaComposicao`, do serviço (L-IN-3 → 403). A redação de
 * `emDinheiro` é do `RedacaoInterceptor`.
 */
@Controller('v1/indicadores/kpis')
export class DetalheDoKpiController {
  // `@Inject` explícito: o esbuild não emite `design:paramtypes`.
  constructor(@Inject(DetalheDoKpiService) private readonly detalhe: DetalheDoKpiService) {}

  @Get(':id/composicao')
  @Exige('indicadores')
  async composicao(
    @Req() req: RequisicaoComContexto,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() q: unknown,
  ): Promise<ComposicaoDoKpi> {
    return this.detalhe.composicao(ctxDe(req), id, ler(ConsultaDaComposicao, q))
  }

  @Get(':id/lancamentos')
  @Exige('indicadores')
  async lancamentos(
    @Req() req: RequisicaoComContexto,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() q: unknown,
  ): Promise<ListaDeLancamentos> {
    return this.detalhe.lancamentos(ctxDe(req), id, ler(ConsultaDeLancamentos, q))
  }
}
