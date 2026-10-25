import { MoverEtapa, type TarefasAfetadas } from '@fir/contracts'
import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from '@nestjs/common'
import { Exige } from '../autorizacao/autorizacao.guard'
import type { RequisicaoComContexto } from '../comum/contexto'
import { autorDe } from '../tarefas/leitura'
import { primeiroErro } from '../tarefas/tarefas.controller'
import { JornadaService } from './jornada.service'

/**
 * A jornada exige `jornada` — **divergência consciente do protótipo**, que não
 * exige nada: lá `visivel(t)` libera qualquer tarefa com `pacienteId` para
 * qualquer usuário, e `moverEtapa` não checa permissão nenhuma. O resultado é a
 * enfermagem registrando orçamento de R$ 9.000.
 *
 * A chave `jornada` já existe na matriz (`PERMS`) com exatamente esta
 * descrição — *"Funil e situação de agendamentos, orçamentos e fechamentos"* —
 * e Recepção, Comercial e Supervisão já a têm: ninguém perde acesso ao que usa
 * hoje.
 *
 * `fechar` exige TAMBÉM `receber`, declarado no handler (Task 7): a rota que
 * cria dinheiro é gated, sem exceção. Até lá, `@Exige` da classe basta.
 */
@Controller('v1/tarefas')
@Exige('jornada')
export class JornadaController {
  constructor(@Inject(JornadaService) private readonly jornada: JornadaService) {}

  @Post(':id/jornada')
  @HttpCode(HttpStatus.OK)
  async mover(
    @Req() req: RequisicaoComContexto,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() corpo: unknown,
  ): Promise<TarefasAfetadas> {
    const dados = MoverEtapa.safeParse(corpo)
    // A mensagem do Zod SEM o valor que a causou: o corpo carrega `nota`, que
    // é texto livre da recepção e pode conter nome de paciente (regra 21).
    if (!dados.success) throw new BadRequestException(primeiroErro(dados.error))
    // `!` seguro: `SessaoGuard` é global e esta rota não é `@Publico()`.
    const c = req.contexto!
    return this.jornada.mover(c.clinicaId, c.ator, c.clinicaFuso, autorDe(c), id, dados.data)
  }
}
