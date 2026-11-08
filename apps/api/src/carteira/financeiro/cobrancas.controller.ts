import {
  type BaixarMensalidadesPagasSaida,
  type DesfazerCobrancaPagaSaida,
  type ListaDeCobrancasCarteiraSaida,
  type MarcarCobrancaPagaSaida,
  type PainelDeMensalidadesSaida,
  BaixarMensalidadesPagasEntrada,
  MesDoPainel,
} from '@fir/contracts'
import {
  BadRequestException,
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

  /**
   * O painel de Mensalidades do mês (G8 1F). `mes` = `aaaa-mm`; ausente, o
   * mês corrente no fuso da carteira (o servidor decide, regra 24). Os campos
   * monetários saem `null` sem `valores`, pelo tradutor único.
   */
  @Get('painel')
  async painel(
    @Query('mes') mes: string | undefined,
    @Req() req: RequisicaoComCarteira,
  ): Promise<PainelDeMensalidadesSaida> {
    let mesValido: string | undefined
    if (mes !== undefined) {
      const r = MesDoPainel.safeParse(mes)
      if (!r.success) throw new BadRequestException('Mês inválido: use aaaa-mm.')
      mesValido = r.data
    }
    return this.cobrancas.painel(req.carteira!.usuarioDeGestao, mesValido)
  }

  /** "Baixar pagos": marcar várias mensalidades como pagas, idempotente. */
  @Post('baixar-pagos')
  async baixarPagos(@Body() corpo: unknown, @Req() req: RequisicaoComCarteira): Promise<BaixarMensalidadesPagasSaida> {
    const dados = BaixarMensalidadesPagasEntrada.safeParse(corpo)
    if (!dados.success) throw new BadRequestException('Escolha ao menos uma mensalidade.')
    try {
      return await this.cobrancas.baixarPagos(req.carteira!.usuarioDeGestao, dados.data.cobrancaIds)
    } catch (e) {
      if (e instanceof CobrancaCarteiraNaoEncontrada) throw new NotFoundException('Cobrança não encontrada.')
      throw e
    }
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
