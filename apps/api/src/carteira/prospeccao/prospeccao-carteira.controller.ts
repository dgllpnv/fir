import {
  type CheckinInternoCriadoSaida,
  type InteracaoDoLeadCriadaSaida,
  type LeadCriadoSaida,
  type ListaDeCheckinsInternosSaida,
  type ListaDeInteracoesDoLeadSaida,
  type ListaDeLeadsSaida,
  type ListaDeRotinasInternasSaida,
  type ListaDeTarefasInternasSaida,
  type RotinaInternaCriadaSaida,
  type TarefaInternaCriadaSaida,
  AtualizarCheckinInternoEntrada,
  AtualizarStatusDaTarefaInternaEntrada,
  AvancarEtapaDoLeadEntrada,
  CriarInteracaoDoLeadEntrada,
  CriarLeadEntrada,
  CriarRotinaInternaEntrada,
  CriarTarefaInternaEntrada,
  RegistrarCheckinInternoEntrada,
} from '@fir/contracts'
import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
  Req,
} from '@nestjs/common'
import type { RequisicaoComCarteira } from '../contexto-da-carteira'
import { SoUsuarioDeGestao } from '../so-usuario-de-gestao.decorator'
import {
  CheckinForaDaSemana,
  GrupoCruzado,
  LeadConvertidoNaoArquiva,
  LeadNaoEncontrado,
  ProspeccaoCarteiraService,
  ReferenciaInexistente,
  ResponsavelDeOutroGrupo,
  TarefaNaoEncontrada,
  TransicaoDeEtapaInvalida,
} from './prospeccao-carteira.service'

/**
 * O fuso da própria OPERAÇÃO da Firmare — não o de uma `Clinica` (regra 22 do
 * CLAUDE.md fala do fuso DA CLÍNICA; um `Checkin interno` não é dado de
 * nenhuma clínica, é o ritual semanal da EQUIPE FIRMARE, que é uma empresa
 * só, com um fuso só). Diferente do `const America/Bahia` do legado que a
 * regra 22 proíbe: aquele vazava para dado de clínica MULTI-TENANT; este é
 * interno à Firmare, que não é multi-tenant.
 */
const FUSO_DA_FIRMARE = 'America/Bahia'

/**
 * G5 — funil de prospecção e rotina interna. `/v1/carteira`, mesmo espaço do
 * `CarteiraController` — o `Usuário de Gestão`, dentro do próprio escopo
 * (ADR 0016, emenda à ADR 0011 item 1).
 */
@SoUsuarioDeGestao()
@Controller('v1/carteira')
export class ProspeccaoCarteiraController {
  constructor(@Inject(ProspeccaoCarteiraService) private readonly servico: ProspeccaoCarteiraService) {}

  @Get('leads')
  async listarLeads(@Req() req: RequisicaoComCarteira): Promise<ListaDeLeadsSaida> {
    return { leads: await this.servico.listarLeads(req.carteira!.usuarioDeGestao) }
  }

  @Post('leads')
  async criarLead(@Body() corpo: unknown, @Req() req: RequisicaoComCarteira): Promise<LeadCriadoSaida> {
    const dados = CriarLeadEntrada.safeParse(corpo)
    if (!dados.success) throw new BadRequestException('Confira os campos do lead.')
    try {
      return { lead: await this.servico.criarLead(req.carteira!.usuarioDeGestao, dados.data) }
    } catch (e) {
      if (e instanceof GrupoCruzado || e instanceof ResponsavelDeOutroGrupo) {
        throw new ForbiddenException(e.message)
      }
      if (e instanceof ReferenciaInexistente) throw new BadRequestException('Responsável inválido.')
      throw e
    }
  }

  @Post('leads/:id/etapa')
  async avancarEtapa(
    @Param('id') id: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoComCarteira,
  ): Promise<LeadCriadoSaida> {
    const dados = AvancarEtapaDoLeadEntrada.safeParse(corpo)
    if (!dados.success) throw new BadRequestException('Confira a etapa e o motivo.')
    try {
      const lead = await this.servico.avancarEtapa(
        req.carteira!.usuarioDeGestao,
        id,
        dados.data.etapa,
        dados.data.motivoPerda ?? null,
        dados.data.proximoContato,
      )
      return { lead }
    } catch (e) {
      if (e instanceof LeadNaoEncontrado) throw new NotFoundException('Lead não encontrado.')
      if (e instanceof TransicaoDeEtapaInvalida) throw new BadRequestException(e.message)
      if (e instanceof ReferenciaInexistente) throw new BadRequestException('Grupo inválido para conversão.')
      throw e
    }
  }

