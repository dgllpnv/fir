import {
  type BeneficioDeIndicacaoCriadoSaida,
  CriarBeneficioDeIndicacaoEntrada,
} from '@fir/contracts'
import { BadRequestException, Body, Controller, Inject, NotFoundException, Post, Req } from '@nestjs/common'
import type { RequisicaoComCarteira } from '../contexto-da-carteira'
import { SoUsuarioDeGestao } from '../so-usuario-de-gestao.decorator'
import { BeneficiosDeIndicacaoService, ClienteCarteiraNaoEncontradoParaBeneficio } from './beneficios.service'

@SoUsuarioDeGestao()
@Controller('v1/carteira/beneficios')
export class BeneficiosDeIndicacaoController {
  constructor(@Inject(BeneficiosDeIndicacaoService) private readonly beneficios: BeneficiosDeIndicacaoService) {}

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
}
