import {
  ConsultaDeRecebimentos,
  type ListaDeRecebimentos,
  type RecebimentoNaLista,
  RegistrarRecebimento,
} from '@fir/contracts'
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common'
import { Exige } from '../autorizacao/autorizacao.guard'
import type { RequisicaoComContexto } from '../comum/contexto'
import { primeiroErro } from '../tarefas/tarefas.controller'
import { RecebimentosService } from './recebimentos.service'

/**
 * Recebimentos — a **única porta** para dinheiro avulso.
 *
 * `@Exige('receber')` na CLASSE: as três rotas mexem na mesma coisa, e uma
 * exigência por handler é uma exigência que o quarto handler esquece. O
 * `AutorizacaoGuard` resolve a chave por `temPerm`, a mesma função da tela —
 * nenhum `if` aqui reimplementa dependência de permissão.
 */
@Controller('v1/recebimentos')
@Exige('receber')
export class RecebimentosController {
  // `@Inject` explícito: o esbuild não emite `design:paramtypes`.
  constructor(@Inject(RecebimentosService) private readonly recebimentos: RecebimentosService) {}

  @Get()
  async listar(
    @Req() req: RequisicaoComContexto,
    @Query() consulta: unknown,
  ): Promise<ListaDeRecebimentos> {
    const dados = ConsultaDeRecebimentos.safeParse(consulta)
    if (!dados.success) throw new BadRequestException(primeiroErro(dados.error))
    // `!` seguro: `SessaoGuard` é global e esta rota não é `@Publico()`.
    const c = req.contexto!
    const itens = await this.recebimentos.listar(
      { clinicaId: c.clinicaId, ator: c.ator, fuso: c.clinicaFuso },
      dados.data,
    )
    return { itens: [...itens] }
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async registrar(
    @Req() req: RequisicaoComContexto,
    @Body() corpo: unknown,
  ): Promise<RecebimentoNaLista> {
    const dados = RegistrarRecebimento.safeParse(corpo)
    if (!dados.success) throw new BadRequestException(primeiroErro(dados.error))
    const c = req.contexto!
    return this.recebimentos.registrar(
      { clinicaId: c.clinicaId, ator: c.ator, fuso: c.clinicaFuso },
      dados.data,
    )
  }

  /** ESTORNA. Nunca apaga — ver `recebimentos.service.ts`. */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async estornar(
    @Req() req: RequisicaoComContexto,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    const c = req.contexto!
    await this.recebimentos.estornar(
      { clinicaId: c.clinicaId, ator: c.ator, fuso: c.clinicaFuso },
      id,
    )
  }
}
