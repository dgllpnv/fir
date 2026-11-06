import { AtualizarLinksDeAcessoDoClienteEntrada, type LinksDeAcessoDoClienteAtualizadosSaida } from '@fir/contracts'
import { BadRequestException, Body, Controller, Inject, NotFoundException, Param, Patch, Req } from '@nestjs/common'
import type { RequisicaoComCarteira } from './contexto-da-carteira'
import {
  ClienteCarteiraNaoEncontradoParaLinks,
  LinksDeAcessoClienteService,
} from './links-de-acesso-cliente.service'
import { SoUsuarioDeGestao } from './so-usuario-de-gestao.decorator'

/**
 * Edição dos 4 LINKS DE ACESSO de um `Cliente Firmare` pelo `Usuário de
 * Gestão` — ver `AtualizarLinksDeAcessoDoClienteEntrada` em
 * `packages/contracts/src/carteira.ts`.
 */
@SoUsuarioDeGestao()
@Controller('v1/carteira/clientes')
export class LinksDeAcessoClienteController {
  constructor(@Inject(LinksDeAcessoClienteService) private readonly links: LinksDeAcessoClienteService) {}

  @Patch(':id/links-de-acesso')
  async atualizar(
    @Param('id') id: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoComCarteira,
  ): Promise<LinksDeAcessoDoClienteAtualizadosSaida> {
    const dados = AtualizarLinksDeAcessoDoClienteEntrada.safeParse(corpo)
    if (!dados.success) throw new BadRequestException(dados.error.issues)
    try {
      const cliente = await this.links.atualizar(req.carteira!.usuarioDeGestao, id, dados.data)
      return { cliente }
    } catch (e) {
      if (e instanceof ClienteCarteiraNaoEncontradoParaLinks) {
        throw new NotFoundException('Cliente não encontrado.')
      }
      throw e
    }
  }
}
