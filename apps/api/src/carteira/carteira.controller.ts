import {
  type CarteiraEuSaida,
  type ListaDeClientesDaCarteiraSaida,
  EntrarNaCarteiraEntrada,
} from '@fir/contracts'
import {
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Post,
  Body,
  Req,
  Res,
} from '@nestjs/common'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { FilaCheia, RETRY_AFTER_FILA_CHEIA } from '../autenticacao/concorrencia'
import { LimitePorOrigem } from '../autenticacao/limite-por-origem'
import type { RequisicaoComCarteira } from './contexto-da-carteira'
import { DURACAO_SESSAO_CARTEIRA_MS, NOME_DO_COOKIE_CARTEIRA } from './carteira.guard'
import {
  CarteiraService,
  CredencialDaCarteiraInvalida,
  LimiteDeTentativasDaCarteira,
} from './carteira.service'
import { LIMITE_DA_CARTEIRA } from './limite-da-carteira'
import { SoUsuarioDeGestao } from './so-usuario-de-gestao.decorator'

const FRASE = 'Usuário ou senha incorretos.'
const RETRY_AFTER_LIMITE_POR_CONTA = 15 * 60

/**
 * A CARTEIRA COMERCIAL. Segmento `carteira` — não `gestao` (colide com o
 * nome do produto, "Rotinas de Gestão") nem `painel` (já é chave de
 * permissão e nome de tela) — decisão Q5 do grilling, plano de integração
 * Firmare Gestão.
 */
@SoUsuarioDeGestao()
@Controller('v1/carteira')
export class CarteiraController {
  constructor(
    @Inject(CarteiraService) private readonly carteira: CarteiraService,
    @Inject(LIMITE_DA_CARTEIRA) private readonly limitePorOrigem: LimitePorOrigem,
  ) {}

  @Post('entrar')
  @HttpCode(HttpStatus.OK)
  async entrar(
    @Body() corpo: unknown,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) res: FastifyReply,
  ): Promise<CarteiraEuSaida> {
    const origem = req.ip
    if (!this.limitePorOrigem.registrar(origem)) {
      res.header('Retry-After', String(this.limitePorOrigem.esperaEmSegundos(origem)))
      throw new HttpException(
        'Muitas tentativas deste endereço. Espere alguns minutos.',
        HttpStatus.TOO_MANY_REQUESTS,
      )
    }

    const dados = EntrarNaCarteiraEntrada.safeParse(corpo)
    if (!dados.success) throw new BadRequestException('Confira o usuário e a senha.')

    try {
      const { usuarioDeGestao, token } = await this.carteira.entrar(dados.data.usuario, dados.data.senha)
      res.setCookie(NOME_DO_COOKIE_CARTEIRA, token, {
        httpOnly: true,
        secure: true,
        sameSite: 'strict',
        path: '/',
        maxAge: Math.floor(DURACAO_SESSAO_CARTEIRA_MS / 1000),
      })
      return { usuarioDeGestao }
    } catch (e) {
      if (e instanceof LimiteDeTentativasDaCarteira) {
        res.header('Retry-After', String(RETRY_AFTER_LIMITE_POR_CONTA))
        throw new HttpException(
          'Muitas tentativas. Espere quinze minutos e tente de novo.',
          HttpStatus.TOO_MANY_REQUESTS,
        )
      }
      if (e instanceof CredencialDaCarteiraInvalida) {
        throw new HttpException(FRASE, HttpStatus.UNAUTHORIZED)
      }
      if (e instanceof FilaCheia) {
        res.header('Retry-After', String(RETRY_AFTER_FILA_CHEIA))
        throw new HttpException(
          'O serviço está ocupado. Tente de novo em instantes.',
          HttpStatus.SERVICE_UNAVAILABLE,
        )
      }
      throw e
    }
  }

  /** Liberada pelo `CarteiraGuard` — um cookie expirado precisa poder ser limpo. */
  @Post('sair')
  @HttpCode(HttpStatus.NO_CONTENT)
  async sair(
    @Req() req: { cookies?: Record<string, string> },
    @Res({ passthrough: true }) res: FastifyReply,
  ): Promise<void> {
    const token = req.cookies?.[NOME_DO_COOKIE_CARTEIRA]
    if (token) await this.carteira.sair(token)
    res.clearCookie(NOME_DO_COOKIE_CARTEIRA, { path: '/' })
  }

  @Get('eu')
  eu(@Req() req: RequisicaoComCarteira): CarteiraEuSaida {
    // O guard já recusou (404) se não houver contexto — chegar aqui garante
    // que `req.carteira` existe.
    return { usuarioDeGestao: req.carteira!.usuarioDeGestao }
  }

  @Get('clientes')
  async clientes(@Req() req: RequisicaoComCarteira): Promise<ListaDeClientesDaCarteiraSaida> {
    const clientes = await this.carteira.clientes(req.carteira!.usuarioDeGestao)
    return { clientes }
  }
}
