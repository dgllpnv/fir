import type { ContadoresDoMenuSaida, VisaoGeralDaCarteiraSaida } from '@fir/contracts'
import { Controller, Get, Inject, Req } from '@nestjs/common'
import type { RequisicaoComCarteira } from '../contexto-da-carteira'
import { SoUsuarioDeGestao } from '../so-usuario-de-gestao.decorator'
import { VisaoGeralService } from './visao-geral.service'

/**
 * G8 3B — a Visão geral da carteira e os badges do menu. Só `Usuário de
 * Gestão` (`CarteiraGuard`): sem sessão de carteira, 404.
 *
 * As telas vêm de `modulos-das-rotas.ts`, sem linha nova:
 *  - `painel` casa `^painel` → tela `painel`, que é "só escopo geral" na
 *    tabela do domínio (A-5: MRR e carga da equipe são uso interno da
 *    Firmare). `escopo='grupo'` recebe 403, por mais que tenha o módulo.
 *  - `eu/contadores` casa `^eu` → `livre`: é a SESSÃO própria (o menu de
 *    quem está aqui). O serviço só conta o que a sessão tem a tela para ver.
 */
@SoUsuarioDeGestao()
@Controller('v1/carteira')
export class VisaoGeralController {
  constructor(@Inject(VisaoGeralService) private readonly visao: VisaoGeralService) {}

  @Get('painel')
  painel(@Req() req: RequisicaoComCarteira): Promise<VisaoGeralDaCarteiraSaida> {
    return this.visao.visaoGeral(req.carteira!.usuarioDeGestao)
  }

  @Get('eu/contadores')
  contadores(@Req() req: RequisicaoComCarteira): Promise<ContadoresDoMenuSaida> {
    return this.visao.contadores(req.carteira!.usuarioDeGestao)
  }
}
