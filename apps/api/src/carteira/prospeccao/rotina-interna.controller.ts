import {
  type CargaDaEquipeSaida,
  type CheckinInternoCriadoSaida,
  type EquipeDaRotinaSaida,
  type ListaDeAniversariosSaida,
  type ListaDeCheckinsInternosSaida,
  type ListaDeRotinasCarteiraSaida,
  type ListaDeTarefasCarteiraSaida,
  type MeuAniversarioSaida,
  type ParabenizarSaida,
  type RedistribuirTarefasSaida,
  type RotinaCarteiraSalvaSaida,
  type TarefaCarteiraSaida,
  AtualizarCheckinInternoEntrada,
  CriarTarefaCarteiraEntrada,
  DefinirMeuAniversarioEntrada,
  EditarTarefaCarteiraEntrada,
  FiltroDeTarefasCarteira,
  MarcarItemDaTarefaCarteiraEntrada,
  MudarStatusDaTarefaCarteiraEntrada,
  ParabenizarEntrada,
  RedistribuirTarefasEntrada,
  RegistrarCheckinInternoEntrada,
  RotinaCarteiraEntrada,
  TransferirTarefaCarteiraEntrada,
  Uuid,
} from '@fir/contracts'
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common'
import type { RequisicaoComCarteira } from '../contexto-da-carteira'
import { FUSO_DA_CARTEIRA } from '../fuso-da-carteira'
import { SoUsuarioDeGestao } from '../so-usuario-de-gestao.decorator'
import { GrupoCruzado, ReferenciaInexistente, ResponsavelDeOutroGrupo } from './prospeccao-comum'
import {
  CheckinForaDaSemana,
  ItemNaoEncontrado,
  RotinaInternaService,
  RotinaNaoEncontrada,
  SemTelefone,
  SoEscopoGeral,
  TarefaEmConflito,
  TarefaNaoEncontrada,
} from './rotina-interna.service'

/**
 * A rotina da equipe Firmare (G5, completada pelo G8 2A): rotinas, tarefas,
 * carga, redistribuir, aniversários e checkins. `/v1/carteira`, o
 * `Usuário de Gestão` dentro do próprio escopo (ADR 0016).
 *
 * O erro de validação nunca ecoa o valor recebido (A-21): a mensagem é fixa,
 * ou a do domínio, que não carrega dado.
 */
@SoUsuarioDeGestao()
@Controller('v1/carteira')
export class RotinaInternaController {
  constructor(@Inject(RotinaInternaService) private readonly servico: RotinaInternaService) {}

  /* ── Rotinas ── */

  @Get('rotinas-internas')
  async listarRotinas(@Req() req: RequisicaoComCarteira): Promise<ListaDeRotinasCarteiraSaida> {
    return { rotinas: await this.servico.listarRotinas(req.carteira!.usuarioDeGestao) }
  }

  @Post('rotinas-internas')
  async criarRotina(@Body() corpo: unknown, @Req() req: RequisicaoComCarteira): Promise<RotinaCarteiraSalvaSaida> {
    const dados = RotinaCarteiraEntrada.safeParse(corpo)
    if (!dados.success) throw new BadRequestException(mensagemDaRotina(dados.error.issues))
    return traduzir(() => this.servico.criarRotina(req.carteira!.usuarioDeGestao, dados.data))
  }

  @Put('rotinas-internas/:id')
  async editarRotina(
    @Param('id') id: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoComCarteira,
  ): Promise<RotinaCarteiraSalvaSaida> {
    exigirUuid(id, 'Rotina não encontrada.')
    const dados = RotinaCarteiraEntrada.safeParse(corpo)
    if (!dados.success) throw new BadRequestException(mensagemDaRotina(dados.error.issues))
    return traduzir(() => this.servico.editarRotina(req.carteira!.usuarioDeGestao, id, dados.data))
  }

  @Post('rotinas-internas/:id/excluir')
  @HttpCode(204)
  async excluirRotina(@Param('id') id: string, @Req() req: RequisicaoComCarteira): Promise<void> {
    exigirUuid(id, 'Rotina não encontrada.')
    await traduzir(() => this.servico.excluirRotina(req.carteira!.usuarioDeGestao, id))
  }

  /* ── Tarefas ── */

  @Get('tarefas-internas')
  async listarTarefas(
    @Query('responsavel') responsavel: string | undefined,
    @Req() req: RequisicaoComCarteira,
  ): Promise<ListaDeTarefasCarteiraSaida> {
    const filtro = FiltroDeTarefasCarteira.safeParse(responsavel)
    if (!filtro.success) throw new BadRequestException('Filtro de responsável inválido.')
    return this.servico.listarTarefas(req.carteira!.usuarioDeGestao, filtro.data)
  }

