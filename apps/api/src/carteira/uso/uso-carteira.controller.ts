import { Uuid, type UsoDoClienteSaida, type VisaoDeUsoSaida } from '@fir/contracts'
import { Controller, Get, Inject, NotFoundException, Param, Req } from '@nestjs/common'
import type { RequisicaoComCarteira } from '../contexto-da-carteira'
import { SoUsuarioDeGestao } from '../so-usuario-de-gestao.decorator'
import { ClienteSemUsoVisivel, UsoCarteiraService } from './uso-carteira.service'

/**
 * O painel FIR Clinic (`vFirClinic`) e a aba de uso da ficha (`cUso`).
 * Só `Usuário de Gestão` (`CarteiraGuard`): sem sessão de carteira, 404.
 */
@SoUsuarioDeGestao()
@Controller('v1/carteira')
export class UsoCarteiraController {
  constructor(@Inject(UsoCarteiraService) private readonly uso: UsoCarteiraService) {}

  @Get('uso')
  visao(@Req() req: RequisicaoComCarteira): Promise<VisaoDeUsoSaida> {
    return this.uso.visao(req.carteira!.usuarioDeGestao)
  }

  @Get('clientes/:id/uso')
  async doCliente(@Param('id') id: string, @Req() req: RequisicaoComCarteira): Promise<UsoDoClienteSaida> {
    // Id malformado responde o MESMO 404 de "não existe" e de "outro grupo".
    if (!Uuid.safeParse(id).success) throw new NotFoundException('Cliente Firmare não encontrado.')
    try {
      return await this.uso.doCliente(req.carteira!.usuarioDeGestao, id)
    } catch (e) {
      if (e instanceof ClienteSemUsoVisivel) throw new NotFoundException('Cliente Firmare não encontrado.')
      throw e
    }
  }
}
