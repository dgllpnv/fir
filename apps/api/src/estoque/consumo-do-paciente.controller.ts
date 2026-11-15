import { ConsultaDoConsumo, type RespostaDoConsumo } from '@fir/contracts'
import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Query,
  Req,
} from '@nestjs/common'
import { DadoSensivel } from '../auditoria/acesso.decorator'
import { Exige } from '../autorizacao/autorizacao.guard'
import type { RequisicaoComContexto } from '../comum/contexto'
import { primeiroErro } from '../comum/primeiro-erro'
import { leitorDe } from '../tarefas/leitura'
import { ConsumoDoPacienteService } from './consumo-do-paciente.service'

/**
 * `GET /v1/pacientes/:id/consumo` — a aba Consumo da ficha.
 *
 * DUAS permissões, e as duas são cobradas: `estoque` (o que se aplicou é
 * movimento de estoque) e `jornada` (a MESMA que a aba Orçamentos exige para
 * existir na ficha). `@Exige` é uma chave por vez e o do handler SUBSTITUI o da
 * classe, então a segunda é cobrada aqui, antes de qualquer leitura — 403 com o
 * banco intocado e SEM linha de acesso (o interceptor só grava em resposta de
 * sucesso).
 *
 * `@DadoSensivel('pacientes')`: dose, produto e lote por paciente (regra 18).
 * Na sessão de suporte o acesso é gravado com `ator_tipo = 'operador'`.
 */
@Controller('v1/pacientes/:id/consumo')
@Exige('estoque')
export class ConsumoDoPacienteController {
  constructor(
    @Inject(ConsumoDoPacienteService) private readonly consumo: ConsumoDoPacienteService,
  ) {}

  @Get()
  @DadoSensivel('pacientes')
  async listar(
    @Req() req: RequisicaoComContexto,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() consulta: unknown,
  ): Promise<RespostaDoConsumo> {
    const c = req.contexto!
    if (!c.pode('jornada')) throw new ForbiddenException('Sem acesso a esta ação.')
    const dados = ConsultaDoConsumo.safeParse(consulta ?? {})
    if (!dados.success) throw new BadRequestException(primeiroErro(dados.error))
    return this.consumo.listar(c.clinicaId, c.ator, leitorDe(c), id, dados.data.pagina)
  }
}
