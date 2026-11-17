import { CriarOkr, DuplicarOkr, EditarOkr, type ListaDeOkrs, type OkrNaSaida } from '@fir/contracts'
import { BadRequestException, Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Put, Req } from '@nestjs/common'
import type { z } from 'zod'
import { Exige } from '../autorizacao/autorizacao.guard'
import { primeiroErro } from '../comum/primeiro-erro'
import type { RequisicaoComContexto } from '../comum/contexto'
import type { ContextoDeIndicadores } from './indicadores.service'
import { OkrsService } from './okrs.service'

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
 * **OKRs (T4).** `indicadores` para ler; `indicadores.gerir` para escrever.
 * Escrever KR em reais sem `valores` é 403 no serviço (appsec C3), também ao
 * duplicar. A redação de `emDinheiro` é do `RedacaoInterceptor`.
 */
@Controller('v1/indicadores/okrs')
export class OkrsController {
  // `@Inject` explícito: o esbuild não emite `design:paramtypes`.
  constructor(@Inject(OkrsService) private readonly okrs: OkrsService) {}

  @Get()
  @Exige('indicadores')
  async listar(@Req() req: RequisicaoComContexto): Promise<ListaDeOkrs> {
    return this.okrs.listar(ctxDe(req))
  }

  @Get(':id')
  @Exige('indicadores')
  async detalhe(@Req() req: RequisicaoComContexto, @Param('id', ParseUUIDPipe) id: string): Promise<OkrNaSaida> {
    return this.okrs.detalhe(ctxDe(req), id)
  }

  @Post()
  @Exige('indicadores.gerir')
  async criar(@Req() req: RequisicaoComContexto, @Body() corpo: unknown): Promise<OkrNaSaida> {
    return this.okrs.criar(ctxDe(req), ler(CriarOkr, corpo))
  }

  @Put(':id')
  @Exige('indicadores.gerir')
  async editar(
    @Req() req: RequisicaoComContexto,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() corpo: unknown,
  ): Promise<OkrNaSaida> {
    return this.okrs.editar(ctxDe(req), id, ler(EditarOkr, corpo))
  }

  @Post(':id/encerrar')
  @HttpCode(200)
  @Exige('indicadores.gerir')
  async encerrar(@Req() req: RequisicaoComContexto, @Param('id', ParseUUIDPipe) id: string): Promise<OkrNaSaida> {
    return this.okrs.encerrar(ctxDe(req), id)
  }

  @Post(':id/duplicar')
  @Exige('indicadores.gerir')
  async duplicar(
    @Req() req: RequisicaoComContexto,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() corpo: unknown,
  ): Promise<OkrNaSaida> {
    return this.okrs.duplicar(ctxDe(req), id, ler(DuplicarOkr, corpo))
  }

  @Post(':id/arquivar')
  @HttpCode(200)
  @Exige('indicadores.gerir')
  async arquivar(@Req() req: RequisicaoComContexto, @Param('id', ParseUUIDPipe) id: string): Promise<{ arquivado: true }> {
    return this.okrs.arquivar(ctxDe(req), id)
  }
}
