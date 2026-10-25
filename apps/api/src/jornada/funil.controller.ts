import { ConsultaDaJornada, type RespostaDaJornada } from '@fir/contracts'
import { BadRequestException, Controller, Get, Inject, Query, Req } from '@nestjs/common'
import { Exige } from '../autorizacao/autorizacao.guard'
import type { RequisicaoComContexto } from '../comum/contexto'
import { FunilService } from './funil.service'

/**
 * `GET /v1/jornada` — Comercial › Jornada do paciente.
 *
 * `@Exige('jornada')`, como as ações do cartão: o funil mostra nome de
 * paciente, valor de orçamento e a situação comercial da clínica inteira. O
 * protótipo não exige nada — `visivel(t)` libera qualquer tarefa com paciente
 * para qualquer usuário — e é assim que a enfermagem vê quanto a clínica
 * fechou no mês.
 *
 * Os VALORES dentro da resposta são apagados pelo `RedacaoInterceptor` para
 * quem não tem `valores`, num ponto único. Nenhum `if` sobre dinheiro mora
 * aqui nem no serviço.
 */
@Controller('v1/jornada')
@Exige('jornada')
export class FunilController {
  constructor(@Inject(FunilService) private readonly funil: FunilService) {}

  @Get()
  async abrir(
    @Req() req: RequisicaoComContexto,
    @Query() consulta: unknown,
  ): Promise<RespostaDaJornada> {
    const dados = ConsultaDaJornada.safeParse(consulta)
    // Sem o valor que causou o erro: a query string pode carregar o id de uma
    // pessoa, e mensagem de erro é o caminho mais curto para o log (regra 21).
    if (!dados.success) throw new BadRequestException('Confira os filtros da tela.')
    // `!` seguro: `SessaoGuard` é global e esta rota não é `@Publico()`.
    const c = req.contexto!
    return this.funil.abrir(c.clinicaId, c.ator, c.clinicaFuso, dados.data)
  }
}
