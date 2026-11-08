import {
  CriarIndicadorDoClienteEntrada,
  CriarMetaDoClienteEntrada,
  EditarMetaDoClienteEntrada,
  type IndicadoresDoClienteSaida,
  LancamentoSemanalDeMetasEntrada,
  type LancamentoSemanalDeMetasSaida,
  LancarSemanaDosIndicadoresEntrada,
  type MetaDoClienteSalvaSaida,
  type MetasDoClienteSaida,
  type PainelDeMetasSaida,
  type SemanaDosIndicadoresLancadaSaida,
  Uuid,
  type IndicadorDoCliente,
} from '@fir/contracts'
import { Body, Controller, Get, HttpCode, HttpException, HttpStatus, Inject, Param, Patch, Post, Query, Req } from '@nestjs/common'
import type { RequisicaoComCarteira } from '../contexto-da-carteira'
import { SoUsuarioDeGestao } from '../so-usuario-de-gestao.decorator'
import { IndicadoresDoClienteService } from './indicadores-do-cliente.service'
import { EntradaInvalidaNaMeta, NaoEncontradoNaMeta, SemPermissaoDeValoresNaMeta } from './metas-comum'
import { MetasDoClienteService } from './metas-do-cliente.service'

const recusa = (status: HttpStatus, codigo: string, message: string): HttpException =>
  new HttpException({ statusCode: status, codigo, message }, status)

type Esquema<T> = {
  safeParse(corpo: unknown):
    | { success: true; data: T }
    | { success: false; error: { issues: ReadonlyArray<{ path: ReadonlyArray<string | number> }> } }
}

/** Valida na borda (Zod de `@fir/contracts`); o erro não ecoa o valor recebido (A-21). */
function validar<T>(schema: Esquema<T>, corpo: unknown): T {
  const r = schema.safeParse(corpo)
  if (r.success) return r.data
  const campos = r.error.issues.map((i) => i.path.join('.') || 'corpo')
  throw recusa(HttpStatus.BAD_REQUEST, 'ENTRADA_INVALIDA', `Revise: ${campos.join(', ')}.`)
}

const id = (bruto: string): string => {
  if (!Uuid.safeParse(bruto).success) throw recusa(HttpStatus.NOT_FOUND, 'NAO_ENCONTRADO', 'Não encontrado.')
  return bruto
}

/** O ponto único de tradução erro de serviço → status. */
async function traduzir<T>(f: () => Promise<T>): Promise<T> {
  try {
    return await f()
  } catch (e) {
    if (e instanceof NaoEncontradoNaMeta) throw recusa(HttpStatus.NOT_FOUND, 'NAO_ENCONTRADO', 'Não encontrado.')
    if (e instanceof EntradaInvalidaNaMeta) throw recusa(HttpStatus.BAD_REQUEST, e.codigo, e.message)
    if (e instanceof SemPermissaoDeValoresNaMeta) {
      throw recusa(HttpStatus.FORBIDDEN, 'SEM_PERMISSAO_DE_VALORES', 'Valor em R$ exige a permissão de ver valores.')
    }
    throw e
  }
}

/**
 * **G8 2B — metas e indicadores da carteira** (M1–M4, M6, V10).
 *
 * O painel (`GET v1/carteira/metas/painel`) e as rotas de UM cliente
 * (`v1/carteira/clientes/:id/...`). As rotas antigas de G3
 * (`v1/carteira/metas`, `v1/carteira/indicadores`) continuam servindo a ficha
 * de hoje, agora com a referência na segunda-feira e A-6 aplicados.
 */
@SoUsuarioDeGestao()
@Controller('v1/carteira')
export class MetasDoClienteController {
  constructor(
    @Inject(MetasDoClienteService) private readonly metas: MetasDoClienteService,
    @Inject(IndicadoresDoClienteService) private readonly indicadores: IndicadoresDoClienteService,
  ) {}

  @Get('metas/painel')
  painel(@Query('responsavel') responsavel: string | undefined, @Req() req: RequisicaoComCarteira): Promise<PainelDeMetasSaida> {
    const filtro = responsavel && Uuid.safeParse(responsavel).success ? responsavel : null
    return traduzir(() => this.metas.painel(req.carteira!.usuarioDeGestao, filtro))
  }

  @Get('clientes/:id/metas')
  doCliente(@Param('id') clienteId: string, @Req() req: RequisicaoComCarteira): Promise<MetasDoClienteSaida> {
    return traduzir(() => this.metas.doCliente(req.carteira!.usuarioDeGestao, id(clienteId)))
  }

  @Post('clientes/:id/metas')
  async criar(@Param('id') clienteId: string, @Body() corpo: unknown, @Req() req: RequisicaoComCarteira): Promise<MetaDoClienteSalvaSaida> {
    const dados = validar(CriarMetaDoClienteEntrada, corpo)
    return { metaSalva: await traduzir(() => this.metas.criar(req.carteira!.usuarioDeGestao, id(clienteId), dados)) }
  }

  @Post('clientes/:id/metas/lancamento-semanal')
  @HttpCode(200)
  lancarSemana(
    @Param('id') clienteId: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoComCarteira,
  ): Promise<LancamentoSemanalDeMetasSaida> {
    const dados = validar(LancamentoSemanalDeMetasEntrada, corpo)
    return traduzir(() => this.metas.lancarSemana(req.carteira!.usuarioDeGestao, id(clienteId), dados))
  }

  @Patch('clientes/:id/metas/:metaId')
  async editar(
    @Param('id') clienteId: string,
    @Param('metaId') metaId: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoComCarteira,
  ): Promise<MetaDoClienteSalvaSaida> {
    const dados = validar(EditarMetaDoClienteEntrada, corpo)
    return { metaSalva: await traduzir(() => this.metas.editar(req.carteira!.usuarioDeGestao, id(clienteId), id(metaId), dados)) }
  }

  @Post('clientes/:id/metas/:metaId/excluir')
  @HttpCode(204)
  async excluir(@Param('id') clienteId: string, @Param('metaId') metaId: string, @Req() req: RequisicaoComCarteira): Promise<void> {
    await traduzir(() => this.metas.excluir(req.carteira!.usuarioDeGestao, id(clienteId), id(metaId)))
  }

  @Get('clientes/:id/indicadores')
  indicadoresDoCliente(@Param('id') clienteId: string, @Req() req: RequisicaoComCarteira): Promise<IndicadoresDoClienteSaida> {
    return traduzir(() => this.indicadores.listar(req.carteira!.usuarioDeGestao, id(clienteId)))
  }

  @Post('clientes/:id/indicadores')
  async criarIndicador(
    @Param('id') clienteId: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoComCarteira,
  ): Promise<{ indicador: IndicadorDoCliente }> {
    const dados = validar(CriarIndicadorDoClienteEntrada, corpo)
    return { indicador: await traduzir(() => this.indicadores.criar(req.carteira!.usuarioDeGestao, id(clienteId), dados)) }
  }

  @Post('clientes/:id/lancamentos')
  @HttpCode(200)
  lancarIndicadores(
    @Param('id') clienteId: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoComCarteira,
  ): Promise<SemanaDosIndicadoresLancadaSaida> {
    const dados = validar(LancarSemanaDosIndicadoresEntrada, corpo)
    return traduzir(() => this.indicadores.lancarSemana(req.carteira!.usuarioDeGestao, id(clienteId), dados))
  }
}
