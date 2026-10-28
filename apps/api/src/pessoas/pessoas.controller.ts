import { CriarPessoaEntrada, type PessoaCriada, type SenhaRedefinida } from '@fir/contracts'
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  Post,
  Req,
} from '@nestjs/common'
import { Exige } from '../autorizacao/autorizacao.guard'
import type { RequisicaoComContexto } from '../comum/contexto'
import { Uuid } from '@fir/contracts'
import {
  PerfilNaoExiste,
  PessoaNaoExiste,
  PessoasService,
  UsuarioJaExiste,
} from './pessoas.service'

/**
 * **O admin cria pessoa e redefine senha — e nunca vê.**
 *
 * As duas rotas exigem `config` ("Unidades, usuários e acessos"), e o
 * servidor é quem valida: a tela é conveniência (regra 16).
 */
@Controller('v1/pessoas')
export class PessoasController {
  // `@Inject` explícito: o esbuild não emite `design:paramtypes`.
  constructor(@Inject(PessoasService) private readonly pessoas: PessoasService) {}

  @Post()
  @Exige('config')
  @HttpCode(HttpStatus.CREATED)
  async criar(
    @Body() corpo: unknown,
    @Req() req: RequisicaoComContexto,
  ): Promise<PessoaCriada> {
    const dados = CriarPessoaEntrada.safeParse(corpo)
    if (!dados.success) {
      // A mensagem da PRIMEIRA questão: ela é a do domínio quando o problema
      // é o usuário, e é ela que a tela mostra. Uma frase genérica aqui faria
      // o admin adivinhar o que está errado no balcão.
      throw new BadRequestException(
        dados.error.issues[0]?.message ?? 'Confira os dados da pessoa.',
      )
    }

    try {
      return await this.pessoas.criar(req.contexto!, dados.data)
    } catch (e) {
      if (e instanceof UsuarioJaExiste) {
        throw new ConflictException('Esse usuário já existe nesta clínica. Escolha outro.')
      }
      // Perfil de outra clínica, ou perfil que não existe mais. 400 e não 404:
      // o recurso pedido é a PESSOA, e o que está errado é o corpo.
      if (e instanceof PerfilNaoExiste) throw new BadRequestException('Esse perfil não existe.')
      throw e
    }
  }

  /**
   * Redefine a senha de outra pessoa. Corpo vazio **de propósito**: não há o
   * que escolher — nem a senha, nem o prazo. O servidor gera e devolve uma
   * vez.
   */
  @Post(':id/senha')
  @Exige('config')
  @HttpCode(HttpStatus.OK)
  async redefinirSenha(
    @Param('id') id: string,
    @Req() req: RequisicaoComContexto,
  ): Promise<SenhaRedefinida> {
    const pessoaId = Uuid.safeParse(id)
    // Id malformado é 404, nunca 400: responder 400 para um uuid inválido e
    // 404 para um uuid válido inexistente distingue os dois para quem sonda.
    if (!pessoaId.success) throw new NotFoundException('Pessoa não encontrada.')

    try {
      return await this.pessoas.redefinirSenha(req.contexto!, pessoaId.data)
    } catch (e) {
      if (e instanceof PessoaNaoExiste) throw new NotFoundException('Pessoa não encontrada.')
      throw e
    }
  }
}