  @Post('tarefas-internas')
  async criarTarefa(@Body() corpo: unknown, @Req() req: RequisicaoComCarteira): Promise<TarefaCarteiraSaida> {
    const dados = CriarTarefaCarteiraEntrada.safeParse(corpo)
    if (!dados.success) throw new BadRequestException('Confira os campos da tarefa.')
    return { tarefa: await traduzir(() => this.servico.criarTarefa(req.carteira!.usuarioDeGestao, dados.data)), proxima: null }
  }

  /**
   * Redistribuir (R8). Declarada ANTES de `tarefas-internas/:id` por clareza;
   * não colide de qualquer forma — toda rota com `:id` tem sufixo.
   */
  @Post('tarefas-internas/redistribuir')
  @HttpCode(200)
  async redistribuir(@Body() corpo: unknown, @Req() req: RequisicaoComCarteira): Promise<RedistribuirTarefasSaida> {
    const dados = RedistribuirTarefasEntrada.safeParse(corpo)
    if (!dados.success) {
      const diferentes = dados.error.issues.some((i) => i.message === 'Escolha pessoas diferentes')
      throw new BadRequestException(diferentes ? 'Escolha pessoas diferentes.' : 'Confira os filtros da redistribuição.')
    }
    return traduzir(() => this.servico.redistribuir(req.carteira!.usuarioDeGestao, dados.data))
  }

  @Put('tarefas-internas/:id')
  async editarTarefa(
    @Param('id') id: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoComCarteira,
  ): Promise<TarefaCarteiraSaida> {
    exigirUuid(id, 'Tarefa não encontrada.')
    const dados = EditarTarefaCarteiraEntrada.safeParse(corpo)
    if (!dados.success) throw new BadRequestException('Confira os campos da tarefa.')
    return { tarefa: await traduzir(() => this.servico.editarTarefa(req.carteira!.usuarioDeGestao, id, dados.data)), proxima: null }
  }

  @Post('tarefas-internas/:id/status')
  @HttpCode(200)
  async mudarStatus(
    @Param('id') id: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoComCarteira,
  ): Promise<TarefaCarteiraSaida> {
    exigirUuid(id, 'Tarefa não encontrada.')
    const dados = MudarStatusDaTarefaCarteiraEntrada.safeParse(corpo)
    if (!dados.success) throw new BadRequestException('Status inválido.')
    return traduzir(() => this.servico.mudarStatusTarefa(req.carteira!.usuarioDeGestao, id, dados.data.status))
  }

  @Post('tarefas-internas/:id/responsavel')
  @HttpCode(200)
  async transferir(
    @Param('id') id: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoComCarteira,
  ): Promise<TarefaCarteiraSaida> {
    exigirUuid(id, 'Tarefa não encontrada.')
    const dados = TransferirTarefaCarteiraEntrada.safeParse(corpo)
    if (!dados.success) throw new BadRequestException('Escolha para quem transferir.')
    const tarefa = await traduzir(() =>
      this.servico.transferirTarefa(req.carteira!.usuarioDeGestao, id, dados.data.responsavelUsuarioGestaoId),
    )
    return { tarefa, proxima: null }
  }

  @Post('tarefas-internas/:id/itens/:itemId')
  @HttpCode(200)
  async marcarItem(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoComCarteira,
  ): Promise<TarefaCarteiraSaida> {
    exigirUuid(id, 'Tarefa não encontrada.')
    exigirUuid(itemId, 'Item não encontrado.')
    const dados = MarcarItemDaTarefaCarteiraEntrada.safeParse(corpo)
    if (!dados.success) throw new BadRequestException('Marque ou desmarque o item.')
    const tarefa = await traduzir(() =>
      this.servico.marcarItem(req.carteira!.usuarioDeGestao, id, itemId, dados.data.feito),
    )
    return { tarefa, proxima: null }
  }

  /* ── Equipe e carga ── */

  @Get('equipe-da-rotina')
  async equipe(@Req() req: RequisicaoComCarteira): Promise<EquipeDaRotinaSaida> {
    return this.servico.equipe(req.carteira!.usuarioDeGestao)
  }

  @Get('carga')
  async carga(
    @Query('pessoa') pessoa: string | undefined,
    @Req() req: RequisicaoComCarteira,
  ): Promise<CargaDaEquipeSaida> {
    const escolhida = pessoa === undefined || pessoa === '' ? null : pessoa
    if (escolhida !== null) exigirUuid(escolhida, 'Pessoa não encontrada.')
    return traduzir(() => this.servico.carga(req.carteira!.usuarioDeGestao, escolhida))
  }

  /* ── Aniversários ── */

  @Get('aniversarios')
  async aniversarios(@Req() req: RequisicaoComCarteira): Promise<ListaDeAniversariosSaida> {
    return { aniversarios: await this.servico.aniversarios(req.carteira!.usuarioDeGestao) }
  }

