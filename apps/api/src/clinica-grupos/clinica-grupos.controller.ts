import type { GruposDaClinica } from '@fir/contracts'
import { Controller, Get, Inject, Req } from '@nestjs/common'
import { Exige } from '../autorizacao/autorizacao.guard'
import type { RequisicaoComContexto } from '../comum/contexto'
import { ClinicaGruposService } from './clinica-grupos.service'

/**
 * `GET /v1/clinica/grupos` — quem recebe os dados agregados desta clínica.
 *
 * `config`: é a permissão de configurar a clínica (mesma das unidades e do
 * acesso de usuários). Não exige `valores` e não devolve dinheiro.
 */
@Controller('v1/clinica/grupos')
@Exige('config')
export class ClinicaGruposController {
  constructor(@Inject(ClinicaGruposService) private readonly grupos: ClinicaGruposService) {}

  @Get()
  async listar(@Req() req: RequisicaoComContexto): Promise<GruposDaClinica> {
    const c = req.contexto!
    return this.grupos.listar(c.clinicaId, c.ator)
  }
}
