import {
  ConsultaDeProgramas,
  EncerrarPrograma,
  type FichaDoPrograma,
  MontarPrograma,
  type PainelDeProgramas,
  type ProgramaEncerradoNaSaida,
  type ProgramaMontadoNaSaida,
} from '@fir/contracts'
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
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
import { DadoSensivel } from '../auditoria/acesso.decorator'
import { Exige } from '../autorizacao/autorizacao.guard'
import type { RequisicaoComContexto } from '../comum/contexto'
import { primeiroErro } from '../tarefas/tarefas.controller'
import { LeituraDeProgramasService } from './leitura.service'
import { ProgramasService } from './programas.service'

/**
 * `POST /v1/programas` — Nova adesão.
 *
 * **Divergência consciente do protótipo.** Lá, `criarAdesao` não exige
 * permissão nenhuma: qualquer pessoa logada monta um programa **e lança o
 * pagamento**. O `Code.gs` idem. Aqui a rota exige `programas`, e `receber` é
 * cobrado NO CORPO — a enfermagem tem `programas` e não tem `receber`: ela
 * monta o programa, e o pagamento vai pela tela Recebimentos. A rota que cria
 * dinheiro é gated, sem exceção (é a mesma decisão D-7 do épico 3).
 */
@Controller('v1/programas')
@Exige('programas')
export class ProgramasController {
  // `@Inject` explícito: o esbuild não emite `design:paramtypes`.
  constructor(
    @Inject(ProgramasService) private readonly programas: ProgramasService,
    @Inject(LeituraDeProgramasService) private readonly leitura: LeituraDeProgramasService,
  ) {}

  /**
   * `GET /v1/programas` — os quatro blocos da tela, prontos.
   *
   * Sem `@DadoSensivel`: a mesma razão da listagem de pacientes. Uma lista que
   * devolve nome e progresso é a tela que a recepção abre cinquenta vezes por
   * dia, e registrar acesso em cada abertura enterraria a trilha que importa —
   * a da FICHA, que carrega dose e insumo.
   */
  @Get()
  async painel(
    @Req() req: RequisicaoComContexto,
    @Query() consulta: unknown,
  ): Promise<PainelDeProgramas> {
    const dados = ConsultaDeProgramas.safeParse(consulta)
    if (!dados.success) throw new BadRequestException(primeiroErro(dados.error))
    const c = req.contexto!
    return this.leitura.painel(
      { clinicaId: c.clinicaId, ator: c.ator, fuso: c.clinicaFuso },
      dados.data,
    )
  }

  /**
   * `GET /v1/programas/:id` — **e `@DadoSensivel` aqui não é zelo.**
   *
   * A ficha carrega dose, insumo e procedimento aplicado por paciente: dado
   * pessoal sensível de saúde (LGPD art. 11, regra 18). A pergunta que a lei
   * faz é *"quem olhou o tratamento da minha paciente"*, e a resposta precisa
   * existir — registro de **acesso**, não só de escrita.
   */
  @Get(':id')
  @DadoSensivel('pacientes')
  async ficha(
    @Req() req: RequisicaoComContexto,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<FichaDoPrograma> {
    const c = req.contexto!
    return this.leitura.ficha({ clinicaId: c.clinicaId, ator: c.ator, fuso: c.clinicaFuso }, id)
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async montar(
    @Req() req: RequisicaoComContexto,
    @Body() corpo: unknown,
  ): Promise<ProgramaMontadoNaSaida> {
    const dados = MontarPrograma.safeParse(corpo)
    if (!dados.success) throw new BadRequestException(primeiroErro(dados.error))
    // `!` seguro: `SessaoGuard` é global e esta rota não é `@Publico()`.
    const c = req.contexto!

    /**
     * A COBRANÇA DE `receber` É NO CONTROLADOR, não no decorador.
     *
     * `@Exige` é estático; "tem dinheiro no corpo" não é. E a checagem vem
     * ANTES de qualquer escrita: 403 com o banco intocado, e não um rollback
     * que depende de a transação ter sido aberta corretamente.
     */
    if (dados.data.pagamento !== undefined && !c.pode('receber')) {
      throw new ForbiddenException(
        'Para lançar o pagamento da adesão você precisa da permissão de recebimentos. ' +
          'Crie o programa sem valor e registre o pagamento pela tela Recebimentos.',
      )
    }

    return this.programas.montar(
      { clinicaId: c.clinicaId, ator: c.ator, fuso: c.clinicaFuso },
      dados.data,
    )
  }

  /**
   * ENCERRAR e EXCLUIR exigem `programas.gerir` — e aqui o protótipo e nós
   * concordamos. Não é divergência: é a matriz de permissões substituindo o
   * booleano `admin` do `Code.gs`, que o `CONTEXT.md` proíbe.
   *
   * `@Exige` acumula com o da classe: quem chega aqui já tem `programas`.
   */
  @Post(':id/encerrar')
  @HttpCode(HttpStatus.OK)
  @Exige('programas.gerir')
  async encerrar(
    @Req() req: RequisicaoComContexto,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() corpo: unknown,
  ): Promise<ProgramaEncerradoNaSaida> {
    const dados = EncerrarPrograma.safeParse(corpo)
    if (!dados.success) throw new BadRequestException(primeiroErro(dados.error))
    const c = req.contexto!
    return this.programas.encerrar(
      { clinicaId: c.clinicaId, ator: c.ator, fuso: c.clinicaFuso },
      id,
      dados.data,
    )
  }

  @Delete(':id')
  @Exige('programas.gerir')
  async excluir(
    @Req() req: RequisicaoComContexto,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ id: string; ids: readonly string[] }> {
    const c = req.contexto!
    return this.programas.excluir(
      { clinicaId: c.clinicaId, ator: c.ator, fuso: c.clinicaFuso },
      id,
    )
  }
}
