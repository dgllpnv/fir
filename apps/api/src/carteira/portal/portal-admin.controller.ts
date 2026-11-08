import {
  type AcessoDoPortalNaLista,
  type AcessosDoPortalSaida,
  type PreviaDoPortalSaida,
  type UsuarioDoPortalCriadoSaida,
  AlterarAcessoDoPortalEntrada,
  CriarUsuarioDoPortalClienteEntrada,
  CriarUsuarioDoPortalGrupoEntrada,
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
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  Req,
} from '@nestjs/common'
import type { RequisicaoComCarteira } from '../contexto-da-carteira'
import { SoUsuarioDeGestao } from '../so-usuario-de-gestao.decorator'
import type { RequisicaoComPainel } from '../../painel/contexto-do-painel'
import { SoOperador } from '../../painel/so-operador.decorator'
import { ClienteDaPreviaNaoEncontrado, LeituraDoPortalService } from './leitura-do-portal.service'
import {
  AcessoDoPortalNaoEncontrado,
  ClienteCarteiraNaoVisivelParaEsteUsuarioDeGestao,
  GrupoNaoEncontradoParaPortal,
  PortalAdminService,
  SemPermissaoDeValores,
  UsuarioDoPortalJaExiste,
} from './portal-admin.service'

/**
 * `escopo='cliente'` — criado pelo `Usuário de Gestão` responsável (spec
 * §1.3). Vive sob `/v1/carteira`, na sessão da CARTEIRA — não sob
 * `/v1/portal`: quem chama é o `Usuário de Gestão`, nunca o próprio
 * `Usuário do portal` (nunca autoatendimento).
 */
@SoUsuarioDeGestao()
@Controller('v1/carteira/acessos-do-portal')
export class PortalAdminClienteController {
  constructor(@Inject(PortalAdminService) private readonly servico: PortalAdminService) {}

  @Post('usuarios')
  async criar(
    @Body() corpo: unknown,
    @Req() req: RequisicaoComCarteira,
  ): Promise<UsuarioDoPortalCriadoSaida> {
    const dados = CriarUsuarioDoPortalClienteEntrada.safeParse(corpo)
    if (!dados.success) throw new BadRequestException('Confira os campos do usuário do portal.')
    try {
      return await this.servico.criarParaCliente(req.carteira!.usuarioDeGestao, dados.data)
    } catch (e) {
      if (e instanceof ClienteCarteiraNaoVisivelParaEsteUsuarioDeGestao) {
        throw new NotFoundException('Cliente Firmare não encontrado.')
      }
      if (e instanceof UsuarioDoPortalJaExiste) {
        throw new ConflictException('Já existe um usuário do portal com este nome.')
      }
      throw e
    }
  }
}

const NAO_ENCONTRADO = 'Acesso não encontrado.'

/** O `:usuarioId` da rota é um uuid, ou a rota não existe para ele (404, nunca 500). */
function idValido(id: string): string {
  if (!Uuid.safeParse(id).success) throw new NotFoundException(NAO_ENCONTRADO)
  return id
}

function traduzir(e: unknown): never {
  if (e instanceof ClienteCarteiraNaoVisivelParaEsteUsuarioDeGestao || e instanceof ClienteDaPreviaNaoEncontrado) {
    throw new NotFoundException('Cliente Firmare não encontrado.')
  }
  if (e instanceof AcessoDoPortalNaoEncontrado) throw new NotFoundException(NAO_ENCONTRADO)
  if (e instanceof SemPermissaoDeValores) {
    throw new ForbiddenException('Só quem vê valores decide quem do lado da cliente vê cobranças.')
  }
  throw e
}

/**
 * **O ESPAÇO DA CLIENTE, na ficha** (V7, O9, O10; `FG_AREA_CLIENTE`,
 * `fg-supabase.js` L237–276). G8 3D.
 *
 * Tudo sob `clientes/:id`: é por esse `:id` que o `CarteiraGuard` aplica a
 * "minha carteira" (A-3) — cliente alheio responde 404, a mesma resposta de
 * "não existe" — e a tela da rota é `clientes` (`modulos-das-rotas.ts`).
 */
