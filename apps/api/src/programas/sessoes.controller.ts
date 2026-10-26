import { ConcluirSessao, type TarefasAfetadas } from '@fir/contracts'
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
import { SessoesService } from './sessoes.service'

/**
 * A SESSÃO TEM ROTA PRÓPRIA (decisão P-5), e a genérica recusa.
 *
 * `@Exige('programas')` na classe: é a enfermagem quem conclui a aplicação, e
 * ela não tem `receber`. Como no `POST /v1/programas`, `receber` é cobrado **no
 * corpo** — quando ele traz dinheiro —, e a cobrança vem ANTES de qualquer
 * escrita: 403 com o banco intocado, nunca um rollback que depende de a
 * transação ter sido aberta corretamente.
 */
@Controller('v1/programas/sessoes')
@Exige('programas')
export class SessoesController {
  // `@Inject` explícito: o esbuild não emite `design:paramtypes`.
  constructor(@Inject(SessoesService) private readonly sessoes: SessoesService) {}

  //  e não : nada é CRIADO — a sessão muda de estado. É o mesmo
  // código de , e a tela trata as duas iguais.
  @Post(':id/concluir')
  @HttpCode(HttpStatus.OK)
  async concluir(
    @Req() req: RequisicaoComContexto,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() corpo: unknown,
  ): Promise<TarefasAfetadas> {
    const dados = ConcluirSessao.safeParse(corpo)
    if (!dados.success) throw new BadRequestException(primeiroErro(dados.error))
    // `!` seguro: `SessaoGuard` é global e esta rota não é `@Publico()`.
    const c = req.contexto!

    if (dados.data.pagamento !== undefined && !c.pode('receber')) {
      throw new ForbiddenException(
        'Para lançar o pagamento da sessão você precisa da permissão de recebimentos. ' +
          'Conclua a sessão sem pagamento e registre o dinheiro pela tela Recebimentos.',
      )
    }

    return this.sessoes.concluir(
      c.clinicaId,
      c.ator,
      c.clinicaFuso,
      autorDe(c),
      id,
      dados.data,
    )
  }

  @Post(':id/reabrir')
  @HttpCode(HttpStatus.OK)
  async reabrir(
    @Req() req: RequisicaoComContexto,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<TarefasAfetadas> {
    const c = req.contexto!
    return this.sessoes.reabrir(c.clinicaId, c.ator, c.clinicaFuso, autorDe(c), id)
  }
}
