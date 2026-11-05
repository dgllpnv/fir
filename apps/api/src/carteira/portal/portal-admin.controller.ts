import {
  type UsuarioDoPortalCriadoSaida,
  CriarUsuarioDoPortalClienteEntrada,
  CriarUsuarioDoPortalGrupoEntrada,
} from '@fir/contracts'
import { BadRequestException, Body, Controller, ConflictException, Inject, NotFoundException, Post, Req } from '@nestjs/common'
import type { RequisicaoComCarteira } from '../contexto-da-carteira'
import { SoUsuarioDeGestao } from '../so-usuario-de-gestao.decorator'
import type { RequisicaoComPainel } from '../../painel/contexto-do-painel'
import { SoOperador } from '../../painel/so-operador.decorator'
import {
  ClienteCarteiraNaoVisivelParaEsteUsuarioDeGestao,
  GrupoNaoEncontradoParaPortal,
  PortalAdminService,
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
