import {
  type PortalEuSaida,
  type PortalSaida,
  EntrarNoPortalEntrada,
  TrocarSenhaDoPortalEntrada,
} from '@fir/contracts'
import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Post,
  Req,
  Res,
} from '@nestjs/common'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { FilaCheia, RETRY_AFTER_FILA_CHEIA } from '../../autenticacao/concorrencia'
import { LimitePorOrigem } from '../../autenticacao/limite-por-origem'
import type { RequisicaoComPortal } from './contexto-do-portal'
import { LeituraDoPortalService } from './leitura-do-portal.service'
import { LIMITE_DO_PORTAL } from './limite-do-portal'
import { DURACAO_SESSAO_PORTAL_MS, NOME_DO_COOKIE_PORTAL } from './portal.guard'
import { CredencialDoPortalInvalida, LimiteDeTentativasDoPortal, PortalService } from './portal.service'
import { SoUsuarioDoPortal } from './so-usuario-do-portal.decorator'

const FRASE = 'Usuário ou senha incorretos.'
const RETRY_AFTER_LIMITE_POR_CONTA = 15 * 60

/**
 * O PORTAL DO GRUPO. Segmento `portal` — quarto espaço de identidade, ao
 * lado de `superadmin` (painel) e `carteira` (Usuário de Gestão). Spec:
 * `docs/superpowers/plans/g6-spec-portal-do-grupo.md`. ADRs 0017, 0018.
 */
@SoUsuarioDoPortal()
@Controller('v1/portal')
export class PortalController {
  constructor(
    @Inject(PortalService) private readonly portal: PortalService,
    @Inject(LeituraDoPortalService) private readonly leitura: LeituraDoPortalService,
    @Inject(LIMITE_DO_PORTAL) private readonly limitePorOrigem: LimitePorOrigem,
  ) {}

  @Post('entrar')
  @HttpCode(HttpStatus.OK)
  async entrar(
    @Body() corpo: unknown,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) res: FastifyReply,
  ): Promise<PortalEuSaida> {
    const origem = req.ip
    if (!this.limitePorOrigem.registrar(origem)) {
      res.header('Retry-After', String(this.limitePorOrigem.esperaEmSegundos(origem)))
      throw new HttpException(
        'Muitas tentativas deste endereço. Espere alguns minutos.',
        HttpStatus.TOO_MANY_REQUESTS,
      )
    }

    const dados = EntrarNoPortalEntrada.safeParse(corpo)
    if (!dados.success) throw new BadRequestException('Confira o usuário e a senha.')

    try {
      const { usuarioDoPortal, token } = await this.portal.entrar(dados.data.usuario, dados.data.senha)
      res.setCookie(NOME_DO_COOKIE_PORTAL, token, {
        httpOnly: true,
        secure: true,
        sameSite: 'strict',
        path: '/',
        maxAge: Math.floor(DURACAO_SESSAO_PORTAL_MS / 1000),
      })
      return { usuarioDoPortal }
    } catch (e) {
      if (e instanceof LimiteDeTentativasDoPortal) {
        res.header('Retry-After', String(RETRY_AFTER_LIMITE_POR_CONTA))
        throw new HttpException(
          'Muitas tentativas. Espere quinze minutos e tente de novo.',
          HttpStatus.TOO_MANY_REQUESTS,
        )
      }
      if (e instanceof CredencialDoPortalInvalida) {
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

  /** Liberada pelo `PortalGuard` — um cookie expirado precisa poder ser limpo. */
  @Post('sair')
  @HttpCode(HttpStatus.NO_CONTENT)
  async sair(
    @Req() req: { cookies?: Record<string, string> },
    @Res({ passthrough: true }) res: FastifyReply,
  ): Promise<void> {
    const token = req.cookies?.[NOME_DO_COOKIE_PORTAL]
    if (token) await this.portal.sair(token)
    res.clearCookie(NOME_DO_COOKIE_PORTAL, { path: '/' })
  }

  /**
   * O `Usuário do portal` troca a PRÓPRIA senha — saída obrigatória da
   * provisória (liberada pelo `PortalGuard`) e troca voluntária, numa rota
   * só. Mesmos três status da clínica, do painel e da carteira:
   *  - **400** o corpo não é o corpo desta rota.
   *  - **403** a senha ATUAL não confere. Não é 401: a sessão vale.
   *  - **422** a senha nova não passa na regra, com a mensagem do DOMÍNIO.
   */
  @Post('eu/senha')
  @HttpCode(HttpStatus.NO_CONTENT)
  async trocarSenha(
    @Body() corpo: unknown,
    @Req() req: RequisicaoComPortal & { cookies?: Record<string, string> },
  ): Promise<void> {
    const dados = TrocarSenhaDoPortalEntrada.safeParse(corpo)
    if (!dados.success) throw new BadRequestException('Informe a senha atual e a nova senha.')

    const contexto = req.portal
    if (!contexto) throw new NotFoundException()
    const token = req.cookies?.[NOME_DO_COOKIE_PORTAL] ?? ''

    const r = await this.portal.trocarAPropriaSenha(contexto, token, dados.data.atual, dados.data.nova)
    if (r === 'ok') return
    if (r === 'atual-invalida') throw new ForbiddenException('A senha atual não confere.')
    throw new HttpException(r.mensagem, HttpStatus.UNPROCESSABLE_ENTITY)
  }

  @Get('eu')
  eu(@Req() req: RequisicaoComPortal): PortalEuSaida {
    // O guard já recusou (404) se não houver contexto.
    return { usuarioDoPortal: req.portal!.usuarioDoPortal }
  }

  /**
   * O PORTAL DO GRUPO em si: uma seção por `Cliente Firmare` visível (spec
   * §3.1). Grava a trilha de ACESSO por clínica (regra 18, ADR 0017 §5) —
   * ver `LeituraDoPortalService.clientes`.
   */
  @Get('clientes')
  async clientes(@Req() req: RequisicaoComPortal): Promise<PortalSaida> {
    const clientes = await this.leitura.clientes(req.portal!.usuarioDoPortal)
    return { clientes }
  }
}
