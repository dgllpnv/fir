import {
  type ContatoRegistradoSaida,
  type FichaDoLeadSaida,
  type IndicacoesSaida,
  type InteracaoDoLeadCriadaSaida,
  type LeadCriadoSaida,
  type ListaDeInteracoesDoLeadSaida,
  type ListaDeLeadsSaida,
  AvancarEtapaDoLeadEntrada,
  CriarInteracaoDoLeadEntrada,
  CriarLeadEntrada,
  EditarLeadEntrada,
  MarcarLeadPerdidoEntrada,
  RegistrarContatoDoLeadEntrada,
  Uuid,
} from '@fir/contracts'
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  Req,
} from '@nestjs/common'
import type { RequisicaoComCarteira } from '../contexto-da-carteira'
import { SoUsuarioDeGestao } from '../so-usuario-de-gestao.decorator'
import {
  ClienteIndicadorInvalido,
  ContatoSuprimido,
  LeadConvertidoNaoArquiva,
  LeadConvertidoNaoExclui,
  LeadExcluidoAPedido,
  LeadNaoEncontrado,
  LeadsService,
  SemPermissaoDeValores,
  TransicaoDeEtapaInvalida,
} from './leads.service'
import { GrupoCruzado, ReferenciaInexistente, ResponsavelDeOutroGrupo } from './prospeccao-comum'

/**
 * Um id que não é UUID responde como "não encontrado", nunca como 500 de
 * cast do Postgres — e igual ao id de outro grupo (a RLS o esconde): quem
 * pergunta não aprende se o lead existe.
 */
function idDeLead(id: string): string {
  if (!Uuid.safeParse(id).success) throw new NotFoundException('Lead não encontrado.')
  return id
}

/**
 * A tradução de erro de domínio para status, num lugar só (CLAUDE.md §6:
 * erros são valores no domínio, exceção na borda). A mensagem nunca ecoa o
 * que veio no corpo (appsec A-21).
 */
function traduzir(e: unknown): never {
  if (e instanceof LeadNaoEncontrado) throw new NotFoundException('Lead não encontrado.')
  if (e instanceof TransicaoDeEtapaInvalida) throw new BadRequestException(e.message)
  if (e instanceof GrupoCruzado || e instanceof ResponsavelDeOutroGrupo) throw new ForbiddenException(e.message)
  if (e instanceof SemPermissaoDeValores) throw new ForbiddenException('Sem permissão para valores.')
  if (e instanceof ContatoSuprimido) throw new ConflictException(e.message)
  if (e instanceof LeadExcluidoAPedido) {
    throw new ConflictException('Este lead foi excluído a pedido do titular e não pode ser preenchido de novo.')
  }
  if (e instanceof LeadConvertidoNaoExclui) {
    throw new ConflictException('Um lead já convertido em Cliente Firmare não é excluído por aqui.')
  }
  if (e instanceof LeadConvertidoNaoArquiva) {
    throw new ForbiddenException('Um lead já convertido em Cliente Firmare não pode ser arquivado.')
  }
  if (e instanceof ClienteIndicadorInvalido) throw new BadRequestException('Cliente indicador inválido.')
  if (e instanceof ReferenciaInexistente) throw new BadRequestException('Referência inválida.')
  throw e
}

/**
 * G5 — funil de prospecção, completado pelo G8 1E. `/v1/carteira`, mesmo
 * espaço do `CarteiraController` — o `Usuário de Gestão`, dentro do próprio
 * escopo (ADR 0016, emenda à ADR 0011 item 1).
 */
@SoUsuarioDeGestao()
@Controller('v1/carteira')
export class LeadsController {
  constructor(@Inject(LeadsService) private readonly servico: LeadsService) {}

  @Get('leads')
  async listarLeads(@Req() req: RequisicaoComCarteira): Promise<ListaDeLeadsSaida> {
    return this.servico.listarLeads(req.carteira!.usuarioDeGestao)
  }

  /** "Quem mais indica" (L2533-2548). */
  @Get('indicacoes')
  async indicacoes(@Req() req: RequisicaoComCarteira): Promise<IndicacoesSaida> {
    return this.servico.indicacoes(req.carteira!.usuarioDeGestao)
  }

