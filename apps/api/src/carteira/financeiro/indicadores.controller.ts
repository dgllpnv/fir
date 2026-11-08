import {
  CriarIndicadorCarteiraEntrada,
  type IndicadorCarteiraCriadoSaida,
  LancarIndicadorEntrada,
  type LancamentoDeIndicadorSalvoSaida,
  type ListaDeIndicadoresCarteiraSaida,
  type ListaDeLancamentosDeIndicadorSaida,
} from '@fir/contracts'
import {
  BadRequestException,
  ForbiddenException,
  Body,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common'
import type { RequisicaoComCarteira } from '../contexto-da-carteira'
import { SoUsuarioDeGestao } from '../so-usuario-de-gestao.decorator'
import {
  ClienteCarteiraNaoEncontrado,
  IndicadorCarteiraNaoEncontrado,
  IndicadoresCarteiraService,
} from './indicadores.service'
import { EntradaInvalidaNaMeta, SemPermissaoDeValoresNaMeta } from './metas-comum'

@SoUsuarioDeGestao()
@Controller('v1/carteira/indicadores')
export class IndicadoresCarteiraController {
  constructor(@Inject(IndicadoresCarteiraService) private readonly indicadores: IndicadoresCarteiraService) {}

  @Post()
  async criar(
    @Body() corpo: unknown,
    @Req() req: RequisicaoComCarteira,
  ): Promise<IndicadorCarteiraCriadoSaida> {
    const dados = CriarIndicadorCarteiraEntrada.safeParse(corpo)
    if (!dados.success) throw new BadRequestException(dados.error.issues)
    try {
      const indicador = await this.indicadores.criar(req.carteira!.usuarioDeGestao, dados.data)
      return { indicador }
    } catch (e) {
      if (e instanceof ClienteCarteiraNaoEncontrado) throw new NotFoundException('Cliente Firmare não encontrado.')
      throw e
    }
  }

  @Get()
  async listar(
    @Query('clienteId') clienteId: string | undefined,
    @Req() req: RequisicaoComCarteira,
  ): Promise<ListaDeIndicadoresCarteiraSaida> {
    if (!clienteId) throw new BadRequestException('Informe clienteId.')
    const indicadores = await this.indicadores.listarPorCliente(req.carteira!.usuarioDeGestao, clienteId)
    return { indicadores }
  }

  @Post(':id/lancamentos')
  async lancar(
    @Param('id') id: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoComCarteira,
  ): Promise<LancamentoDeIndicadorSalvoSaida> {
    const dados = LancarIndicadorEntrada.safeParse(corpo)
    if (!dados.success) throw new BadRequestException(dados.error.issues)
    try {
      const lancamento = await this.indicadores.lancar(req.carteira!.usuarioDeGestao, id, dados.data)
      return { lancamento }
    } catch (e) {
      if (e instanceof IndicadorCarteiraNaoEncontrado) throw new NotFoundException('Indicador não encontrado.')
      if (e instanceof EntradaInvalidaNaMeta) throw new BadRequestException({ codigo: e.codigo, message: e.message })
      if (e instanceof SemPermissaoDeValoresNaMeta) throw new ForbiddenException('Lançar valor em R$ exige a permissão de ver valores.')
      throw e
    }
  }

  @Get(':id/lancamentos')
  async lancamentos(
    @Param('id') id: string,
    @Req() req: RequisicaoComCarteira,
  ): Promise<ListaDeLancamentosDeIndicadorSaida> {
    const lancamentos = await this.indicadores.listarLancamentos(req.carteira!.usuarioDeGestao, id)
    return { lancamentos }
  }
}
