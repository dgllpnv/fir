import type { DesfazerCobrancaPagaSaida, ListaDeCobrancasCarteiraSaida, MarcarCobrancaPagaSaida } from '@fir/contracts'
import {
  BadRequestException,
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
import { CobrancaCarteiraNaoEncontrada, CobrancasCarteiraService } from './cobrancas.service'

@SoUsuarioDeGestao()
@Controller('v1/carteira/cobrancas')
export class CobrancasCarteiraController {
  constructor(@Inject(CobrancasCarteiraService) private readonly cobrancas: CobrancasCarteiraService) {}

  @Get()
  async listar(
    @Query('clienteId') clienteId: string | undefined,
    @Req() req: RequisicaoComCarteira,
  ): Promise<ListaDeCobrancasCarteiraSaida> {
    if (!clienteId) throw new BadRequestException('Informe clienteId.')
    return this.cobrancas.listarPorCliente(req.carteira!.usuarioDeGestao, clienteId)
  }

  @Post(':id/marcar-pago')
  async marcarPago(
    @Param('id') id: string,
    @Req() req: RequisicaoComCarteira,
  ): Promise<MarcarCobrancaPagaSaida> {
    try {
      const cobranca = await this.cobrancas.marcarPago(req.carteira!.usuarioDeGestao, id)
      return { cobranca }
    } catch (e) {
      if (e instanceof CobrancaCarteiraNaoEncontrada) throw new NotFoundException('Cobrança não encontrada.')
      throw e
    }
  }

  @Post(':id/desfazer-pago')
  async desfazerPago(
    @Param('id') id: string,
    @Req() req: RequisicaoComCarteira,
  ): Promise<DesfazerCobrancaPagaSaida> {
    try {
      const cobranca = await this.cobrancas.desfazerPago(req.carteira!.usuarioDeGestao, id)
      return { cobranca }
    } catch (e) {
      if (e instanceof CobrancaCarteiraNaoEncontrada) throw new NotFoundException('Cobrança não encontrada.')
      throw e
    }
  }
}
