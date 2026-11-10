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
  RedefinirSenhaDoUsuarioDeGestaoEntrada,
  type SenhaDoUsuarioDeGestaoRedefinida,
  GrupoDaClinicaEntrada,
} from '@fir/contracts'
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  Req,
} from '@nestjs/common'
import { SenhaFraca } from '../pessoas/escrita-de-pessoa'
import type { RequisicaoComPainel } from './contexto-do-painel'
import { mensagemDeValidacao, traduzirErroDoBanco } from '../carteira/cadastro-do-cliente'
import {
  ClienteCarteiraNaoExiste,
  ClienteJaTemClinica,
  ClinicaJaTemClienteFirmare,
  ClinicaOuGrupoNaoExiste,
  ContaDeGestaoDoOperadorFixa,
  ContaDeGestaoDoOperadorSemSenha,
  GrupoDesativado,
  GrupoNaoExiste,
  PainelCarteiraService,
  ClienteComClinicaNaoMudaDeGrupo,
  ClinicaJaEstaNoGrupo,
  ClinicaNaoEstaNoGrupo,
  PagadorNaoSaiDoGrupo,
  GrupoPadraoNaoMuda,
  UsuarioDeGestaoJaExiste,
  UsuarioDeGestaoNaoExiste,
  UsuarioNaoPodeSerDoGrupoPadrao,
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
      if (e instanceof GrupoPadraoNaoMuda) {
        throw new ConflictException('O grupo Firmare é o padrão das clínicas novas: não pode ser desativado.')
      }
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
      // ADR 0024: a conta de gestão do operador acompanha o operador.
      if (e instanceof ContaDeGestaoDoOperadorFixa) {
        throw new ConflictException('Esta é a conta de gestão de um superadmin: perfil e estado acompanham o operador e não se editam aqui.')
      }
      if (e instanceof UsuarioNaoPodeSerDoGrupoPadrao) {
        throw new ConflictException('O grupo Firmare vê todas as clínicas: use o escopo geral, e não um usuário de grupo.')
      }
      throw e
    }
  }

  /**
   * O superadmin redefine a senha de um `Usuário de Gestão` (D-23 item 3),
   * no padrão da clínica (D-18). `senha` opcional: sem ela, o servidor gera
   * e devolve uma vez; com ela, a resposta traz `senhaProvisoria: null`.
   *  - **400** corpo fora do contrato — frase FIXA: nunca ecoa a senha.
   *  - **404** id malformado ou inexistente (a mesma resposta, de propósito).
   *  - **422** a senha escolhida não passa na regra, com a frase do domínio.
   */
  @Post('usuarios-gestao/:id/senha')
  @HttpCode(HttpStatus.OK)
  async redefinirSenhaDoUsuarioDeGestao(
    @Param('id') id: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoComPainel,
  ): Promise<SenhaDoUsuarioDeGestaoRedefinida> {
    if (!Uuid.safeParse(id).success) throw new NotFoundException('Usuário de gestão não encontrado.')
    // `?? {}`: quem não escolhe a senha pode não mandar corpo nenhum.
    const dados = RedefinirSenhaDoUsuarioDeGestaoEntrada.safeParse(corpo ?? {})
    if (!dados.success) throw new BadRequestException('Confira a senha provisória.')
    try {
      return await this.servico.redefinirSenhaDoUsuarioDeGestao(req.painel!.ator, id, dados.data.senha)
    } catch (e) {
      if (e instanceof UsuarioDeGestaoNaoExiste) throw new NotFoundException('Usuário de gestão não encontrado.')
      if (e instanceof SenhaFraca) throw new HttpException(e.message, HttpStatus.UNPROCESSABLE_ENTITY)
      if (e instanceof ContaDeGestaoDoOperadorSemSenha) {
        throw new ConflictException('Esta é a conta de gestão de um superadmin: ela entra pelo painel e não tem senha.')
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
      throw e
    }
  }

  /** 0068: os grupos em que a clínica está. */
  @Get('clinicas/:id/grupos')
  async gruposDaClinica(@Param('id') id: string, @Req() req: RequisicaoComPainel) {
    if (!Uuid.safeParse(id).success) throw new NotFoundException('Clínica não encontrada.')
    return { grupos: await this.servico.gruposDaClinica(req.painel!.ator, id) }
  }

  /** 0068: adiciona a clínica a um grupo (cria o Cliente Firmare vazio dele). */
  @Post('clinicas/:id/grupos')
  async adicionarGrupoDaClinica(@Param('id') id: string, @Body() corpo: unknown, @Req() req: RequisicaoComPainel) {
    if (!Uuid.safeParse(id).success) throw new NotFoundException('Clínica não encontrada.')
    const dados = GrupoDaClinicaEntrada.safeParse(corpo)
    if (!dados.success) throw new BadRequestException(mensagemDeValidacao(dados.error.issues))
    try {
      return await this.servico.adicionarGrupoDaClinica(req.painel!.ator, id, dados.data.grupoId, dados.data.motivo)
    } catch (e) {
      throw traduzirGrupoDaClinica(e)
    }
  }

  /** 0068: remove a clínica de um grupo (o grupo perde a leitura; o dado fica retido). */
  @Post('clinicas/:id/grupos/remover')
  @HttpCode(204)
  async removerGrupoDaClinica(@Param('id') id: string, @Body() corpo: unknown, @Req() req: RequisicaoComPainel): Promise<void> {
    if (!Uuid.safeParse(id).success) throw new NotFoundException('Clínica não encontrada.')
    const dados = GrupoDaClinicaEntrada.safeParse(corpo)
    if (!dados.success) throw new BadRequestException(mensagemDeValidacao(dados.error.issues))
    try {
      await this.servico.removerGrupoDaClinica(req.painel!.ator, id, dados.data.grupoId, dados.data.motivo)
    } catch (e) {
      throw traduzirGrupoDaClinica(e)
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
      if (e instanceof ClienteComClinicaNaoMudaDeGrupo) {
        throw new ConflictException('Este cliente é de uma clínica: para mudar, adicione o novo grupo à clínica e remova o antigo.')
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
      if (e instanceof UsuarioNaoPodeSerDoGrupoPadrao) {
        throw new ConflictException('O grupo Firmare vê todas as clínicas: use o escopo geral, e não um usuário de grupo.')
      }
      throw e
    }
  }
}


const traduzirGrupoDaClinica = (e: unknown): unknown => {
  if (e instanceof ClinicaOuGrupoNaoExiste) return new NotFoundException('Clínica ou grupo não encontrado.')
  if (e instanceof GrupoNaoExiste) return new NotFoundException('Grupo não encontrado.')
  if (e instanceof GrupoDesativado) return new HttpException('Este grupo está desativado.', HttpStatus.UNPROCESSABLE_ENTITY)
  if (e instanceof ClinicaJaEstaNoGrupo) return new ConflictException('A clínica já está neste grupo.')
  if (e instanceof ClinicaNaoEstaNoGrupo) return new ConflictException('A clínica não está neste grupo.')
  if (e instanceof PagadorNaoSaiDoGrupo) {
    return new ConflictException('Este grupo é quem paga pela clínica. Troque o pagador antes de remover.')
  }
  if (e instanceof GrupoPadraoNaoMuda) return new ConflictException('A clínica não sai do grupo Firmare.')
  const x = e as { code?: string; constraint?: string }
  if (x.constraint === 'participacao_motivo_obrigatorio') return new BadRequestException('Informe o motivo.')
  return e
}
