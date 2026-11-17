import type { FavoritoNaLista, ListaDeRelatorios, ResultadoDaExportacao, ResultadoDoRelatorio } from '@fir/contracts'
import {
  type ArgumentsHost,
  Body,
  Catch,
  Controller,
  type ExceptionFilter,
  Get,
  HttpCode,
  HttpException,
  Inject,
  Logger,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Req,
  UseFilters,
} from '@nestjs/common'
import type { FastifyReply } from 'fastify'
import { Exige } from '../autorizacao/autorizacao.guard'
import { SessaoDeSuporteNaoAssina } from '../banco/ator'
import type { RequisicaoComContexto } from '../comum/contexto'
import { FiltroDeSessaoDeSuporte } from '../comum/sessao-de-suporte.filtro'
import { FavoritosService, type ContextoDoFavorito } from './favoritos.service'
import { MotorDeRelatorios } from './motor'

function ctxDe(req: RequisicaoComContexto): ContextoDoFavorito {
  // `!` seguro: `SessaoGuard` é global e nenhuma rota daqui é `@Publico()`.
  const c = req.contexto!
  return {
    clinicaId: c.clinicaId,
    clinicaNome: c.clinicaNome,
    fuso: c.clinicaFuso,
    ator: c.ator,
    pode: c.pode,
    quem: c.pessoa?.nome ?? c.operador?.nome ?? '',
    suporte: c.pessoa === null,
    pessoaId: c.pessoa?.id ?? null,
  }
}

/**
 * **O ERRO DE RELATÓRIO NÃO VAI PARA O LOG COM CONTEÚDO** (appsec C15, C29;
 * LGPD L-IN-16; regra 21).
 *
 * O `HttpException` segue o caminho de sempre (status e mensagem, que são
 * nossos e não levam filtro). Qualquer outro erro vira `500` sem corpo de
 * relatório — e o log leva SÓ a rota e o código do erro: nunca a mensagem do
 * Postgres (que pode citar um valor do parâmetro), nunca corpo, filtro ou
 * linha.
 */
@Catch()
export class FiltroDeErroDeRelatorio implements ExceptionFilter {
  private readonly log = new Logger('Relatorios')

  catch(e: unknown, host: ArgumentsHost): void {
    const resposta = host.switchToHttp().getResponse<FastifyReply>()
    if (e instanceof HttpException) {
      const corpo = e.getResponse()
      void resposta
        .status(e.getStatus())
        .send(typeof corpo === 'string' ? { statusCode: e.getStatus(), message: corpo } : corpo)
      return
    }
    // O filtro global da sessão de suporte não alcança um erro que este filtro
    // de controlador já pegou: a mesma resposta dele, daqui.
    if (e instanceof SessaoDeSuporteNaoAssina) {
      new FiltroDeSessaoDeSuporte().catch(e, host)
      return
    }
    const codigo = typeof e === 'object' && e !== null && typeof (e as { code?: unknown }).code === 'string'
      ? (e as { code: string }).code
      : 'sem-codigo'
    this.log.error(`relatorio falhou (codigo ${codigo})`)
    void resposta.status(500).send({ statusCode: 500, message: 'Erro interno.' })
  }
}

/**
 * **RELATÓRIOS** (spec I-36 a I-41; ticket T8).
 *
 * Toda rota tem `@Exige('indicadores')` (a aba) e o motor confere a permissão
 * DE CADA relatório. Os filtros vão no CORPO de um `POST`, nunca na URL
 * (appsec C15): a URL é o que o proxy e o histórico do navegador guardam.
 */
@Controller('v1/relatorios')
@UseFilters(FiltroDeErroDeRelatorio)
export class RelatoriosController {
  // `@Inject` explícito: o esbuild não emite `design:paramtypes`.
  constructor(
    @Inject(MotorDeRelatorios) private readonly motor: MotorDeRelatorios,
    @Inject(FavoritosService) private readonly favoritos: FavoritosService,
  ) {}

  @Get()
  @Exige('indicadores')
  async listar(@Req() req: RequisicaoComContexto): Promise<ListaDeRelatorios> {
    return this.favoritos.listar(ctxDe(req))
  }

  @Post('favoritos')
  @Exige('indicadores')
  async salvarFavorito(@Req() req: RequisicaoComContexto, @Body() corpo: unknown): Promise<FavoritoNaLista> {
    return this.favoritos.salvar(ctxDe(req), corpo)
  }

  @Put('favoritos/:id')
  @Exige('indicadores')
  async editarFavorito(
    @Req() req: RequisicaoComContexto,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() corpo: unknown,
  ): Promise<FavoritoNaLista> {
    return this.favoritos.editar(ctxDe(req), id, corpo)
  }

  @Post('favoritos/:id/arquivar')
  @HttpCode(204)
  @Exige('indicadores')
  async arquivarFavorito(@Req() req: RequisicaoComContexto, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.favoritos.arquivar(ctxDe(req), id)
  }

  @Post(':chave/execucoes')
  @HttpCode(200)
  @Exige('indicadores')
  async executar(
    @Req() req: RequisicaoComContexto,
    @Param('chave') chave: string,
    @Body() corpo: unknown,
  ): Promise<ResultadoDoRelatorio> {
    return this.motor.executar(ctxDe(req), chave, corpo)
  }

  @Post(':chave/exportacoes')
  @HttpCode(200)
  @Exige('indicadores')
  async exportar(
    @Req() req: RequisicaoComContexto,
    @Param('chave') chave: string,
    @Body() corpo: unknown,
  ): Promise<ResultadoDaExportacao> {
    return this.motor.exportar(ctxDe(req), chave, corpo)
  }
}
