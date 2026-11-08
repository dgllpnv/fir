import type { ResumoSemanalSaida } from '@fir/contracts'
import { Controller, Get, Inject, Req } from '@nestjs/common'
import type { RequisicaoComCarteira } from '../contexto-da-carteira'
import { SoUsuarioDeGestao } from '../so-usuario-de-gestao.decorator'
import { ResumoSemanalService } from './resumo-semanal.service'

/**
 * `GET /v1/carteira/resumo/semanal` — o texto do "Resumo semanal" (S1).
 *
 * A autorização é a tela `resumo` (`modulos-das-rotas.ts`, `^resumo(/|$)`),
 * imposta pelo `CarteiraGuard`: sem o módulo, 403; `escopo = 'grupo'`, 403
 * (a chave é "só escopo geral", A-5). Sem sessão, 404.
 */
@SoUsuarioDeGestao()
@Controller('v1/carteira')
export class ResumoSemanalController {
  constructor(@Inject(ResumoSemanalService) private readonly resumo: ResumoSemanalService) {}

  @Get('resumo/semanal')
  semanal(@Req() req: RequisicaoComCarteira): Promise<ResumoSemanalSaida> {
    return this.resumo.semanal(req.carteira!.usuarioDeGestao)
  }
}
