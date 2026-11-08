import {
  type BeneficioDeIndicacaoCriadoSaida,
  type BeneficioVinculadoSaida,
  type ListaDeBeneficiosSaida,
  CriarBeneficioDeIndicacaoEntrada,
  Uuid,
  VincularBeneficioEntrada,
} from '@fir/contracts'
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
  Req,
} from '@nestjs/common'
import type { RequisicaoComCarteira } from '../contexto-da-carteira'
import { SoUsuarioDeGestao } from '../so-usuario-de-gestao.decorator'
import {
  BeneficioJaLigado,
  BeneficioNaoEncontrado,
  BeneficiosDeIndicacaoService,
  ClienteCarteiraNaoEncontradoParaBeneficio,
} from './beneficios.service'

@SoUsuarioDeGestao()
@Controller('v1/carteira/beneficios')
export class BeneficiosDeIndicacaoController {
  constructor(@Inject(BeneficiosDeIndicacaoService) private readonly beneficios: BeneficiosDeIndicacaoService) {}

  /** A tela de benefícios (L2539-2547): guardados, pendentes e concedidos. */
  @Get()
  async listar(@Req() req: RequisicaoComCarteira): Promise<ListaDeBeneficiosSaida> {
    return this.beneficios.listar(req.carteira!.usuarioDeGestao)
  }

  @Post()
  async criar(
    @Body() corpo: unknown,
    @Req() req: RequisicaoComCarteira,
  ): Promise<BeneficioDeIndicacaoCriadoSaida> {
    const dados = CriarBeneficioDeIndicacaoEntrada.safeParse(corpo)
    if (!dados.success) throw new BadRequestException(dados.error.issues)
    try {
      const beneficio = await this.beneficios.criar(req.carteira!.usuarioDeGestao, dados.data)
      return { beneficio }
    } catch (e) {
      if (e instanceof ClienteCarteiraNaoEncontradoParaBeneficio) {
        throw new NotFoundException('Cliente Firmare não encontrado.')
      }
      throw e
    }
  }

  /** Liga o benefício GUARDADO ao cliente em que quem indicou se tornou (D-22 item 11). */
  @Post(':id/vincular')
  async vincular(
    @Param('id') id: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoComCarteira,
  ): Promise<BeneficioVinculadoSaida> {
    if (!Uuid.safeParse(id).success) throw new NotFoundException('Benefício não encontrado.')
    const dados = VincularBeneficioEntrada.safeParse(corpo)
    if (!dados.success) throw new BadRequestException('Escolha o cliente.')
    try {
      const beneficio = await this.beneficios.vincularACliente(
        req.carteira!.usuarioDeGestao,
        id,
        dados.data.clienteCarteiraId,
      )
      return { beneficio }
    } catch (e) {
      if (e instanceof BeneficioNaoEncontrado) throw new NotFoundException('Benefício não encontrado.')
      if (e instanceof ClienteCarteiraNaoEncontradoParaBeneficio) {
        throw new NotFoundException('Cliente Firmare não encontrado.')
      }
      if (e instanceof BeneficioJaLigado) throw new ConflictException('Este benefício já está ligado a outro cliente.')
      throw e
    }
  }
}
