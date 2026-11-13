import { type AtividadesDaClinica, FiltroDeAtividadesDaClinica } from '@fir/contracts'
import { BadRequestException, Controller, Get, Inject, Query, Req } from '@nestjs/common'
import { Exige } from '../autorizacao/autorizacao.guard'
import type { RequisicaoComContexto } from '../comum/contexto'
import { DadoSensivel } from './acesso.decorator'
import { AtividadesDaClinicaService } from './atividades.service'

/**
 * O log do que a equipe fez, na PRÓPRIA clínica. Quem administra (`config`) vê
 * o da sua; ninguém vê o de outra (a clínica vem da sessão). Só metadado.
 */
@Controller('v1/atividades')
export class AtividadesDaClinicaController {
  constructor(
    @Inject(AtividadesDaClinicaService) private readonly atividades: AtividadesDaClinicaService,
  ) {}

  @Get()
  @Exige('config')
  @DadoSensivel('auditoria', { lista: true })
  async listar(
    @Req() req: RequisicaoComContexto,
    @Query() consulta: Record<string, unknown>,
  ): Promise<AtividadesDaClinica> {
    const limpa = Object.fromEntries(Object.entries(consulta).filter(([, v]) => v !== ''))
    const f = FiltroDeAtividadesDaClinica.safeParse(limpa)
    if (!f.success) {
      throw new BadRequestException(f.error.issues[0]?.message ?? 'Confira os filtros.')
    }
    const c = req.contexto!
    return this.atividades.listar(c.clinicaId, c.ator, c.clinicaFuso, f.data)
  }
}
