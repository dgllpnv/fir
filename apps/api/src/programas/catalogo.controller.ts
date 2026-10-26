import {
  EditarProcedimento,
  type ListaDeProcedimentos,
  type ProcedimentoNaLista,
  SalvarProcedimento,
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
  Req,
} from '@nestjs/common'
import { Exige } from '../autorizacao/autorizacao.guard'
import type { RequisicaoComContexto } from '../comum/contexto'
import { primeiroErro } from '../tarefas/tarefas.controller'
import { CatalogoService } from './catalogo.service'

/**
 * O CATÁLOGO — ler com `programas`, escrever com `config`.
 *
 * O `@Exige` da classe é a LEITURA; cada escrita o sobrepõe com `config`
 * (`getAllAndOverride`: o do handler vence o da classe). Quem monta o
 * programa precisa ver o catálogo; quem o edita está mexendo numa
 * configuração da clínica — é a divisão que o protótipo já faz
 * (`VIEW_PERM.catalogo = 'config'`, e a lista chega pelo `carregar`).
 */
@Controller('v1/procedimentos')
@Exige('programas')
export class CatalogoController {
  // `@Inject` explícito: o esbuild não emite `design:paramtypes`.
  constructor(@Inject(CatalogoService) private readonly catalogo: CatalogoService) {}

  @Get()
  async listar(@Req() req: RequisicaoComContexto): Promise<ListaDeProcedimentos> {
    // `!` seguro: `SessaoGuard` é global e esta rota não é `@Publico()`.
    const c = req.contexto!
    return this.catalogo.listar({ clinicaId: c.clinicaId, ator: c.ator })
  }

  @Post()
  @Exige('config')
  @HttpCode(HttpStatus.CREATED)
  async criar(
    @Req() req: RequisicaoComContexto,
    @Body() corpo: unknown,
  ): Promise<ProcedimentoNaLista> {
    const dados = SalvarProcedimento.safeParse(corpo)
    if (!dados.success) throw new BadRequestException(primeiroErro(dados.error))
    const c = req.contexto!
    return this.catalogo.criar({ clinicaId: c.clinicaId, ator: c.ator }, dados.data)
  }

  @Patch(':id')
  @Exige('config')
  async editar(
    @Req() req: RequisicaoComContexto,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() corpo: unknown,
  ): Promise<ProcedimentoNaLista> {
    const dados = EditarProcedimento.safeParse(corpo)
    if (!dados.success) throw new BadRequestException(primeiroErro(dados.error))
    const c = req.contexto!
    return this.catalogo.editar({ clinicaId: c.clinicaId, ator: c.ator }, id, dados.data)
  }

  @Delete(':id')
  @Exige('config')
  @HttpCode(HttpStatus.NO_CONTENT)
  async excluir(
    @Req() req: RequisicaoComContexto,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    const c = req.contexto!
    await this.catalogo.excluir({ clinicaId: c.clinicaId, ator: c.ator }, id)
  }
}