  @Post('aniversarios/parabenizar')
  @HttpCode(200)
  async parabenizar(@Body() corpo: unknown, @Req() req: RequisicaoComCarteira): Promise<ParabenizarSaida> {
    const dados = ParabenizarEntrada.safeParse(corpo)
    if (!dados.success) throw new BadRequestException('Aniversário inválido.')
    return { url: await traduzir(() => this.servico.parabenizar(req.carteira!.usuarioDeGestao, dados.data.tipo, dados.data.id)) }
  }

  @Get('eu/aniversario')
  async meuAniversario(@Req() req: RequisicaoComCarteira): Promise<MeuAniversarioSaida> {
    return this.servico.meuAniversario(req.carteira!.usuarioDeGestao)
  }

  @Put('eu/aniversario')
  async definirMeuAniversario(@Body() corpo: unknown, @Req() req: RequisicaoComCarteira): Promise<MeuAniversarioSaida> {
    const dados = DefinirMeuAniversarioEntrada.safeParse(corpo)
    if (!dados.success) throw new BadRequestException(dados.error.issues[0]?.message ?? 'Confira o dia e o mês.')
    return this.servico.definirMeuAniversario(req.carteira!.usuarioDeGestao, dados.data)
  }

  /* ── Checkins (G5) ── */

  @Get('clientes/:id/checkins')
  async listarCheckins(
    @Param('id') id: string,
    @Req() req: RequisicaoComCarteira,
  ): Promise<ListaDeCheckinsInternosSaida> {
    exigirUuid(id, 'Cliente não encontrado.')
    return { checkins: await this.servico.listarCheckins(req.carteira!.usuarioDeGestao, id) }
  }

  @Post('checkins-internos')
  async registrarCheckin(
    @Body() corpo: unknown,
    @Req() req: RequisicaoComCarteira,
  ): Promise<CheckinInternoCriadoSaida> {
    const dados = RegistrarCheckinInternoEntrada.safeParse(corpo)
    if (!dados.success) throw new BadRequestException('Confira a nota e a saúde do cliente.')
    try {
      const checkin = await this.servico.registrarCheckin(req.carteira!.usuarioDeGestao, FUSO_DA_CARTEIRA, dados.data)
      return { checkin }
    } catch (e) {
      if (e instanceof ReferenciaInexistente) throw new BadRequestException('Cliente Firmare inválido.')
      if (e instanceof CheckinForaDaSemana) {
        throw new ForbiddenException('Um checkin de semana anterior não pode mais ser editado.')
      }
      throw e
    }
  }

  @Post('checkins-internos/:id/atualizar')
  async atualizarCheckin(
    @Param('id') id: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoComCarteira,
  ): Promise<CheckinInternoCriadoSaida> {
    const dados = AtualizarCheckinInternoEntrada.safeParse(corpo)
    if (!dados.success) throw new BadRequestException('Confira a nota e a saúde do cliente.')
    try {
      const checkin = await this.servico.atualizarCheckin(req.carteira!.usuarioDeGestao, FUSO_DA_CARTEIRA, id, dados.data)
      return { checkin }
    } catch (e) {
      if (e instanceof ReferenciaInexistente) throw new NotFoundException('Checkin não encontrado.')
      if (e instanceof CheckinForaDaSemana) {
        throw new ForbiddenException('Um checkin de semana anterior não pode mais ser editado.')
      }
      throw e
    }
  }
}

/** Id fora do formato responde como "não existe" — nunca um 500 de cast no banco. */
function exigirUuid(id: string, mensagem: string): void {
  if (!Uuid.safeParse(id).success) throw new NotFoundException(mensagem)
}

/**
 * A mensagem da rotina: a do domínio (`validarParametrosDaRotina`, texto fixo
 * sem dado do usuário) quando houver; senão a genérica.
 */
function mensagemDaRotina(issues: readonly { code: string; message: string }[]): string {
  return issues.find((i) => i.code === 'custom')?.message ?? 'Confira os campos da rotina.'
}

/** Os erros do serviço → status HTTP. Um lugar só para as rotas desta frente. */
async function traduzir<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (e) {
    if (e instanceof GrupoCruzado || e instanceof ResponsavelDeOutroGrupo) throw new ForbiddenException(e.message)
    if (e instanceof SoEscopoGeral) {
      throw new ForbiddenException('A carga da equipe e a redistribuição são da gestão da Firmare.')
    }
    if (e instanceof ReferenciaInexistente) throw new BadRequestException('Pessoa, cliente ou lead inválido.')
    if (e instanceof RotinaNaoEncontrada) throw new NotFoundException('Rotina não encontrada.')
    if (e instanceof TarefaNaoEncontrada) throw new NotFoundException('Tarefa não encontrada.')
    if (e instanceof ItemNaoEncontrado) throw new NotFoundException('Item não encontrado.')
    if (e instanceof TarefaEmConflito) {
      throw new ConflictException('Já existe uma tarefa desta rotina nesta data. Atualize a lista.')
    }
    if (e instanceof SemTelefone) throw new NotFoundException('Sem WhatsApp cadastrado para parabenizar.')
    throw e
  }
}
