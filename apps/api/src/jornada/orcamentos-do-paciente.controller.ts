import type { RespostaDeOrcamentosDoPaciente } from '@fir/contracts'
import { Controller, Get, Inject, Param, ParseUUIDPipe, Req } from '@nestjs/common'
import { DadoSensivel } from '../auditoria/acesso.decorator'
import { Exige } from '../autorizacao/autorizacao.guard'
import type { RequisicaoComContexto } from '../comum/contexto'
import { OrcamentosDoPacienteService } from './orcamentos-do-paciente.service'

/**
 * `GET /v1/pacientes/:id/orcamentos` — a aba Orçamentos da ficha.
 *
 * Mora no módulo da jornada (e não no de pacientes) porque a regra é a da
 * jornada: `resumoDoOrcamento`. `jornada` é a permissão — sem ela, sem
 * histórico de orçamentos —, e o acesso é gravado na trilha (regra 18) com o id
 * da paciente.
 */
@Controller('v1/pacientes/:id/orcamentos')
@Exige('jornada')
export class OrcamentosDoPacienteController {
  constructor(
    @Inject(OrcamentosDoPacienteService) private readonly orcamentos: OrcamentosDoPacienteService,
  ) {}

  @Get()
  @DadoSensivel('pacientes')
  async listar(
    @Req() req: RequisicaoComContexto,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<RespostaDeOrcamentosDoPaciente> {
    const c = req.contexto!
    return this.orcamentos.listar(c.clinicaId, c.ator, id)
  }
}
