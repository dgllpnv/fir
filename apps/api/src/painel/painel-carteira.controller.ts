import {
  type ClienteCarteiraCriadoSaida,
  type ClienteCarteiraNoPainelSaida,
  type ListaDeClientesCarteiraNoPainelSaida,
  EditarClienteCarteiraNoPainelEntrada,
  Uuid,
  type GrupoCriadoSaida,
  type GrupoNaLista,
  type ListaDeGruposSaida,
  type ListaDeUsuariosDeGestaoSaida,
  type UsuarioDeGestaoCriadoSaida,
  type UsuarioDeGestaoNaLista,
  CriarClienteCarteiraEntrada,
  CriarGrupoEntrada,
  CriarUsuarioDeGestaoEntrada,
  EditarGrupoEntrada,
  EditarUsuarioDeGestaoEntrada,
} from '@fir/contracts'
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  Req,
} from '@nestjs/common'
import type { RequisicaoComPainel } from './contexto-do-painel'
import { mensagemDeValidacao, traduzirErroDoBanco } from '../carteira/cadastro-do-cliente'
import {
  ClienteCarteiraNaoExiste,
  ClienteJaTemClinica,
  ClinicaDeOutroGrupo,
  ClinicaJaTemClienteFirmare,
  ClinicaOuGrupoNaoExiste,
  GrupoDesativado,
  GrupoNaoExiste,
  PainelCarteiraService,
  UsuarioDeGestaoJaExiste,
  UsuarioDeGestaoNaoExiste,
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

  @Patch('grupos/:id')
  async editarGrupo(
    @Param('id') id: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoComPainel,
  ): Promise<{ grupo: GrupoNaLista }> {
    const dados = EditarGrupoEntrada.safeParse(corpo)
    if (!dados.success) throw new BadRequestException('Confira os campos do grupo.')
    try {
      const grupo = await this.servico.editarGrupo(req.painel!.ator, id, dados.data)
      return { grupo }
    } catch (e) {
      if (e instanceof GrupoNaoExiste) throw new NotFoundException('Grupo não encontrado.')
      throw e
    }
  }

  @Get('usuarios-gestao')
  async listarUsuariosDeGestao(): Promise<ListaDeUsuariosDeGestaoSaida> {
    return { usuariosDeGestao: await this.servico.listarUsuariosDeGestao() }
  }

  @Patch('usuarios-gestao/:id')
  async editarUsuarioDeGestao(
    @Param('id') id: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoComPainel,
  ): Promise<{ usuarioDeGestao: UsuarioDeGestaoNaLista }> {
    const dados = EditarUsuarioDeGestaoEntrada.safeParse(corpo)
    if (!dados.success) throw new BadRequestException('Confira os campos do usuário.')
    try {
      const usuarioDeGestao = await this.servico.editarUsuarioDeGestao(
        req.painel!.ator,
        id,
        dados.data,
      )
      return { usuarioDeGestao }
    } catch (e) {
      if (e instanceof UsuarioDeGestaoNaoExiste) {
        throw new NotFoundException('Usuário de gestão não encontrado.')
      }
      throw e
    }
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
      if (e instanceof ClinicaDeOutroGrupo) {
        throw new ConflictException('Esta clínica pertence a outro grupo. Mude o grupo dela antes.')
      }
      throw e
    }
  }

  /** Todos os `Cliente Firmare`, para mostrar quem pertence a cada grupo. */
  @Get('clientes-carteira')
  async listarClientesCarteira(@Req() req: RequisicaoComPainel): Promise<ListaDeClientesCarteiraNoPainelSaida> {
    return { clientes: await this.servico.listarClientesCarteira(req.painel!.ator) }
  }

  /**
   * Status, mensalidade e pagamento, grupo e vínculo com clínica — só o
   * Operador (A-11 itens 5 e 6). Mudar o grupo reescreve as filhas, revoga o
   * portal do cliente e grava o histórico do grupo da clínica.
   */
  @Patch('clientes-carteira/:id')
  async editarClienteCarteira(
    @Param('id') id: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoComPainel,
  ): Promise<ClienteCarteiraNoPainelSaida> {
    if (!Uuid.safeParse(id).success) throw new NotFoundException('Cliente não encontrado.')
    const dados = EditarClienteCarteiraNoPainelEntrada.safeParse(corpo)
    if (!dados.success) throw new BadRequestException(mensagemDeValidacao(dados.error.issues))
    try {
      return { cliente: await this.servico.editarClienteCarteira(req.painel!.ator, id, dados.data) }
    } catch (e) {
      if (e instanceof ClienteCarteiraNaoExiste) throw new NotFoundException('Cliente não encontrado.')
      if (e instanceof GrupoNaoExiste) throw new NotFoundException('Grupo não encontrado.')
      if (e instanceof ClinicaOuGrupoNaoExiste) throw new NotFoundException('Clínica ou grupo não encontrado.')
      if (e instanceof GrupoDesativado) {
        throw new HttpException('Este grupo está desativado.', HttpStatus.UNPROCESSABLE_ENTITY)
      }
      if (e instanceof ClienteJaTemClinica) throw new ConflictException('Este cliente já tem uma clínica.')
      if (e instanceof ClinicaJaTemClienteFirmare) {
        throw new ConflictException('Esta clínica já tem um Cliente Firmare.')
      }
      if (e instanceof ClinicaDeOutroGrupo) {
        throw new ConflictException('Esta clínica pertence a outro grupo. Mude o grupo dela antes.')
      }
      const traduzido = traduzirErroDoBanco(e)
      if (traduzido) throw new HttpException(traduzido.mensagem, traduzido.status)
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
