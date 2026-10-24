import { ConsultaDeHoje, type RespostaDeHoje } from '@fir/contracts'
import { BadRequestException, Controller, Get, Inject, Query, Req } from '@nestjs/common'
import type { RequisicaoComContexto } from '../comum/contexto'
import { ConsultaDeTarefasService } from '../tarefas/consulta.service'
import { autorDe, exigirEscopo } from '../tarefas/leitura'

/**
 * `GET /v1/hoje` — a tela que a clínica deixa aberta o dia inteiro.
 *
 * Controlador próprio, serviço compartilhado com `GET /v1/tarefas`: as duas
 * telas leem a mesma coisa com recortes diferentes, e a janela de período
 * precisa ser a mesma escrita nas duas.
 *
 * Sem `@Exige`: Hoje é de todos (`menu.ts`, `perm: null`). O que é controlado
 * por permissão é o ESCOPO — `equipe` exige `tarefas.equipe`.
 */
@Controller('v1/hoje')
export class HojeController {
  // `@Inject` explícito: o esbuild não emite `design:paramtypes`.
  constructor(
    @Inject(ConsultaDeTarefasService) private readonly consulta: ConsultaDeTarefasService,
  ) {}

  @Get()
  async abrir(
    @Req() req: RequisicaoComContexto,
    @Query() consulta: unknown,
  ): Promise<RespostaDeHoje> {
    const dados = ConsultaDeHoje.safeParse(consulta)
    if (!dados.success) throw new BadRequestException('Confira os filtros da tela.')
    // `!` seguro: `SessaoGuard` é global e esta rota não é `@Publico()`.
    const c = req.contexto!
    exigirEscopo(c, dados.data.escopo)
    return this.consulta.hoje(c.clinicaId, c.ator, c.clinicaFuso, autorDe(c), dados.data)
  }
}

