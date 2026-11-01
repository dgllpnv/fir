import { EditarUnidade, SalvarUnidade, type UnidadeNaLista } from '@fir/contracts'
import {
  BadRequestException,
  Body,
  Controller,
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
import { UnidadesService } from './unidades.service'

/**
 * A ESCRITA de unidade — `salvarUnidade`, a última linha ⬜ do épico 2.
 *
 * Controlador próprio, com `@Exige('config')` **na classe**, e não um par de
 * rotas em `ClinicaController`: lá a classe não tem `@Exige` de propósito (as
 * listas de apoio são de todos), e uma rota de escrita pendurada ali nasceria
 * aberta. É o mesmo cuidado que `busca.controller.ts` já registra.
 *
 * A LEITURA continua em `GET /v1/unidades`, sem permissão: escolher a unidade
 * de um atendimento é parte de atender.
 */
@Controller('v1/unidades')
@Exige('config')
export class UnidadesController {
  // `@Inject` explícito: o esbuild não emite `design:paramtypes`.
  constructor(@Inject(UnidadesService) private readonly unidades: UnidadesService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async criar(
    @Body() corpo: unknown,
    @Req() req: RequisicaoComContexto,
  ): Promise<UnidadeNaLista> {
    const dados = SalvarUnidade.safeParse(corpo)
    if (!dados.success) throw new BadRequestException(primeiroErro(dados.error))
    // `!` seguro: `SessaoGuard` é global e esta rota não é `@Publico()`.
    const c = req.contexto!
    return this.unidades.criar({ clinicaId: c.clinicaId, ator: c.ator }, dados.data)
  }

  @Patch(':id')
  async editar(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoComContexto,
  ): Promise<UnidadeNaLista> {
    const dados = EditarUnidade.safeParse(corpo)
    if (!dados.success) throw new BadRequestException(primeiroErro(dados.error))
    const c = req.contexto!
    return this.unidades.editar({ clinicaId: c.clinicaId, ator: c.ator }, id, dados.data)
  }
}
