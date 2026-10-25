import {
  ConsultaDeContas,
  type ContaNaLista,
  type ListaDeContas,
  PagarConta,
  type ResultadoDoPagamento,
  SalvarConta,
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
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common'
import { Exige } from '../autorizacao/autorizacao.guard'
import type { ContextoDaRequisicao, RequisicaoComContexto } from '../comum/contexto'
import { primeiroErro } from '../tarefas/tarefas.controller'
import { ContasService } from './contas.service'

/**
 * Contas a pagar.
 *
 * **`contas` e `contas.gerir` são dois ALCANCES, não dois níveis.** Com
 * `contas`, a pessoa vê e paga **as dela**; com `contas.gerir`, vê e paga
 * **todas**, e cadastra. O protótipo faz exatamente isso
 * (`if (!mePode('contas.gerir') && c.responsavelId !== me.id)`), e a diferença
 * importa: a conta do pró-labore não aparece para a recepção.
 *
 * `@Exige('contas')` na CLASSE; `@Exige('contas.gerir')` sobrescreve nas três
 * ações que mudam o cadastro. `getAllAndOverride` no guard faz o do handler
 * vencer o da classe.
 */
@Controller('v1/contas')
@Exige('contas')
export class ContasController {
  // `@Inject` explícito: o esbuild não emite `design:paramtypes`.
  constructor(@Inject(ContasService) private readonly contas: ContasService) {}

  @Get()
  async listar(
    @Req() req: RequisicaoComContexto,
    @Query() consulta: unknown,
  ): Promise<ListaDeContas> {
    const dados = ConsultaDeContas.safeParse(consulta)
    if (!dados.success) throw new BadRequestException(primeiroErro(dados.error))
    const itens = await this.contas.listar(ctxDe(req), dados.data)
    return { itens: [...itens] }
  }

  @Post()
  @Exige('contas.gerir')
  @HttpCode(HttpStatus.CREATED)
  async criar(@Req() req: RequisicaoComContexto, @Body() corpo: unknown): Promise<ContaNaLista> {
    const dados = SalvarConta.safeParse(corpo)
    if (!dados.success) throw new BadRequestException(primeiroErro(dados.error))
    return this.contas.criar(ctxDe(req), dados.data)
  }

  @Patch(':id')
  @Exige('contas.gerir')
  async editar(
    @Req() req: RequisicaoComContexto,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() corpo: unknown,
  ): Promise<ContaNaLista> {
    const dados = SalvarConta.safeParse(corpo)
    if (!dados.success) throw new BadRequestException(primeiroErro(dados.error))
    return this.contas.editar(ctxDe(req), id, dados.data)
  }

  /** Soft delete. Conta PAGA é 409 — ver `contas.service.ts`. */
  @Delete(':id')
  @Exige('contas.gerir')
  @HttpCode(HttpStatus.NO_CONTENT)
  async excluir(
    @Req() req: RequisicaoComContexto,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.contas.excluir(ctxDe(req), id)
  }

  /**
   * Pagar exige só `contas` — mais ser o DONO da conta, o que o serviço
   * resolve pelo alcance (404 para a conta de outra pessoa).
   */
  @Post(':id/pagar')
  async pagar(
    @Req() req: RequisicaoComContexto,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() corpo: unknown,
  ): Promise<ResultadoDoPagamento> {
    const dados = PagarConta.safeParse(corpo)
    if (!dados.success) throw new BadRequestException(primeiroErro(dados.error))
    return this.contas.pagar(ctxDe(req), id, dados.data)
  }
}

/**
 * O contexto do serviço, com o ALCANCE já resolvido por `temPerm`.
 *
 * `c.pode('contas.gerir')` é a mesma função do servidor e da tela, e a
 * dependência entre chaves vive na tabela `PERMS` — nenhum `if` aqui a
 * reimplementa.
 */
function ctxDe(req: RequisicaoComContexto): {
  clinicaId: ContextoDaRequisicao['clinicaId']
  ator: ContextoDaRequisicao['ator']
  fuso: string
  gerir: boolean
} {
  // `!` seguro: `SessaoGuard` é global e esta rota não é `@Publico()`.
  const c = req.contexto!
  return {
    clinicaId: c.clinicaId,
    ator: c.ator,
    fuso: c.clinicaFuso,
    gerir: c.pode('contas.gerir'),
  }
}
