import {
  Cancelar,
  Concluir,
  ConsultaDeTarefas,
  CriarTarefa,
  EditarTarefa,
  type ExclusaoDeTarefa,
  ExcluirTarefa,
  type ListaDeTarefas,
  type TarefaParaEditar,
  type TarefasAfetadas,
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
import type { RequisicaoComContexto } from '../comum/contexto'
import { primeiroErro } from '../comum/primeiro-erro'
import { ConclusaoService } from './conclusao.service'
import { ConsultaDeTarefasService } from './consulta.service'
import { EdicaoDeTarefasService } from './edicao.service'
import { autorDe, exigirEscopo, leitorDe } from './leitura'
import { TarefasService } from './tarefas.service'

/**
 * Tarefas — SEM `@Exige`.
 *
 * Hoje, Tarefas e Nova tarefa são de todos (`menu.ts`, `perm: null`): numa
 * clínica de quatro pessoas, exigir permissão para criar a própria tarefa
 * seria exigir permissão para trabalhar. O que é controlado por permissão é o
 * ALCANCE — `escopo=equipe`, cancelar o que outra pessoa pediu — e isso é
 * decidido por tarefa, em `packages/domain/src/tarefa.ts`, não por rota.
 *
 * `@Publico()` NÃO aparece aqui: o `SessaoGuard` global já protege, e é
 * justamente por ele ser global que esquecer um decorador significa rota
 * protegida.
 */
@Controller('v1/tarefas')
export class TarefasController {
  // `@Inject` explícito: o esbuild não emite `design:paramtypes`.
  constructor(
    @Inject(TarefasService) private readonly tarefas: TarefasService,
    @Inject(ConclusaoService) private readonly conclusao: ConclusaoService,
    @Inject(EdicaoDeTarefasService) private readonly edicao: EdicaoDeTarefasService,
    @Inject(ConsultaDeTarefasService) private readonly consulta: ConsultaDeTarefasService,
  ) {}

  @Get()
  async listar(
    @Req() req: RequisicaoComContexto,
    @Query() consulta: unknown,
  ): Promise<ListaDeTarefas> {
    const dados = ConsultaDeTarefas.safeParse(consulta)
    if (!dados.success) throw new BadRequestException('Confira os filtros da busca.')
    const c = req.contexto!
    exigirEscopo(c, dados.data.escopo, [dados.data.responsavelId, dados.data.solicitanteId])
    return this.consulta.listar(c.clinicaId, c.ator, c.clinicaFuso, leitorDe(c), dados.data)
  }

  /**
   * UMA tarefa, na forma completa — o que o painel de edição precisa.
   *
   * Vive aqui, e não num `pacienteId` a mais no filtro da lista, porque a
   * lista é recortada por ESCOPO (`meu`, `solicitei`, `equipe`) e a ficha do
   * paciente mostra as tarefas dele independentemente de quem é o
   * responsável. Um filtro de paciente na lista responderia menos do que a
   * ficha já mostra, e o botão de editar ficaria cego justamente na tarefa de
   * outra pessoa — que é a que mais se precisa corrigir.
   */
  @Get(':id')
  async uma(
    @Req() req: RequisicaoComContexto,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<TarefaParaEditar> {
    const c = req.contexto!
    return this.consulta.uma(c.clinicaId, c.ator, c.clinicaFuso, autorDe(c), id)
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async criar(
    @Req() req: RequisicaoComContexto,
    @Body() corpo: unknown,
  ): Promise<TarefasAfetadas> {
    const dados = CriarTarefa.safeParse(corpo)
    if (!dados.success) throw new BadRequestException(primeiroErro(dados.error))
    // `!` seguro: `SessaoGuard` é global e esta rota não é `@Publico()`.
    const c = req.contexto!
    // `autorDe(c).id` e não `c.ator`: `tarefas.responsavel_id` é NOT NULL e
    // guarda uma PESSOA. A sessão de suporte do painel é recusada aqui — ver
    // `autorDe` em `leitura.ts` (D-13).
    return this.tarefas.criar(c.clinicaId, c.ator, c.clinicaFuso, autorDe(c).id, dados.data)
  }

  @Post(':id/concluir')
  @HttpCode(HttpStatus.OK)
  async concluir(
    @Req() req: RequisicaoComContexto,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() corpo: unknown,
  ): Promise<TarefasAfetadas> {
    const dados = Concluir.safeParse(corpo)
    if (!dados.success) throw new BadRequestException(primeiroErro(dados.error))
    const c = req.contexto!
    return this.conclusao.concluir(c.clinicaId, c.ator, c.clinicaFuso, autorDe(c), id, dados.data)
  }

  @Post(':id/cancelar')
  @HttpCode(HttpStatus.OK)
  async cancelar(
    @Req() req: RequisicaoComContexto,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() corpo: unknown,
  ): Promise<TarefasAfetadas> {
    const dados = Cancelar.safeParse(corpo)
    if (!dados.success) throw new BadRequestException(primeiroErro(dados.error))
    const c = req.contexto!
    return this.conclusao.cancelar(c.clinicaId, c.ator, c.clinicaFuso, autorDe(c), id, dados.data)
  }

  @Post(':id/reabrir')
  @HttpCode(HttpStatus.OK)
  async reabrir(
    @Req() req: RequisicaoComContexto,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<TarefasAfetadas> {
    const c = req.contexto!
    return this.conclusao.reabrir(c.clinicaId, c.ator, c.clinicaFuso, autorDe(c), id)
  }

  @Patch(':id')
  async editar(
    @Req() req: RequisicaoComContexto,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() corpo: unknown,
  ): Promise<TarefasAfetadas> {
    const dados = EditarTarefa.safeParse(corpo)
    if (!dados.success) throw new BadRequestException(primeiroErro(dados.error))
    const c = req.contexto!
    return this.edicao.editar(c.clinicaId, c.ator, c.clinicaFuso, autorDe(c), id, dados.data)
  }

  @Delete(':id')
  async excluir(
    @Req() req: RequisicaoComContexto,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() consulta: unknown,
  ): Promise<ExclusaoDeTarefa> {
    const dados = ExcluirTarefa.safeParse(consulta)
    if (!dados.success) throw new BadRequestException(primeiroErro(dados.error))
    const c = req.contexto!
    return this.edicao.excluir(c.clinicaId, c.ator, autorDe(c), id, dados.data.serie)
  }
}

/**
 * `primeiroErro` mora em `comum/primeiro-erro.ts`. Reexportado daqui para os
 * controladores que já o importavam deste arquivo continuarem a compilar;
 * código novo importa de `comum/`.
 */
export { primeiroErro }
