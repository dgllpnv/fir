import {
  CriarMetaComercialEntrada,
  type ListaDeMetasComerciaisSaida,
  type MetaComercialCriadaSaida,
} from '@fir/contracts'
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Post,
  Query,
  Req,
} from '@nestjs/common'
import type { RequisicaoComCarteira } from '../contexto-da-carteira'
import { SoUsuarioDeGestao } from '../so-usuario-de-gestao.decorator'
import { IndicadorCarteiraNaoEncontradoParaMeta, MetasComerciaisService } from './metas.service'

@SoUsuarioDeGestao()
@Controller('v1/carteira/metas')
export class MetasComerciaisController {
  constructor(@Inject(MetasComerciaisService) private readonly metas: MetasComerciaisService) {}

  @Post()
  async criar(@Body() corpo: unknown, @Req() req: RequisicaoComCarteira): Promise<MetaComercialCriadaSaida> {
    const dados = CriarMetaComercialEntrada.safeParse(corpo)
    if (!dados.success) throw new BadRequestException(dados.error.issues)
    try {
      const meta = await this.metas.criar(req.carteira!.usuarioDeGestao, dados.data)
      return { meta }
    } catch (e) {
      if (e instanceof IndicadorCarteiraNaoEncontradoParaMeta) throw new NotFoundException('Indicador não encontrado.')
      throw e
    }
  }

  @Get()
  async listar(
    @Query('clienteId') clienteId: string | undefined,
    @Req() req: RequisicaoComCarteira,
  ): Promise<ListaDeMetasComerciaisSaida> {
    if (!clienteId) throw new BadRequestException('Informe clienteId.')
    const metas = await this.metas.listarPorCliente(req.carteira!.usuarioDeGestao, clienteId)
    return { metas }
  }
}
