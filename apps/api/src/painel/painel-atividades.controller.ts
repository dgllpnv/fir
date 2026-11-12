import { type AtividadesDoPainel, FiltroDeAtividades } from '@fir/contracts'
import { BadRequestException, Controller, Get, Inject, NotFoundException, Query, Req } from '@nestjs/common'
import type { RequisicaoComPainel } from './contexto-do-painel'
import { PainelAtividadesService } from './painel-atividades.service'
import { SoOperador } from './so-operador.decorator'

/**
 * O log de atividades da equipe, para o superadmin. Só leitura, só metadado
 * (ver `PainelAtividadesService`). `@SoOperador`: nenhuma sessão de clínica
 * ou de carteira alcança esta rota.
 */
@SoOperador()
@Controller('v1/superadmin/atividades')
export class PainelAtividadesController {
  constructor(@Inject(PainelAtividadesService) private readonly atividades: PainelAtividadesService) {}

  @Get()
  async listar(
    @Query() consulta: Record<string, unknown>,
    @Req() req: RequisicaoComPainel,
  ): Promise<AtividadesDoPainel> {
    if (!req.painel) throw new NotFoundException()
    // Parâmetro vazio (`?acao=`) é "sem filtro", não erro.
    const limpa = Object.fromEntries(Object.entries(consulta).filter(([, v]) => v !== ''))
    const f = FiltroDeAtividades.safeParse(limpa)
    if (!f.success) {
      throw new BadRequestException(f.error.issues[0]?.message ?? 'Confira os filtros.')
    }
    return this.atividades.listar(req.painel.ator, f.data)
  }
}
