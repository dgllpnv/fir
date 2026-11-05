import {
  type ClienteCarteiraCriadoSaida,
  type GrupoCriadoSaida,
  type ListaDeGruposSaida,
  type ListaDeUsuariosDeGestaoSaida,
  type UsuarioDeGestaoCriadoSaida,
  CriarClienteCarteiraEntrada,
  CriarGrupoEntrada,
  CriarUsuarioDeGestaoEntrada,
} from '@fir/contracts'
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Post,
  Req,
} from '@nestjs/common'
import type { RequisicaoComPainel } from './contexto-do-painel'
import {
  ClinicaJaTemClienteFirmare,
  ClinicaOuGrupoNaoExiste,
  PainelCarteiraService,
  UsuarioDeGestaoJaExiste,
} from './painel-carteira.service'
import { SoOperador } from './so-operador.decorator'

/**
 * As escritas da carteira que SÓ o `Operador` faz — ADR 0011: nunca convite
 * interno, nunca um `Usuário de Gestão` cria outro. Vivem sob
 * `/v1/superadmin`, na mesma sessão do painel — não sob `/v1/carteira`.
 */
@SoOperador()
@Controller('v1/superadmin')
export class PainelCarteiraController {
  constructor(@Inject(PainelCarteiraService) private readonly servico: PainelCarteiraService) {}

  @Get('grupos')
  async listarGrupos(): Promise<ListaDeGruposSaida> {
    return { grupos: await this.servico.listarGrupos() }
  }

  @Post('grupos')
  async criarGrupo(
    @Body() corpo: unknown,
    @Req() req: RequisicaoComPainel,
  ): Promise<GrupoCriadoSaida> {
    const dados = CriarGrupoEntrada.safeParse(corpo)
    if (!dados.success) throw new BadRequestException('Informe o nome do grupo.')
    const grupo = await this.servico.criarGrupo(req.painel!.ator, dados.data)
    return { grupo }
  }

  @Get('usuarios-gestao')
  async listarUsuariosDeGestao(): Promise<ListaDeUsuariosDeGestaoSaida> {
    return { usuariosDeGestao: await this.servico.listarUsuariosDeGestao() }
  }

  @Post('clientes-carteira')
  async criarClienteCarteira(
    @Body() corpo: unknown,
    @Req() req: RequisicaoComPainel,
  ): Promise<ClienteCarteiraCriadoSaida> {
    const dados = CriarClienteCarteiraEntrada.safeParse(corpo)
    if (!dados.success) throw new BadRequestException('Confira os campos do cliente.')
    try {
      const cliente = await this.servico.criarClienteCarteira(req.painel!.ator, dados.data)
      return { cliente }
    } catch (e) {
      if (e instanceof ClinicaJaTemClienteFirmare) {
        throw new ConflictException('Esta clínica já tem um Cliente Firmare.')
      }
      if (e instanceof ClinicaOuGrupoNaoExiste) {
        throw new NotFoundException('Clínica ou grupo não encontrado.')
      }
      throw e
    }
  }

  @Post('usuarios-gestao')
  async criarUsuarioDeGestao(
    @Body() corpo: unknown,
    @Req() req: RequisicaoComPainel,
  ): Promise<UsuarioDeGestaoCriadoSaida> {
    const dados = CriarUsuarioDeGestaoEntrada.safeParse(corpo)
    if (!dados.success) throw new BadRequestException('Confira os campos do usuário.')
    try {
      return await this.servico.criarUsuarioDeGestao(req.painel!.ator, dados.data)
    } catch (e) {
      if (e instanceof UsuarioDeGestaoJaExiste) {
        throw new ConflictException('Já existe um usuário de gestão com este nome.')
      }
      throw e
    }
  }
}