  /** A ficha do lead (`vLead`). Grava o acesso (LGPD A53) dentro do serviço. */
  @Get('leads/:id')
  async obterFicha(@Param('id') id: string, @Req() req: RequisicaoComCarteira): Promise<FichaDoLeadSaida> {
    try {
      return await this.servico.obterFicha(req.carteira!.usuarioDeGestao, idDeLead(id))
    } catch (e) {
      traduzir(e)
    }
  }

  @Post('leads')
  async criarLead(@Body() corpo: unknown, @Req() req: RequisicaoComCarteira): Promise<LeadCriadoSaida> {
    const dados = CriarLeadEntrada.safeParse(corpo)
    if (!dados.success) throw new BadRequestException('Confira os campos do lead.')
    try {
      return { lead: await this.servico.criarLead(req.carteira!.usuarioDeGestao, dados.data) }
    } catch (e) {
      if (e instanceof ReferenciaInexistente) throw new BadRequestException('Responsável inválido.')
      traduzir(e)
    }
  }

  @Patch('leads/:id')
  async editarLead(
    @Param('id') id: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoComCarteira,
  ): Promise<LeadCriadoSaida> {
    const dados = EditarLeadEntrada.safeParse(corpo)
    if (!dados.success) throw new BadRequestException('Confira os campos do lead.')
    try {
      return { lead: await this.servico.editarLead(req.carteira!.usuarioDeGestao, idDeLead(id), dados.data) }
    } catch (e) {
      traduzir(e)
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
        idDeLead(id),
        dados.data.etapa,
        dados.data.motivoPerda ?? null,
        dados.data.proximoContato,
      )
      return { lead }
    } catch (e) {
      if (e instanceof ReferenciaInexistente) throw new BadRequestException('Grupo inválido para conversão.')
      traduzir(e)
    }
  }

  /** "Marcar como perdido", com "Tentar de novo em" (L2960). */
  @Post('leads/:id/perder')
  async marcarPerdido(
    @Param('id') id: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoComCarteira,
  ): Promise<LeadCriadoSaida> {
    const dados = MarcarLeadPerdidoEntrada.safeParse(corpo)
    if (!dados.success) throw new BadRequestException('Informe o motivo.')
    try {
      return { lead: await this.servico.marcarPerdido(req.carteira!.usuarioDeGestao, idDeLead(id), dados.data) }
    } catch (e) {
      traduzir(e)
    }
  }

  /** "Registrar contato" (L2559-2565), idempotente pela chave. */
  @Post('leads/:id/contato')
  async registrarContato(
    @Param('id') id: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoComCarteira,
  ): Promise<ContatoRegistradoSaida> {
    const dados = RegistrarContatoDoLeadEntrada.safeParse(corpo)
    if (!dados.success) throw new BadRequestException('Confira os campos do contato.')
    try {
      return await this.servico.registrarContato(req.carteira!.usuarioDeGestao, idDeLead(id), dados.data)
    } catch (e) {
      traduzir(e)
    }
  }

  @Post('leads/:id/arquivar')
  async arquivarLead(@Param('id') id: string, @Req() req: RequisicaoComCarteira): Promise<LeadCriadoSaida> {
    try {
      return { lead: await this.servico.arquivarLead(req.carteira!.usuarioDeGestao, idDeLead(id)) }
    } catch (e) {
      traduzir(e)
    }
  }

  /** Exclusão a pedido do titular (LGPD A37): anonimiza e guarda só o HMAC do telefone. */
  @Post('leads/:id/excluir-a-pedido')
  async excluirAPedido(@Param('id') id: string, @Req() req: RequisicaoComCarteira): Promise<LeadCriadoSaida> {
    try {
      return { lead: await this.servico.excluirAPedido(req.carteira!.usuarioDeGestao, idDeLead(id)) }
    } catch (e) {
      traduzir(e)
    }
  }

  @Get('leads/:id/interacoes')
  async listarInteracoes(
    @Param('id') id: string,
    @Req() req: RequisicaoComCarteira,
  ): Promise<ListaDeInteracoesDoLeadSaida> {
    return { interacoes: await this.servico.listarInteracoes(req.carteira!.usuarioDeGestao, idDeLead(id)) }
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
      return { interacao: await this.servico.criarInteracao(req.carteira!.usuarioDeGestao, idDeLead(id), dados.data) }
    } catch (e) {
      traduzir(e)
    }
  }
}
