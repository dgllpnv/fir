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
  UseGuards,
} from '@nestjs/common'
import type { FastifyReply } from 'fastify'
import type { RequisicaoComContexto } from '../comum/contexto.js'
import { AutenticacaoService, CredencialInvalida, LimiteDeTentativas } from './autenticacao.service.js'
import { DURACAO_SESSAO_MS } from './sessao.js'
import { NOME_DO_COOKIE, SessaoGuard } from './sessao.guard.js'

/** Uma frase só para toda falha de credencial. Ver o teste e2e. */
const FRASE = 'E-mail ou senha incorretos.'

@Controller('v1')
export class AutenticacaoController {
  // `@Inject` explícito: ver o comentário em autenticacao.service.ts.
  constructor(@Inject(AutenticacaoService) private readonly auth: AutenticacaoService) {}

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

  @Get('eu')
  @UseGuards(SessaoGuard)
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
