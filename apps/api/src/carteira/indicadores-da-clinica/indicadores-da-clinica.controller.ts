import { type IndicadoresDaClinicaNaCarteiraSaida, Uuid } from '@fir/contracts'
import { Controller, Get, Inject, NotFoundException, Param, Req } from '@nestjs/common'
import type { RequisicaoComCarteira } from '../contexto-da-carteira'
import { SoUsuarioDeGestao } from '../so-usuario-de-gestao.decorator'
import { ClienteSemIndicadoresVisiveis, IndicadoresDaClinicaService } from './indicadores-da-clinica.service'

/**
 * T10 — o bloco "Indicadores da clínica" da ficha. Só `Usuário de Gestão`
 * (`CarteiraGuard`, tela `firclinic`); `@SoUsuarioDeGestao` põe a rota no
 * espaço `carteira` do `RedacaoInterceptor`, que apaga `emDinheiro` de quem
 * não tem `valores` (appsec C28).
 */
@SoUsuarioDeGestao()
@Controller('v1/carteira')
export class IndicadoresDaClinicaController {
  constructor(@Inject(IndicadoresDaClinicaService) private readonly indicadores: IndicadoresDaClinicaService) {}

  @Get('clientes/:id/indicadores-da-clinica')
  async doCliente(@Param('id') id: string, @Req() req: RequisicaoComCarteira): Promise<IndicadoresDaClinicaNaCarteiraSaida> {
    if (!Uuid.safeParse(id).success) throw new NotFoundException('Cliente Firmare não encontrado.')
    try {
      return await this.indicadores.doCliente(req.carteira!.usuarioDeGestao, id)
    } catch (e) {
      if (e instanceof ClienteSemIndicadoresVisiveis) throw new NotFoundException('Cliente Firmare não encontrado.')
      throw e
    }
  }
}
