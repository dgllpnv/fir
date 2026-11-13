import {
  type CampanhaDetalhe,
  type CampanhaImportada,
  type Campanhas,
  ConsultaDeCampanhas,
  ConsultaDeTarefasDaCampanha,
  ImportarCampanha,
  type RascunhoDeCampanha,
  SalvarCampanha,
  type TarefasDaCampanha,
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
  Put,
  Query,
  Req,
} from '@nestjs/common'
import { DadoSensivel } from '../auditoria/acesso.decorator'
import { Exige } from '../autorizacao/autorizacao.guard'
import type { RequisicaoComContexto } from '../comum/contexto'
import { primeiroErro } from '../tarefas/tarefas.controller'
import { CampanhasService } from './campanhas.service'

/**
 * **Comercial › Campanhas** (MANUAL cap. 9).
 *
 * **DUAS CHAVES, E É O QUE A MATRIZ DELA DIZ:** `campanhas` para VER (*"Ver as
 * campanhas e executar as ações"*) e `campanhas.gerir` para *"criar, importar
 * e excluir"*. A Recepção e o Comercial têm a primeira; só a Supervisão tem a
 * segunda.
 *
 * `@Exige('campanhas')` na classe e `@Exige('campanhas.gerir')` nas escritas:
 * o guard usa `getAllAndOverride`, então o do método vence o da classe.
 *
 * **Nenhum `if` de permissão sobre dinheiro.** `metaEmDinheiro`,
 * `resultadoEmDinheiro` e `receita` estão em `CAMPOS_MONETARIOS`, e o
 * `RedacaoInterceptor` os apaga num ponto único (regra 17) — inclusive para
 * quem tem `campanhas` e não tem `valores`, que é exatamente o perfil da
 * Recepção.
 */
@Controller('v1/campanhas')
@Exige('campanhas')
export class CampanhasController {
  // `@Inject` explícito: o esbuild não emite `design:paramtypes`.
  constructor(@Inject(CampanhasService) private readonly campanhas: CampanhasService) {}

  /** `?mes=aaaa-mm|atual&tipo=<categoria>` — a lista do mês (`vCampanhas`). */
  @Get()
  async listar(
    @Query() query: unknown,
    @Req() req: RequisicaoComContexto,
  ): Promise<Campanhas> {
    const consulta = ConsultaDeCampanhas.safeParse(query)
    if (!consulta.success) throw new BadRequestException(primeiroErro(consulta.error))
    return this.campanhas.listar(contexto(req), consulta.data)
  }

  /** O detalhe: meta, funil, ações por tipo, quem executou e o histórico. */
  @Get(':id')
  async detalhe(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: RequisicaoComContexto,
  ): Promise<CampanhaDetalhe> {
    return this.campanhas.detalhe(contexto(req), id)
  }

  /**
   * As tarefas da campanha — **todas**, para quem tem `campanhas`, sem o
   * recorte de `escopo` (ADR 2026-11-13).
   *
   * `@DadoSensivel('campanhas', { param: 'id' })`: a resposta traz o nome (e,
   * com `pacientes`, o telefone) de quem a campanha alcançou — regra 18, a
   * leitura também deixa trilha. A linha leva o id da CAMPANHA (I4): a
   * sentinela `(lista)` não permitia responder "quem abriu as tarefas desta
   * campanha"; uma linha por paciente esconderia o próximo acesso a UMA.
   */
  @Get(':id/tarefas')
  @DadoSensivel('campanhas', { param: 'id' })
  async tarefas(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: unknown,
    @Req() req: RequisicaoComContexto,
  ): Promise<TarefasDaCampanha> {
    const consulta = ConsultaDeTarefasDaCampanha.safeParse(query)
    if (!consulta.success) throw new BadRequestException(primeiroErro(consulta.error))
    return this.campanhas.tarefas(
      contexto(req),
      id,
      consulta.data,
      req.contexto!.pode('pacientes'),
      req.contexto!.pode('jornada'),
    )
  }

  /** O rascunho de "Repetir no próximo mês" — não grava nada. */
  @Get(':id/proximo-mes')
  @Exige('campanhas.gerir')
  async proximoMes(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: RequisicaoComContexto,
  ): Promise<RascunhoDeCampanha> {
    return this.campanhas.proximoMes(contexto(req), id)
  }

  /** `salvarCampanha` — criar. 409 no nome repetido, pelo índice. */
  @Post()
  @Exige('campanhas.gerir')
  @HttpCode(HttpStatus.CREATED)
  async criar(
    @Body() corpo: unknown,
    @Req() req: RequisicaoComContexto,
  ): Promise<Campanhas> {
    const dados = SalvarCampanha.safeParse(corpo)
    if (!dados.success) throw new BadRequestException(primeiroErro(dados.error))
    return this.campanhas.salvar(contexto(req), null, dados.data, req.contexto!.pode('valores'))
  }

  /**
   * `salvarCampanha` — editar. **`PUT`, a campanha inteira.**
   *
   * Num `PATCH`, "campo ausente" e "campo apagado" se confundem, e a tela que
   * reenvia o formulário sem o objetivo o apagaria em silêncio. É a mesma
   * decisão da ficha de pessoa.
   */
  @Put(':id')
  @Exige('campanhas.gerir')
  async editar(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoComContexto,
  ): Promise<Campanhas> {
    const dados = SalvarCampanha.safeParse(corpo)
    if (!dados.success) throw new BadRequestException(primeiroErro(dados.error))
    return this.campanhas.salvar(contexto(req), id, dados.data, req.contexto!.pode('valores'))
  }

  /** `excluirCampanha` — soft delete, e a tarefa continua ligada (regra 20). */
  @Delete(':id')
  @Exige('campanhas.gerir')
  async excluir(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: RequisicaoComContexto,
  ): Promise<Campanhas> {
    return this.campanhas.excluir(contexto(req), id)
  }

  /**
   * `importarCampanha` — a lista vira paciente mais tarefa, **idempotente**.
   *
   * `@HttpCode(200)`: a segunda importação do mesmo arquivo não cria nada
   * (`criadas: 0`, tudo em `ignoradas`), e um `201 Created` sobre ela seria
   * mentira na linha de status. Mesma decisão de `copiarMetas`.
   */
  @Post(':id/importar')
  @Exige('campanhas.gerir')
  @HttpCode(HttpStatus.OK)
  async importar(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoComContexto,
  ): Promise<CampanhaImportada> {
    const dados = ImportarCampanha.safeParse(corpo)
    if (!dados.success) throw new BadRequestException(primeiroErro(dados.error))
    return this.campanhas.importar(contexto(req), id, dados.data)
  }
}

/** A clínica vem da SESSÃO, nunca do corpo — ver `banco/clinica-id.ts`. */
function contexto(req: RequisicaoComContexto) {
  // `!` seguro: `SessaoGuard` é global e nenhuma rota daqui é `@Publico()`.
  const c = req.contexto!
  return { clinicaId: c.clinicaId, ator: c.ator, fuso: c.clinicaFuso, valores: c.pode('valores') }
}
