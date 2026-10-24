import {
  ConsultaDePacientes,
  type DesativacaoDePaciente,
  EditarPaciente,
  type FichaDoPaciente,
  ImportarPacientes,
  type ListaDePacientes,
  type PacienteNaLista,
  type ResultadoDaImportacao,
  SalvarPaciente,
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
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common'
import { DadoSensivel } from '../auditoria/acesso.decorator'
import { Exige } from '../autorizacao/autorizacao.guard'
import type { RequisicaoComContexto } from '../comum/contexto'
import { ImportacaoDePacientesService } from './importacao.service'
import { PacientesService } from './pacientes.service'

/**
 * Pacientes.
 *
 * `@Exige('pacientes')` na classe, e `@Exige('pacientes.gerir')` sobrescrevendo
 * nas duas ações que mudam a vida da clínica inteira — desativar e importar.
 * `getAllAndOverride` no guard faz o do handler vencer o da classe.
 *
 * `@DadoSensivel` fica SÓ na ficha e só nela: é a rota que a regra 18 nomeia,
 * porque a pergunta da LGPD é *"quem olhou o cadastro da minha paciente"*. A
 * listagem não entra — uma busca que devolve 200 pacientes viraria 200 linhas
 * de trilha, e o próximo acesso a UMA ficha ficaria invisível no meio delas.
 */
@Controller('v1/pacientes')
@Exige('pacientes')
export class PacientesController {
  // `@Inject` explícito: ver o comentário em autenticacao.service.ts — o
  // esbuild não emite `design:paramtypes`.
  constructor(
    @Inject(PacientesService) private readonly pacientes: PacientesService,
    @Inject(ImportacaoDePacientesService)
    private readonly importacao: ImportacaoDePacientesService,
  ) {}

  @Get()
  async listar(
    @Req() req: RequisicaoComContexto,
    @Query() consulta: unknown,
  ): Promise<ListaDePacientes> {
    const dados = ConsultaDePacientes.safeParse(consulta)
    if (!dados.success) throw new BadRequestException('Confira os filtros da busca.')

    // `!` seguro: `SessaoGuard` é global e esta rota não é `@Publico()`.
    const c = req.contexto!
    // Ordenar por LTV é ler o LTV pela posição. Ver `ORDENS_DE_PACIENTE`.
    if (dados.data.ordem === 'ltv' && !c.pode('valores')) {
      throw new ForbiddenException('Sem acesso a esta ação.')
    }
    return this.pacientes.listar(c.clinicaId, c.ator, c.clinicaFuso, dados.data)
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async criar(
    @Req() req: RequisicaoComContexto,
    @Body() corpo: unknown,
  ): Promise<PacienteNaLista> {
    const dados = SalvarPaciente.safeParse(corpo)
    // A mensagem não repete o que veio: nome e telefone de paciente não saem
    // em resposta de erro nem em log (regra 21).
    if (!dados.success) throw new BadRequestException(primeiroErro(dados.error))
    const c = req.contexto!
    return this.pacientes.criar(c.clinicaId, c.ator, c.clinicaFuso, dados.data)
  }

  /**
   * A IMPORTAÇÃO vem ANTES de `:id`.
   *
   * O Fastify casa rota estática antes de paramétrica, então a ordem aqui não
   * muda o roteamento — mas quem lê o arquivo precisa ver que `importar` não
   * é um id, e quem mover um decorador precisa ver que há o que conferir.
   */
  @Post('importar')
  @Exige('pacientes.gerir')
  @HttpCode(HttpStatus.OK)
  async importar(
    @Req() req: RequisicaoComContexto,
    @Body() corpo: unknown,
  ): Promise<ResultadoDaImportacao> {
    const dados = ImportarPacientes.safeParse(corpo)
    if (!dados.success) throw new BadRequestException(primeiroErro(dados.error))
    const c = req.contexto!
    return this.importacao.importar(c.clinicaId, c.ator, c.clinicaFuso, dados.data)
  }

  @Get(':id')
  @DadoSensivel('pacientes')
  async ficha(
    @Req() req: RequisicaoComContexto,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<FichaDoPaciente> {
    const c = req.contexto!
    return this.pacientes.ficha(c.clinicaId, c.ator, c.clinicaFuso, id)
  }

  @Patch(':id')
  async editar(
    @Req() req: RequisicaoComContexto,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() corpo: unknown,
  ): Promise<PacienteNaLista> {
    const dados = EditarPaciente.safeParse(corpo)
    if (!dados.success) throw new BadRequestException(primeiroErro(dados.error))
    const c = req.contexto!
    return this.pacientes.editar(c.clinicaId, c.ator, c.clinicaFuso, id, dados.data)
  }

  /**
   * DESATIVAR, não excluir — ADR 0003.
   *
   * O protótipo e o `Code.gs` apagam o paciente, todas as tarefas dele e
   * todos os programas. A regra 20 não permite: a trilha de um atendimento
   * concluído é prova, não conveniência.
   */
  @Delete(':id')
  @Exige('pacientes.gerir')
  async desativar(
    @Req() req: RequisicaoComContexto,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<DesativacaoDePaciente> {
    const c = req.contexto!
    return this.pacientes.desativar(c.clinicaId, c.ator, id)
  }
}

/**
 * A primeira mensagem do Zod, sem o VALOR que a causou.
 *
 * `JSON.stringify(error)` traria o corpo inteiro para dentro da resposta — e
 * daí para o log do cliente, do proxy e do navegador. Nome e telefone de
 * paciente não atravessam (regra 21).
 */
const primeiroErro = (erro: { issues: readonly { message: string }[] }): string =>
  erro.issues[0]?.message ?? 'Confira os campos do cadastro.'
