import {
  AtualizarCampanhaCarteiraEntrada,
  ConsultaDePeriodoDeCampanhas,
  CriarCampanhaCarteiraEntrada,
  Uuid,
  type CampanhaCarteiraSalvaSaida,
  type CampanhasDoClienteSaida,
  type ComparativoDeCampanhasSaida,
} from '@fir/contracts'
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common'
import type { RequisicaoComCarteira } from '../contexto-da-carteira'
import { SoUsuarioDeGestao } from '../so-usuario-de-gestao.decorator'
import {
  CampanhaCarteiraNaoEncontrada,
  CampanhasCarteiraService,
  CampoDaCampanhaSincronizada,
  ClienteComCampanhasDaClinica,
  ClienteDaCampanhaNaoEncontrado,
  PeriodoInvalido,
} from './campanhas-carteira.service'

/**
 * As rotas das campanhas da carteira (K1–K4, V9). `@SoUsuarioDeGestao()`: o
 * `CarteiraGuard` global exige a sessão da carteira; a RLS por grupo e o
 * filtro da aplicação (`DO_GRUPO` no serviço) fazem o resto.
 *
 * "Não está no seu grupo" e "não existe" são o MESMO 404 — o isolamento nunca
 * aparece como um erro diferente (ADR 0012).
 */
@SoUsuarioDeGestao()
@Controller('v1/carteira')
export class CampanhasCarteiraController {
  constructor(@Inject(CampanhasCarteiraService) private readonly campanhas: CampanhasCarteiraService) {}

  @Get('campanhas')
  async comparativo(
    @Query() query: unknown,
    @Req() req: RequisicaoComCarteira,
  ): Promise<ComparativoDeCampanhasSaida> {
    const consulta = ConsultaDePeriodoDeCampanhas.safeParse(query)
    if (!consulta.success) throw new BadRequestException(consulta.error.issues)
    return traduzir(() => this.campanhas.comparativo(req.carteira!.usuarioDeGestao, consulta.data))
  }

  @Get('clientes/:id/campanhas')
  async doCliente(
    @Param('id') id: string,
    @Query() query: unknown,
    @Req() req: RequisicaoComCarteira,
  ): Promise<CampanhasDoClienteSaida> {
    if (!Uuid.safeParse(id).success) throw new NotFoundException()
    const consulta = ConsultaDePeriodoDeCampanhas.safeParse(query)
    if (!consulta.success) throw new BadRequestException(consulta.error.issues)
    return traduzir(() => this.campanhas.doCliente(req.carteira!.usuarioDeGestao, id, consulta.data))
  }

  @Post('campanhas')
  async criar(@Body() corpo: unknown, @Req() req: RequisicaoComCarteira): Promise<CampanhaCarteiraSalvaSaida> {
    const dados = CriarCampanhaCarteiraEntrada.safeParse(corpo)
    if (!dados.success) throw new BadRequestException(dados.error.issues)
    const campanha = await traduzir(() => this.campanhas.criar(req.carteira!.usuarioDeGestao, dados.data))
    return { campanha }
  }

  @Patch('campanhas/:id')
  async atualizar(
    @Param('id') id: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoComCarteira,
  ): Promise<CampanhaCarteiraSalvaSaida> {
    if (!Uuid.safeParse(id).success) throw new NotFoundException()
    const dados = AtualizarCampanhaCarteiraEntrada.safeParse(corpo)
    if (!dados.success) throw new BadRequestException(dados.error.issues)
    const campanha = await traduzir(() => this.campanhas.atualizar(req.carteira!.usuarioDeGestao, id, dados.data))
    return { campanha }
  }
}

/** Erro do serviço → status HTTP, num lugar só. */
async function traduzir<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (e) {
    if (e instanceof ClienteDaCampanhaNaoEncontrado) throw new NotFoundException('Cliente não encontrado.')
    if (e instanceof CampanhaCarteiraNaoEncontrada) throw new NotFoundException('Campanha não encontrada.')
    if (e instanceof ClienteComCampanhasDaClinica) {
      throw new ConflictException(
        'Este cliente está ligado à Gestão de Rotina: as campanhas vêm da clínica. Lance só o investimento na campanha.',
      )
    }
    if (e instanceof CampoDaCampanhaSincronizada) {
      throw new ConflictException(
        'Campanha sincronizada da clínica: aqui só se lançam o investimento e as observações.',
      )
    }
    if (e instanceof PeriodoInvalido) throw new BadRequestException(e.message)
    throw e
  }
}
