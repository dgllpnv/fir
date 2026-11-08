import { type AgendaExterna, SalvarAgendaExterna } from '@fir/contracts'
import { BadRequestException, Body, Controller, Get, HttpCode, HttpStatus, Inject, Post, Put, Req } from '@nestjs/common'
import { Exige } from '../autorizacao/autorizacao.guard'
import type { RequisicaoComContexto } from '../comum/contexto'
import { primeiroErro } from '../tarefas/tarefas.controller'
import { AgendaExternaService } from './agenda-externa.service'

/**
 * A agenda do sistema da clínica (ADR 0019). `config`: é configuração da
 * clínica, ao lado de Unidades e Usuários, e o link dá leitura da agenda de
 * pacientes — não é coisa do balcão.
 */
@Controller('v1/agenda-externa')
@Exige('config')
export class AgendaExternaController {
  // `@Inject` explícito: o esbuild não emite `design:paramtypes`.
  constructor(@Inject(AgendaExternaService) private readonly agenda: AgendaExternaService) {}

  @Get()
  async ler(@Req() req: RequisicaoComContexto): Promise<AgendaExterna> {
    // `!` seguro: `SessaoGuard` é global e esta rota não é `@Publico()`.
    const c = req.contexto!
    return this.agenda.ler({ clinicaId: c.clinicaId, ator: c.ator })
  }

  @Put()
  async salvar(@Body() corpo: unknown, @Req() req: RequisicaoComContexto): Promise<AgendaExterna> {
    const dados = SalvarAgendaExterna.safeParse(corpo)
    if (!dados.success) throw new BadRequestException(primeiroErro(dados.error))
    const c = req.contexto!
    return this.agenda.salvar({ clinicaId: c.clinicaId, ator: c.ator }, dados.data)
  }

  @Post('sincronizar')
  @HttpCode(HttpStatus.ACCEPTED)
  async sincronizar(@Req() req: RequisicaoComContexto): Promise<{ pedida: true }> {
    const c = req.contexto!
    return this.agenda.sincronizarAgora({ clinicaId: c.clinicaId, ator: c.ator })
  }
}