  @Post('leads/:id/arquivar')
  async arquivarLead(
    @Param('id') id: string,
    @Req() req: RequisicaoComCarteira,
  ): Promise<LeadCriadoSaida> {
    try {
      return { lead: await this.servico.arquivarLead(req.carteira!.usuarioDeGestao, id) }
    } catch (e) {
      if (e instanceof LeadNaoEncontrado) throw new NotFoundException('Lead não encontrado.')
      if (e instanceof LeadConvertidoNaoArquiva) {
        throw new ForbiddenException('Um lead já convertido em Cliente Firmare não pode ser arquivado.')
      }
      throw e
    }
  }

  @Get('leads/:id/interacoes')
  async listarInteracoes(
    @Param('id') id: string,
    @Req() req: RequisicaoComCarteira,
  ): Promise<ListaDeInteracoesDoLeadSaida> {
    return { interacoes: await this.servico.listarInteracoes(req.carteira!.usuarioDeGestao, id) }
  }

  @Post('leads/:id/interacoes')
  async criarInteracao(
    @Param('id') id: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoComCarteira,
  ): Promise<InteracaoDoLeadCriadaSaida> {
    const dados = CriarInteracaoDoLeadEntrada.safeParse(corpo)
    if (!dados.success) throw new BadRequestException('Confira o canal e a nota.')
    try {
      return { interacao: await this.servico.criarInteracao(req.carteira!.usuarioDeGestao, id, dados.data) }
    } catch (e) {
      if (e instanceof LeadNaoEncontrado) throw new NotFoundException('Lead não encontrado.')
      throw e
    }
  }

  @Get('rotinas-internas')
  async listarRotinas(@Req() req: RequisicaoComCarteira): Promise<ListaDeRotinasInternasSaida> {
    return { rotinas: await this.servico.listarRotinas(req.carteira!.usuarioDeGestao) }
  }

  @Post('rotinas-internas')
  async criarRotina(
    @Body() corpo: unknown,
    @Req() req: RequisicaoComCarteira,
  ): Promise<RotinaInternaCriadaSaida> {
    const dados = CriarRotinaInternaEntrada.safeParse(corpo)
    if (!dados.success) throw new BadRequestException('Confira os campos da rotina.')
    try {
      return { rotina: await this.servico.criarRotina(req.carteira!.usuarioDeGestao, dados.data) }
    } catch (e) {
      if (e instanceof GrupoCruzado || e instanceof ResponsavelDeOutroGrupo) {
        throw new ForbiddenException(e.message)
      }
      if (e instanceof ReferenciaInexistente) throw new BadRequestException('Responsável inválido.')
      throw e
    }
  }

  @Get('tarefas-internas')
  async listarTarefas(@Req() req: RequisicaoComCarteira): Promise<ListaDeTarefasInternasSaida> {
    return { tarefas: await this.servico.listarTarefas(req.carteira!.usuarioDeGestao) }
  }

  @Post('tarefas-internas')
  async criarTarefa(
    @Body() corpo: unknown,
    @Req() req: RequisicaoComCarteira,
  ): Promise<TarefaInternaCriadaSaida> {
    const dados = CriarTarefaInternaEntrada.safeParse(corpo)
    if (!dados.success) throw new BadRequestException('Confira os campos da tarefa.')
    try {
      return { tarefa: await this.servico.criarTarefa(req.carteira!.usuarioDeGestao, dados.data) }
    } catch (e) {
      if (e instanceof GrupoCruzado || e instanceof ResponsavelDeOutroGrupo) {
        throw new ForbiddenException(e.message)
      }
      if (e instanceof ReferenciaInexistente) throw new BadRequestException('Cliente ou lead inválido.')
      throw e
    }
  }

  @Post('tarefas-internas/:id/status')
  async atualizarStatusTarefa(
    @Param('id') id: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoComCarteira,
  ): Promise<TarefaInternaCriadaSaida> {
    const dados = AtualizarStatusDaTarefaInternaEntrada.safeParse(corpo)
    if (!dados.success) throw new BadRequestException('Status inválido.')
    try {
      const tarefa = await this.servico.atualizarStatusTarefa(
        req.carteira!.usuarioDeGestao,
        id,
        dados.data.status,
      )
      return { tarefa }
    } catch (e) {
      if (e instanceof TarefaNaoEncontrada) throw new NotFoundException('Tarefa não encontrada.')
      throw e
    }
  }

  @Get('clientes/:id/checkins')
  async listarCheckins(
    @Param('id') id: string,
    @Req() req: RequisicaoComCarteira,
  ): Promise<ListaDeCheckinsInternosSaida> {
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
      const checkin = await this.servico.registrarCheckin(
        req.carteira!.usuarioDeGestao,
        FUSO_DA_FIRMARE,
        dados.data,
      )
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
      const checkin = await this.servico.atualizarCheckin(
        req.carteira!.usuarioDeGestao,
        FUSO_DA_FIRMARE,
        id,
        dados.data,
      )
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
