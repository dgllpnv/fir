import {
  EntrarNoPainelEntrada,
  type PainelEuSaida,
  TrocarSenhaDoOperadorEntrada,
} from '@fir/contracts'
import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  NotFoundException,
  Post,
  Req,
  Res,
} from '@nestjs/common'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { FilaCheia, RETRY_AFTER_FILA_CHEIA } from '../autenticacao/concorrencia'
import { LimitePorOrigem } from '../autenticacao/limite-por-origem'
import type { RequisicaoComPainel } from './contexto-do-painel'
import { DURACAO_SESSAO_PAINEL_MS, NOME_DO_COOKIE_PAINEL } from './painel.guard'
import {
  CredencialDeOperadorInvalida,
  LimiteDeTentativasDoOperador,
  PainelService,
} from './painel.service'
import { LIMITE_DO_PAINEL } from './limite-do-painel'
import { SoOperador } from './so-operador.decorator'

/** Uma frase só para toda falha de credencial de operador. */
const FRASE = 'Usuário ou senha incorretos.'

/** Quinze minutos — a janela de `limiteExcedido`. */
const RETRY_AFTER_LIMITE_POR_CONTA = 15 * 60

/**
 * O PAINEL. **O segmento de rota é `superadmin`, e a escolha não é
 * estética.**
 *
 * A allowlist do Traefik casa **um segmento de caminho**, e o segmento tem de
 * ser um que nenhuma rota de produto jamais tenha. `painel` **não serve**: é
 * chave de permissão existente (`painel` → `valores`) e é o nome da tela do
 * épico 8 ("Campanhas e painel"). No dia em que `/painel` virasse tela de
 * indicadores, a allowlist a bloquearia para a clínica inteira, e o sintoma
 * seria "a tela de indicadores dá 403 para todo mundo menos para o
 * escritório". `superadmin` não colide com nada e não vai colidir.
 */
@SoOperador()
@Controller('v1/superadmin')
export class PainelController {
  constructor(
    @Inject(PainelService) private readonly painel: PainelService,
    @Inject(LIMITE_DO_PAINEL) private readonly limitePorOrigem: LimitePorOrigem,
  ) {}

  @Post('entrar')
  @HttpCode(HttpStatus.OK)
  async entrar(
    @Body() corpo: unknown,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) res: FastifyReply,
  ): Promise<PainelEuSaida> {
    // Limite POR ORIGEM antes de qualquer trabalho, como em `/v1/entrar`, e
    // mais apertado: o painel tem UM usuário conhecido e a credencial que
    // alcança todas as clínicas. `req.ip`, nunca um cabeçalho lido na mão —
    // ver o comentário em `autenticacao.controller.ts`.
    const origem = req.ip
    if (!this.limitePorOrigem.registrar(origem)) {
      res.header('Retry-After', String(this.limitePorOrigem.esperaEmSegundos(origem)))
      throw new HttpException(
        'Muitas tentativas deste endereço. Espere alguns minutos.',
        HttpStatus.TOO_MANY_REQUESTS,
      )
    }

    const dados = EntrarNoPainelEntrada.safeParse(corpo)
    if (!dados.success) throw new BadRequestException('Confira o usuário e a senha.')

    try {
      const { operador, token } = await this.painel.entrar(dados.data.usuario, dados.data.senha)
      res.setCookie(NOME_DO_COOKIE_PAINEL, token, {
        httpOnly: true,
        secure: true,
        // `strict` e não `lax`: o painel não tem link de entrada vindo de
        // fora, e nada legítimo navega para ele a partir de outro site. O
        // custo de `strict` no produto (um link de e-mail que não leva a
        // pessoa logada) não existe aqui.
        sameSite: 'strict',
        path: '/',
        maxAge: Math.floor(DURACAO_SESSAO_PAINEL_MS / 1000),
      })
      return { operador }
    } catch (e) {
      if (e instanceof LimiteDeTentativasDoOperador) {
        res.header('Retry-After', String(RETRY_AFTER_LIMITE_POR_CONTA))
        throw new HttpException(
          'Muitas tentativas. Espere quinze minutos e tente de novo.',
          HttpStatus.TOO_MANY_REQUESTS,
        )
      }
      if (e instanceof CredencialDeOperadorInvalida) {
        // 401, e não 404: aqui o chamador já sabe que a rota existe — ele
        // acabou de postar nela. Esconder agora não esconderia nada.
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

  /**
   * Liberada pelo `PainelGuard` pela mesma razão que `POST /v1/sair` é
   * `@Publico()`: um cookie expirado precisa poder ser limpo. Protegida, o
   * botão "Sair" deixaria de sair.
   */
  @Post('sair')
  @HttpCode(HttpStatus.NO_CONTENT)
  async sair(
    @Req() req: { cookies?: Record<string, string> },
    @Res({ passthrough: true }) res: FastifyReply,
  ): Promise<void> {
    const token = req.cookies?.[NOME_DO_COOKIE_PAINEL]
    if (token) await this.painel.sair(token)
    res.clearCookie(NOME_DO_COOKIE_PAINEL, { path: '/' })
  }

  /**
   * O operador troca a PRÓPRIA senha — e é a ÚNICA coisa que ele pode fazer
   * enquanto a senha for provisória (ver `PainelGuard`).
   *
   * Três status, e cada um diz uma coisa diferente à tela:
   *  - **400** o corpo não é o corpo desta rota (campo a mais, campo faltando).
   *  - **403** a senha ATUAL não confere. Não é 401: a sessão vale.
   *  - **422** a senha nova não passa na regra, com a mensagem do DOMÍNIO.
   */
  @Post('eu/senha')
  @HttpCode(HttpStatus.NO_CONTENT)
  async trocarSenha(
    @Body() corpo: unknown,
    @Req() req: RequisicaoComPainel & { cookies?: Record<string, string> },
  ): Promise<void> {
    const dados = TrocarSenhaDoOperadorEntrada.safeParse(corpo)
    if (!dados.success) throw new BadRequestException('Informe a senha atual e a nova senha.')

    const contexto = req.painel
    if (!contexto) throw new NotFoundException()
    const token = req.cookies?.[NOME_DO_COOKIE_PAINEL] ?? ''

    const r = await this.painel.trocarAPropriaSenha(
      contexto,
      token,
      dados.data.atual,
      dados.data.nova,
    )
    if (r === 'ok') return
    if (r === 'atual-invalida') throw new ForbiddenException('A senha atual não confere.')
    // A mensagem vem do DOMÍNIO: é a mesma frase que a tela mostra antes do
    // envio, e escrevê-la de novo aqui seria a segunda verdade.
    throw new HttpException(r.mensagem, HttpStatus.UNPROCESSABLE_ENTITY)
  }

  @Get('eu')
  eu(@Req() req: RequisicaoComPainel): PainelEuSaida {
    // `!` seria uma afirmação sem prova: o guard popula `req.painel`, mas um
    // guard mal registrado é exatamente o defeito que se quer ver estourar
    // aqui, e não um `undefined` silencioso atravessando para a resposta.
    const contexto = req.painel
    if (!contexto) throw new NotFoundException()
    return { operador: contexto.operador }
  }
}