@SoUsuarioDeGestao()
@Controller('v1/carteira/clientes/:id')
export class EspacoDaClienteController {
  constructor(
    @Inject(PortalAdminService) private readonly servico: PortalAdminService,
    @Inject(LeituraDoPortalService) private readonly leitura: LeituraDoPortalService,
  ) {}

  /** "Ver como a cliente" (O9): a mesma seção do portal, redigida pela carteira (appsec A-18). */
  @Get('previa-do-portal')
  async previa(@Param('id') id: string, @Req() req: RequisicaoComCarteira): Promise<PreviaDoPortalSaida> {
    if (!Uuid.safeParse(id).success) throw new NotFoundException('Cliente Firmare não encontrado.')
    try {
      return { cliente: await this.leitura.previa(req.carteira!.usuarioDeGestao, id) }
    } catch (e) {
      traduzir(e)
    }
  }

  @Get('acessos-do-portal')
  async listar(@Param('id') id: string, @Req() req: RequisicaoComCarteira): Promise<AcessosDoPortalSaida> {
    if (!Uuid.safeParse(id).success) throw new NotFoundException('Cliente Firmare não encontrado.')
    try {
      return await this.servico.listarDoCliente(req.carteira!.usuarioDeGestao, id)
    } catch (e) {
      traduzir(e)
    }
  }

  @Post('acessos-do-portal/:usuarioId/nova-senha')
  @HttpCode(HttpStatus.OK)
  async novaSenha(
    @Param('id') id: string,
    @Param('usuarioId') usuarioId: string,
    @Req() req: RequisicaoComCarteira,
  ): Promise<UsuarioDoPortalCriadoSaida> {
    try {
      return await this.servico.novaSenha(req.carteira!.usuarioDeGestao, idValido(id), idValido(usuarioId))
    } catch (e) {
      traduzir(e)
    }
  }

  @Post('acessos-do-portal/:usuarioId/desativar')
  @HttpCode(HttpStatus.NO_CONTENT)
  async desativar(
    @Param('id') id: string,
    @Param('usuarioId') usuarioId: string,
    @Req() req: RequisicaoComCarteira,
  ): Promise<void> {
    try {
      await this.servico.desativar(req.carteira!.usuarioDeGestao, idValido(id), idValido(usuarioId))
    } catch (e) {
      traduzir(e)
    }
  }

  @Patch('acessos-do-portal/:usuarioId')
  async alterar(
    @Param('id') id: string,
    @Param('usuarioId') usuarioId: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoComCarteira,
  ): Promise<{ acesso: AcessoDoPortalNaLista }> {
    const dados = AlterarAcessoDoPortalEntrada.safeParse(corpo)
    if (!dados.success) throw new BadRequestException('Diga se a conta vê valores.')
    try {
      const acesso = await this.servico.alterarVeValores(
        req.carteira!.usuarioDeGestao,
        idValido(id),
        idValido(usuarioId),
        dados.data.veValores,
      )
      return { acesso }
    } catch (e) {
      traduzir(e)
    }
  }
}

/**
 * `escopo='grupo'` — SÓ o `Operador` (spec §1.3: risco estruturalmente
 * maior, primeira vez que um ator do lado do cliente lê mais de uma clínica
 * numa sessão só). Vive sob `/v1/superadmin`, na sessão do PAINEL.
 */
@SoOperador()
@Controller('v1/superadmin/acessos-do-portal')
export class PortalAdminGrupoController {
  constructor(@Inject(PortalAdminService) private readonly servico: PortalAdminService) {}

  @Post('usuarios')
  async criar(
    @Body() corpo: unknown,
    @Req() req: RequisicaoComPainel,
  ): Promise<UsuarioDoPortalCriadoSaida> {
    const dados = CriarUsuarioDoPortalGrupoEntrada.safeParse(corpo)
    if (!dados.success) throw new BadRequestException('Confira os campos do usuário do portal.')
    try {
      return await this.servico.criarParaGrupo(req.painel!.ator, dados.data)
    } catch (e) {
      if (e instanceof GrupoNaoEncontradoParaPortal) throw new NotFoundException('Grupo não encontrado.')
      if (e instanceof UsuarioDoPortalJaExiste) {
        throw new ConflictException('Já existe um usuário do portal com este nome.')
      }
      throw e
    }
  }
}
