import {
  AssumirTarefa,
  Cancelar,
  Concluir,
  ConsultaDeTarefas,
  CorpoComMotivo,
  CriarTarefa,
  EditarTarefa,
  type ExclusaoDeTarefa,
  ExcluirTarefa,
  type FluxoDaTarefa,
  type ListaDeTarefas,
  type PrevisaoDeExclusao,
  type TarefaParaEditar,
  type TarefasAfetadas,
  TransferirTarefa,
} from '@fir/contracts'
import { ehMarcadorDeLancamento } from '@fir/domain'
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
  UnprocessableEntityException,
  UseGuards,
} from '@nestjs/common'
import { DadoSensivel } from '../auditoria/acesso.decorator'
import type { RequisicaoComContexto } from '../comum/contexto'
import { primeiroErro } from '../comum/primeiro-erro'
import { ConclusaoService } from './conclusao.service'
import { ConsultaDeTarefasService } from './consulta.service'
import { EdicaoDeTarefasService } from './edicao.service'
import { FluxoService } from './fluxo.service'
import { LimiteDeEscritaDoFluxoGuard } from './limite-de-escrita.guard'
import { autorDe, exigirEscopo, leitorDe } from './leitura'
import { TarefasService } from './tarefas.service'
import { TransferenciaService } from './transferencia.service'

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
/**
 * **O marcador `lancamento-kpi:` é só do servidor** (appsec C27, spec I-30).
 *
 * A tarefa com esse marcador é a que `PUT /v1/indicadores/kpis/:id/
 * lancamentos/:referencia` conclui — a exceção nomeada da matriz de acesso.
 * O `.strict()` de `CriarTarefa` já recusaria qualquer `marcador` com 400; o
 * 422 próprio, ANTES do parse, diz que esta tentativa não é um engano de
 * formulário, e não depende de o contrato nunca ganhar o campo.
 */
function recusarMarcadorDeLancamento(corpo: unknown): void {
  if (typeof corpo === 'object' && corpo !== null && 'marcador' in corpo && ehMarcadorDeLancamento(corpo.marcador)) {
    throw new UnprocessableEntityException('Este marcador é reservado ao sistema.')
  }
}

