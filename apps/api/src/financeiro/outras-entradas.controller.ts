import {
  type CategoriaDeEntradaNaLista,
  ConsultaDeOutrasEntradas,
  CriarCategoriaDeEntrada,
  EditarCategoriaDeEntrada,
  LancarOutraEntrada,
  type ListaDeCategoriasDeEntrada,
  type ListaDeOutrasEntradas,
  type OutraEntradaNaLista,
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
  UseGuards,
} from '@nestjs/common'
import { Exige } from '../autorizacao/autorizacao.guard'
import type { ContextoDaRequisicao, RequisicaoComContexto } from '../comum/contexto'
import { primeiroErro } from '../tarefas/tarefas.controller'
import { LimiteDeEscritaDeEntradasGuard } from './limite-de-escrita-de-entradas.guard'
import { OutrasEntradasService } from './outras-entradas.service'

const ctxDe = (req: RequisicaoComContexto) => {
  // `!` seguro: `SessaoGuard` é global e estas rotas não são `@Publico()`.
  const c = req.contexto as ContextoDaRequisicao
  return { clinicaId: c.clinicaId, ator: c.ator, fuso: c.clinicaFuso }
}

/**
 * Outras entradas — dinheiro que entrou e NÃO é de paciente.
 *
 * `@Exige('receber')` na CLASSE: lançar, listar e estornar são a mesma
 * permissão (decidida no gate, sem chave nova). Ver o valor é `valores`, e quem
 * apaga o campo é a redação central — nenhum `if` aqui decide isso.
 */
@Controller('v1/outras-entradas')
@Exige('receber')
export class OutrasEntradasController {
  // `@Inject` explícito: o esbuild não emite `design:paramtypes`.
  constructor(@Inject(OutrasEntradasService) private readonly entradas: OutrasEntradasService) {}

  @Get()
  async listar(
    @Req() req: RequisicaoComContexto,
    @Query() consulta: unknown,
  ): Promise<ListaDeOutrasEntradas> {
    const dados = ConsultaDeOutrasEntradas.safeParse(consulta)
    if (!dados.success) throw new BadRequestException(primeiroErro(dados.error))
    return { itens: [...(await this.entradas.listar(ctxDe(req), dados.data))] }
  }

  @UseGuards(LimiteDeEscritaDeEntradasGuard)
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async lancar(
    @Req() req: RequisicaoComContexto,
    @Body() corpo: unknown,
  ): Promise<OutraEntradaNaLista> {
    const dados = LancarOutraEntrada.safeParse(corpo)
    if (!dados.success) throw new BadRequestException(primeiroErro(dados.error))
    return this.entradas.lancar(ctxDe(req), dados.data)
  }

  /** ESTORNA. Nunca apaga — ver `outras-entradas.service.ts`. */
  @UseGuards(LimiteDeEscritaDeEntradasGuard)
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async estornar(
    @Req() req: RequisicaoComContexto,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.entradas.estornar(ctxDe(req), id)
  }
}

/**
 * As categorias de entrada. Ler é `receber` (quem lança precisa escolher);
 * cadastrar e (des)ativar é `contas.gerir`, como as categorias de despesa.
 */
@Controller('v1/categorias-de-entrada')
@Exige('receber')
export class CategoriasDeEntradaController {
  // `@Inject` explícito: o esbuild não emite `design:paramtypes`.
  constructor(@Inject(OutrasEntradasService) private readonly entradas: OutrasEntradasService) {}

  @Get()
  async listar(@Req() req: RequisicaoComContexto): Promise<ListaDeCategoriasDeEntrada> {
    return { itens: [...(await this.entradas.listarCategorias(ctxDe(req)))] }
  }

  @UseGuards(LimiteDeEscritaDeEntradasGuard)
  @Post()
  @Exige('contas.gerir')
  @HttpCode(HttpStatus.CREATED)
  async criar(
    @Req() req: RequisicaoComContexto,
    @Body() corpo: unknown,
  ): Promise<CategoriaDeEntradaNaLista> {
    const dados = CriarCategoriaDeEntrada.safeParse(corpo)
    if (!dados.success) throw new BadRequestException(primeiroErro(dados.error))
    return this.entradas.criarCategoria(ctxDe(req), dados.data)
  }

  @UseGuards(LimiteDeEscritaDeEntradasGuard)
  @Patch(':id')
  @Exige('contas.gerir')
  async editar(
    @Req() req: RequisicaoComContexto,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() corpo: unknown,
  ): Promise<CategoriaDeEntradaNaLista> {
    const dados = EditarCategoriaDeEntrada.safeParse(corpo)
    if (!dados.success) throw new BadRequestException(primeiroErro(dados.error))
    return this.entradas.editarCategoria(ctxDe(req), id, dados.data)
  }
}
