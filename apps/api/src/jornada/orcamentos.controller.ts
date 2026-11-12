import { ConsultaDeOrcamentos, type RespostaDeOrcamentos } from '@fir/contracts'
import { BadRequestException, Controller, Get, Inject, Query, Req } from '@nestjs/common'
import { Exige } from '../autorizacao/autorizacao.guard'
import type { RequisicaoComContexto } from '../comum/contexto'
import { OrcamentosService } from './orcamentos.service'

/** `GET /v1/jornada/orcamentos` — contagens por atendente; nenhum valor sai daqui. */
@Controller('v1/jornada/orcamentos')
@Exige('jornada')
export class OrcamentosController {
  constructor(@Inject(OrcamentosService) private readonly orcamentos: OrcamentosService) {}

  @Get()
  async abrir(
    @Req() req: RequisicaoComContexto,
    @Query() consulta: unknown,
  ): Promise<RespostaDeOrcamentos> {
    const dados = ConsultaDeOrcamentos.safeParse(consulta)
    if (!dados.success) throw new BadRequestException('Confira os filtros da tela.')
    const c = req.contexto!
    return this.orcamentos.abrir(c.clinicaId, c.ator, c.clinicaFuso, dados.data)
  }
}
