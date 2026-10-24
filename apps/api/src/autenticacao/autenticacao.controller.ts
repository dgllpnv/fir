import { EntrarEntrada, type EuSaida } from '@fir/contracts'
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common'
import type { FastifyReply } from 'fastify'
import { Publico } from '../autorizacao/publico.decorator'
import type { RequisicaoComContexto } from '../comum/contexto'
import { AutenticacaoService, CredencialInvalida, LimiteDeTentativas } from './autenticacao.service'
import { DURACAO_SESSAO_MS } from './sessao'
import { NOME_DO_COOKIE } from './sessao.guard'

/** Uma frase só para toda falha de credencial. Ver o teste e2e. */
const FRASE = 'E-mail ou senha incorretos.'

@Controller('v1')
export class AutenticacaoController {
  // `@Inject` explícito: ver o comentário em autenticacao.service.ts.
  constructor(@Inject(AutenticacaoService) private readonly auth: AutenticacaoService) {}

  // `@Publico()`: é a rota que CRIA a sessão — exigir sessão aqui seria
  // circular e ninguém entraria nunca.
  @Publico()
  @Post('entrar')
  @HttpCode(HttpStatus.OK)
  async entrar(
    @Body() corpo: unknown,
    @Res({ passthrough: true }) res: FastifyReply,
  ): Promise<EuSaida> {
    const dados = EntrarEntrada.safeParse(corpo)
    if (!dados.success) {
      throw new BadRequestException('Confira a clínica, o e-mail e a senha.')
    }

    try {
      const { eu, token } = await this.auth.entrar(
        dados.data.clinica,
        dados.data.email,
        dados.data.senha,
      )

      // `__Host-` obriga Secure e Path=/, e proíbe Domain. É o prefixo mais
      // restrito que existe — e é por ele que HTTPS deixa de ser opcional:
      // sobre http:// o navegador descarta o cookie e ninguém fica logado.
      res.setCookie(NOME_DO_COOKIE, token, {
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        path: '/',
        maxAge: Math.floor(DURACAO_SESSAO_MS / 1000),
      })
      return eu
    } catch (e) {
      if (e instanceof LimiteDeTentativas) {
        throw new HttpException(
          'Muitas tentativas. Espere quinze minutos e tente de novo.',
          HttpStatus.TOO_MANY_REQUESTS,
        )
      }
      if (e instanceof CredencialInvalida) throw new UnauthorizedException(FRASE)
      throw e
    }
  }

  /**
   * `@Publico()`, decidido e justificado na correção final da branch:
   *
   * 1. A rota age **só** sobre o token que o próprio chamador apresenta no
   *    cookie — `resolver_sessao` descobre a clínica a partir do hash dele, e
   *    o `UPDATE` revoga aquela sessão e nenhuma outra. Quem não tem token
   *    não revoga nada; quem tem já está autenticado por definição.
   * 2. Protegida, um cookie expirado ou já revogado responderia 401 e o
   *    navegador **ficaria com o cookie velho** — o "Sair" deixaria de sair.
   *    O controlador limpa o cookie de qualquer forma, e é isso que a pessoa
   *    no balcão espera do botão.
   * 3. A resposta é 204 sem corpo: não há dado de clínica a vazar, e o
   *    interceptor de redação não tem o que redigir.
   *
   * O risco que sobra é CSRF de logout — um site hostil forçar o logout. O
   * cookie é `SameSite=Lax`, que não acompanha POST de outra origem, e o dano
   * máximo seria "a pessoa entra de novo". Não justifica quebrar o item 2.
   */
  @Publico()
  @Post('sair')
  @HttpCode(HttpStatus.NO_CONTENT)
  async sair(
    @Req() req: { cookies?: Record<string, string> },
    @Res({ passthrough: true }) res: FastifyReply,
  ): Promise<void> {
    const token = req.cookies?.[NOME_DO_COOKIE]
    if (token) await this.auth.sair(token)
    res.clearCookie(NOME_DO_COOKIE, { path: '/' })
  }

  // Sem `@UseGuards(SessaoGuard)`: o guard é global desde a correção final da
  // branch (ver app.module.ts). Repeti-lo aqui faria a autenticação rodar
  // duas vezes — duas resoluções de sessão no banco por requisição.
  @Get('eu')
  eu(@Req() req: RequisicaoComContexto): EuSaida {
    const c = req.contexto!
    return {
      usuario: c.usuario,
      clinica: {
        id: c.clinicaId,
        codigo: c.clinicaCodigo,
        nome: c.clinicaNome,
        fuso: c.clinicaFuso,
      },
      perfis: c.perfis.map((p) => ({
        id: p.id,
        chave: p.chave,
        nome: p.nome,
        perms: [...p.perms],
      })),
    }
  }
}
