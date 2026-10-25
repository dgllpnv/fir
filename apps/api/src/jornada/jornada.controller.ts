import { MoverEtapa, type TarefasAfetadas } from '@fir/contracts'
import type { ChaveDePermissao } from '@fir/domain'
import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
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
 * `fechar` exige TAMBÉM `receber` — ver `PERMISSAO_EXTRA`.
 */

/**
 * A permissão que uma ação exige **além** de `jornada`. Uma tabela, não um `if`.
 *
 * `@Exige` no handler não serve: é UMA rota para treze ações, e o decorador
 * vale para todas. Exigir `receber` no handler tiraria `confirmar` e `noshow`
 * da recepção — que é quem os usa cinquenta vezes por dia.
 *
 * Como tabela, a pergunta "quais ações pedem mais que `jornada`?" tem uma
 * resposta legível num lugar só, e acrescentar a próxima é uma linha. Como
 * `if`, a segunda estaria noutro arquivo em três meses.
 *
 * `fechar` cria `Recebimento`, e a rota que cria dinheiro é gated, sem exceção
 * (decisão D-7).
 */
const PERMISSAO_EXTRA: Partial<Record<MoverEtapa['acao'], ChaveDePermissao>> = {
  fechar: 'receber',
}
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
    const extra = PERMISSAO_EXTRA[dados.data.acao]
    // Antes de qualquer escrita, e com a MESMA frase do guard: a lista de
    // chaves que faltam a quem não as tem é um mapa do que existe atrás da
    // porta.
    if (extra !== undefined && !c.pode(extra)) {
      throw new ForbiddenException('Sem acesso a esta ação.')
    }
    return this.jornada.mover(c.clinicaId, c.ator, c.clinicaFuso, autorDe(c), id, dados.data)
  }
}
