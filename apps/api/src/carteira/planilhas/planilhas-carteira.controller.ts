import {
  DefinirPlanilhaDoClienteEntrada,
  JanelaDaPlanilha,
  type PlanilhaDefinidaSaida,
  type PlanilhaDoClienteNaSaida,
} from '@fir/contracts'
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common'
import type { RequisicaoComCarteira } from '../contexto-da-carteira'
import { SoUsuarioDeGestao } from '../so-usuario-de-gestao.decorator'
import {
  ClienteNaoEncontradoParaPlanilha,
  ClienteSemPlanilha,
  LeituraPedidaHaPouco,
  LinkDePlanilhaInvalido,
  PlanilhaDeOutroCliente,
  PlanilhasCarteiraService,
  SemPermissaoParaLinkDaPlanilha,
} from './planilhas-carteira.service'

/**
 * A planilha de indicadores do `Cliente Firmare` (ticket 4A).
 *
 * - `GET  :id/planilha` — situação por frente e semana (`cIndicadoresPlanilha`, `FG_PL_STATUS`).
 * - `PUT  :id/planilha` — grava o link (só o id é usado; A-16).
 * - `POST :id/planilha/ler` — "Ler planilha agora": ENFILEIRA, nunca lê na requisição.
 *
 * Outro grupo é 404, nunca 403: a RLS nem deixa a linha existir para quem
 * pergunta, e dizer "existe, mas não é seu" seria um oráculo de ids.
 */
@SoUsuarioDeGestao()
@Controller('v1/carteira/clientes')
export class PlanilhasCarteiraController {
  constructor(@Inject(PlanilhasCarteiraService) private readonly planilhas: PlanilhasCarteiraService) {}

  @Get(':id/planilha')
  async situacao(
    @Param('id') id: string,
    @Query('semanas') semanas: unknown,
    @Req() req: RequisicaoComCarteira,
  ): Promise<PlanilhaDoClienteNaSaida> {
    const janela = JanelaDaPlanilha.safeParse(semanas)
    if (!janela.success) throw new BadRequestException('Use 8, 13, 26 ou 52 semanas.')
    try {
      return await this.planilhas.situacao(req.carteira!.usuarioDeGestao, id, Number(janela.data))
    } catch (e) {
      throw traduzir(e)
    }
  }

  @Put(':id/planilha')
  async definir(@Param('id') id: string, @Body() corpo: unknown, @Req() req: RequisicaoComCarteira): Promise<PlanilhaDefinidaSaida> {
    const dados = DefinirPlanilhaDoClienteEntrada.safeParse(corpo)
    if (!dados.success) throw new BadRequestException(dados.error.issues[0]?.message ?? 'Link inválido.')
    try {
      return await this.planilhas.definirLink(req.carteira!.usuarioDeGestao, id, dados.data.link)
    } catch (e) {
      throw traduzir(e)
    }
  }

  @Post(':id/planilha/ler')
  @HttpCode(HttpStatus.ACCEPTED)
  async ler(@Param('id') id: string, @Req() req: RequisicaoComCarteira): Promise<{ pedida: true }> {
    try {
      return await this.planilhas.pedirLeitura(req.carteira!.usuarioDeGestao, id)
    } catch (e) {
      throw traduzir(e)
    }
  }
}

function traduzir(e: unknown): unknown {
  if (e instanceof ClienteNaoEncontradoParaPlanilha) return new NotFoundException('Cliente não encontrado.')
  if (e instanceof SemPermissaoParaLinkDaPlanilha) {
    return new ForbiddenException('Só a equipe Firmare com acesso geral grava o link da planilha.')
  }
  if (e instanceof LinkDePlanilhaInvalido) return new BadRequestException(e.message)
  if (e instanceof PlanilhaDeOutroCliente) return new ConflictException('Esta planilha já está ligada a outro cliente.')
  if (e instanceof ClienteSemPlanilha) return new ConflictException('Cadastre o link da planilha primeiro.')
  if (e instanceof LeituraPedidaHaPouco) {
    return new HttpException('A leitura já foi pedida há instantes. Aguarde um minuto.', HttpStatus.TOO_MANY_REQUESTS)
  }
  return e
}