@Controller('v1/tarefas')
export class TarefasController {
  // `@Inject` explícito: o esbuild não emite `design:paramtypes`.
  constructor(
    @Inject(TarefasService) private readonly tarefas: TarefasService,
    @Inject(ConclusaoService) private readonly conclusao: ConclusaoService,
    @Inject(EdicaoDeTarefasService) private readonly edicao: EdicaoDeTarefasService,
    @Inject(ConsultaDeTarefasService) private readonly consulta: ConsultaDeTarefasService,
    @Inject(TransferenciaService) private readonly transferencia: TransferenciaService,
    @Inject(FluxoService) private readonly fluxo: FluxoService,
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
    recusarMarcadorDeLancamento(corpo)
    const dados = CriarTarefa.safeParse(corpo)
    if (!dados.success) throw new BadRequestException(primeiroErro(dados.error))
    // `!` seguro: `SessaoGuard` é global e esta rota não é `@Publico()`.
    const c = req.contexto!
    // `autorDe(c).id` e não `c.ator`: `tarefas.responsavel_id` é NOT NULL e
    // guarda uma PESSOA. A sessão de suporte do painel é recusada aqui — ver
    // `autorDe` em `leitura.ts` (D-13).
    const autor = autorDe(c)
    return this.tarefas.criar(
      c.clinicaId,
      c.ator,
      c.clinicaFuso,
      autor.id,
      dados.data,
      autor.podeJornada,
      autor.podeEquipe,
    )
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

  /**
   * O membro do grupo fixa a tarefa em si. O perdedor da corrida recebe 409.
   * Sem `@Exige`: quem pode é decidido por tarefa (membro do grupo, ou
   * `tarefas.equipe`) e conferido no banco na mesma transação.
   */
  @Post(':id/assumir')
  @UseGuards(LimiteDeEscritaDoFluxoGuard)
  @HttpCode(HttpStatus.OK)
  async assumir(
    @Req() req: RequisicaoComContexto,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() corpo: unknown,
  ): Promise<TarefasAfetadas> {
    const dados = AssumirTarefa.safeParse(corpo ?? {})
    if (!dados.success) throw new BadRequestException(primeiroErro(dados.error))
    const c = req.contexto!
    return this.transferencia.assumir(c.clinicaId, c.ator, c.clinicaFuso, autorDe(c), id, dados.data)
  }

  @Post(':id/transferir')
  @UseGuards(LimiteDeEscritaDoFluxoGuard)
  @HttpCode(HttpStatus.OK)
  async transferir(
    @Req() req: RequisicaoComContexto,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() corpo: unknown,
  ): Promise<TarefasAfetadas> {
    const dados = TransferirTarefa.safeParse(corpo)
    if (!dados.success) throw new BadRequestException(primeiroErro(dados.error))
    const c = req.contexto!
    return this.transferencia.transferir(
      c.clinicaId,
      c.ator,
      c.clinicaFuso,
      autorDe(c),
      id,
      dados.data,
    )
  }

  /**
   * A cadeia de "concluir e criar nova". `@DadoSensivel('pacientes')`: um nó
   * pode ser tarefa de paciente identificado. O `id` da trilha é o da TAREFA
   * pedida, sob a entidade `pacientes` — a mistura é conhecida e está no teste
   * de `acesso-sensivel` (a trilha responde "quem olhou" por tarefa, e a tarefa
   * leva ao paciente).
   */
  @Get(':id/fluxo')
  @DadoSensivel('pacientes')
  async fluxoDaTarefa(
    @Req() req: RequisicaoComContexto,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<FluxoDaTarefa> {
    const c = req.contexto!
    return this.fluxo.fluxo(c.clinicaId, c.ator, leitorDe(c), c.pode('pacientes'), id)
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

  @Get(':id/exclusao')
  async previaDaExclusao(
    @Req() req: RequisicaoComContexto,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<PrevisaoDeExclusao> {
    const c = req.contexto!
    return this.edicao.previaDaExclusao(c.clinicaId, c.ator, leitorDe(c), id)
  }

  @Delete(':id')
  async excluir(
    @Req() req: RequisicaoComContexto,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() consulta: unknown,
    // O motivo vai no CORPO, e não na URL: URL vai para log de acesso, e o motivo
    // é texto livre. Opcional para a pessoa da clínica; obrigatório ao Suporte.
    @Body() corpo: unknown,
  ): Promise<ExclusaoDeTarefa> {
    const dados = ExcluirTarefa.safeParse(consulta)
    if (!dados.success) throw new BadRequestException(primeiroErro(dados.error))
    const motivo = CorpoComMotivo.safeParse(corpo ?? {})
    if (!motivo.success) throw new BadRequestException(primeiroErro(motivo.error))
    const c = req.contexto!
    // `leitorDe` e não `autorDe`, de propósito: excluir não GRAVA o nome de
    // ninguém numa coluna de pessoa, então o SUPORTE pode excluir (ADR
    // 2026-11-13). As demais escritas de tarefa continuam em `autorDe`.
    return this.edicao.excluir(c.clinicaId, c.ator, leitorDe(c), id, dados.data.serie, {
      // Para o operador `pode('receber')` é sempre verdadeiro (admin em temPerm):
      // o suporte estorna o pagamento junto. É risco aceito, ver decisoes.md.
      podeReceber: c.pode('receber'),
      ...(motivo.data.motivo === undefined ? {} : { motivo: motivo.data.motivo }),
    })
  }
}

/**
 * `primeiroErro` mora em `comum/primeiro-erro.ts`. Reexportado daqui para os
 * controladores que já o importavam deste arquivo continuarem a compilar;
 * código novo importa de `comum/`.
 */
export { primeiroErro }
