import {
  type CatalogoDeKpisNaSaida,
  ConsultaDaPrevia,
  ConsultaDaSerie,
  ConsultaDasSeries,
  ConsultaDeKpis,
  CriarKpi,
  CriarMetaDeKpi,
  type DetalheDoKpi,
  EditarKpi,
  EditarMetaDeKpi,
  type ListaDeKpis,
  type MetaDeKpiNaSaida,
  type PreviaDaMeta,
  type SerieDoKpi,
  type SeriesDosKpis,
} from '@fir/contracts'
import { BadRequestException, Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Put, Query, Req } from '@nestjs/common'
import type { z } from 'zod'
import { Exige } from '../autorizacao/autorizacao.guard'
import type { RequisicaoComContexto } from '../comum/contexto'
import { primeiroErro } from '../tarefas/tarefas.controller'
import { type ContextoDeIndicadores, IndicadoresService } from './indicadores.service'

function ler<T extends z.ZodTypeAny>(schema: T, entrada: unknown): z.infer<T> {
  const r = schema.safeParse(entrada)
  if (!r.success) throw new BadRequestException(primeiroErro(r.error))
  return r.data
}

function ctxDe(req: RequisicaoComContexto): ContextoDeIndicadores {
  // `!` seguro: `SessaoGuard` é global e nenhuma rota daqui é `@Publico()`.
  const c = req.contexto!
  return { clinicaId: c.clinicaId, ator: c.ator, fuso: c.clinicaFuso, pode: c.pode }
}

/**
 * **INDICADORES & INSIGHTS — as rotas de KPI e de meta (T2).**
 *
 * Toda rota tem `@Exige` explícito: `indicadores` para ler, `indicadores.gerir`
 * para escrever e para o catálogo. A `permissaoDoValor` de cada KPI é filtrada
 * na calculadora (`IndicadoresService.kpisVisiveis`), nunca aqui; a redação de
 * `valores` é do `RedacaoInterceptor`. Escrever em reais sem `valores` é 403
 * no serviço (C3), em meta, prévia e edição.
 */
@Controller('v1/indicadores')
export class IndicadoresController {
  // `@Inject` explícito: o esbuild não emite `design:paramtypes`.
  constructor(@Inject(IndicadoresService) private readonly indicadores: IndicadoresService) {}

  @Get('catalogo')
  @Exige('indicadores.gerir')
  async catalogo(@Req() req: RequisicaoComContexto): Promise<CatalogoDeKpisNaSaida> {
    return this.indicadores.catalogo(ctxDe(req))
  }

  @Get()
  @Exige('indicadores')
  async listar(@Req() req: RequisicaoComContexto, @Query() q: unknown): Promise<ListaDeKpis> {
    return this.indicadores.listar(ctxDe(req), ler(ConsultaDeKpis, q))
  }

  @Get('metas/previa')
  @Exige('indicadores.gerir')
  async previa(@Req() req: RequisicaoComContexto, @Query() q: unknown): Promise<PreviaDaMeta> {
    return this.indicadores.previa(ctxDe(req), ler(ConsultaDaPrevia, q))
  }

  @Get('kpis/:id')
  @Exige('indicadores')
  async detalhe(@Req() req: RequisicaoComContexto, @Param('id', ParseUUIDPipe) id: string): Promise<DetalheDoKpi> {
    return this.indicadores.detalhe(ctxDe(req), id)
  }

  /** Os minigráficos da tela principal num pedido só (revisão P6); a permissão de cada KPI é a da porta única. */
  @Get('series')
  @Exige('indicadores')
  async series(@Req() req: RequisicaoComContexto, @Query() q: unknown): Promise<SeriesDosKpis> {
    return this.indicadores.seriesDoMinigrafico(ctxDe(req), ler(ConsultaDasSeries, q).ids)
  }

  @Get('kpis/:id/serie')
  @Exige('indicadores')
  async serie(
    @Req() req: RequisicaoComContexto,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() q: unknown,
  ): Promise<SerieDoKpi> {
    return this.indicadores.serie(ctxDe(req), id, ler(ConsultaDaSerie, q))
  }

  @Post('kpis')
  @Exige('indicadores.gerir')
  async criarKpi(@Req() req: RequisicaoComContexto, @Body() corpo: unknown): Promise<DetalheDoKpi> {
    return this.indicadores.criarKpi(ctxDe(req), ler(CriarKpi, corpo))
  }

  @Put('kpis/:id')
  @Exige('indicadores.gerir')
  async editarKpi(
    @Req() req: RequisicaoComContexto,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() corpo: unknown,
  ): Promise<DetalheDoKpi> {
    return this.indicadores.editarKpi(ctxDe(req), id, ler(EditarKpi, corpo))
  }

  @Post('kpis/:id/arquivar')
  @HttpCode(200)
  @Exige('indicadores.gerir')
  async arquivarKpi(@Req() req: RequisicaoComContexto, @Param('id', ParseUUIDPipe) id: string): Promise<{ arquivado: true }> {
    return this.indicadores.arquivarKpi(ctxDe(req), id)
  }

  @Post('metas')
  @Exige('indicadores.gerir')
  async criarMeta(@Req() req: RequisicaoComContexto, @Body() corpo: unknown): Promise<MetaDeKpiNaSaida> {
    return this.indicadores.criarMeta(ctxDe(req), ler(CriarMetaDeKpi, corpo))
  }

  @Put('metas/:id')
  @Exige('indicadores.gerir')
  async editarMeta(
    @Req() req: RequisicaoComContexto,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() corpo: unknown,
  ): Promise<MetaDeKpiNaSaida> {
    return this.indicadores.editarMeta(ctxDe(req), id, ler(EditarMetaDeKpi, corpo))
  }

  @Post('metas/:id/arquivar')
  @HttpCode(200)
  @Exige('indicadores.gerir')
  async arquivarMeta(@Req() req: RequisicaoComContexto, @Param('id', ParseUUIDPipe) id: string): Promise<{ arquivada: true }> {
    return this.indicadores.arquivarMeta(ctxDe(req), id)
  }
}
