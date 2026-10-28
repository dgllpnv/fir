import { EntrarEntrada, type EuSaida } from '@fir/contracts'
import { diaCivil } from '@fir/domain'
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
import type { FastifyReply, FastifyRequest } from 'fastify'
import { Publico } from '../autorizacao/publico.decorator'
import { RELOGIO, type Relogio } from '../comum/relogio'
import type { RequisicaoComContexto } from '../comum/contexto'
import { AutenticacaoService, CredencialInvalida, LimiteDeTentativas } from './autenticacao.service'
import { FilaCheia, RETRY_AFTER_FILA_CHEIA } from './concorrencia'
import { LimitePorOrigem } from './limite-por-origem'
import { DURACAO_SESSAO_MS } from './sessao'
import { NOME_DO_COOKIE } from './sessao.guard'

/**
 * Uma frase só para toda falha de credencial — usuário inexistente, senha
 * errada, clínica inexistente, provisória vencida. Ver o teste e2e.
 *
 * Com o e-mail fora (D-10) ela vale mais, não menos: o nome de usuário é
 * adivinhável, e uma frase que distinga os casos entrega a lista de contas da
 * clínica a quem souber o código dela.
 */
const FRASE = 'Usuário ou senha incorretos.'

/** Quinze minutos — a janela de `limiteExcedido` em sessao.ts. */
const RETRY_AFTER_LIMITE_POR_CONTA = 15 * 60

@Controller('v1')
export class AutenticacaoController {
  // `@Inject` explícito: ver o comentário em autenticacao.service.ts.
  constructor(
    @Inject(AutenticacaoService) private readonly auth: AutenticacaoService,
    @Inject(LimitePorOrigem) private readonly limitePorOrigem: LimitePorOrigem,
    @Inject(RELOGIO) private readonly relogio: Relogio,
  ) {}

  // `@Publico()`: é a rota que CRIA a sessão — exigir sessão aqui seria
  // circular e ninguém entraria nunca.
  @Publico()
  @Post('entrar')
  @HttpCode(HttpStatus.OK)
  async entrar(
    @Body() corpo: unknown,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) res: FastifyReply,
  ): Promise<EuSaida> {
    /**
     * Limite POR ORIGEM, antes de qualquer trabalho — antes do parse, antes
     * da consulta à clínica, antes do Argon2. O limite que já existia conta
     * por `identificador`, e mil usuários distintos atravessam esse limite
     * inteiro: foi o cenário medido na revisão (900 logins, nenhum bloqueio).
     *
     * `req.ip` do Fastify, e NÃO um cabeçalho lido na mão. A diferença
     * importa: atrás do Traefik, `socket.remoteAddress` é o endereço do
     * proxy, e o `X-Forwarded-For` é uma LISTA onde o proxy APENDA o que
     * viu — a entrada mais à esquerda é escrita pelo cliente, que pode
     * inventar um IP diferente por requisição e zerar o limite. Um cabeçalho
     * que o cliente escreve não serve de limite.
     *
     * O que serve é a entrada que o proxy confiável acrescentou, e é
     * exatamente isso que `req.ip` devolve quando o adaptador sobe com
     * `trustProxy` igual ao número de saltos confiáveis (ver `main.ts`,
     * `PROXY_SALTOS_CONFIAVEIS`, padrão 0 = não confiar em cabeçalho nenhum).
     * O padrão é "não confiar" de propósito: confiar por padrão faz um
     * cabeçalho forjado desligar o limite em silêncio, e quem sabe quantos
     * saltos existem é o operador que escreveu o compose.
     */
    const origem = req.ip
    if (!this.limitePorOrigem.registrar(origem)) {
      res.header('Retry-After', String(this.limitePorOrigem.esperaEmSegundos(origem)))
      throw new HttpException(
        'Muitas tentativas deste endereço. Espere alguns minutos.',
        HttpStatus.TOO_MANY_REQUESTS,
      )
    }

    const dados = EntrarEntrada.safeParse(corpo)
    if (!dados.success) {
      throw new BadRequestException('Confira a clínica, o usuário e a senha.')
    }

    try {
      const { eu, token } = await this.auth.entrar(
        dados.data.clinica,
        dados.data.usuario,
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
        res.header('Retry-After', String(RETRY_AFTER_LIMITE_POR_CONTA))
        throw new HttpException(
          'Muitas tentativas. Espere quinze minutos e tente de novo.',
          HttpStatus.TOO_MANY_REQUESTS,
        )
      }
      if (e instanceof CredencialInvalida) throw new UnauthorizedException(FRASE)
      // Fila de verificação de senha cheia: 503 AGORA, com `Retry-After`, em
      // vez de a pessoa esperar os 5 s do `connectionTimeoutMillis` do pool
      // para então receber erro. Falha rápida devolve a máquina para o resto
      // da API — inclusive para `/v1/saude`, que é o que o orquestrador olha
      // antes de reiniciar o container.
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
      // O dia de negócio, do SERVIDOR, no fuso da CLÍNICA (regra 24). Toda
      // tela que precisa saber que dia é hoje lê daqui — o relógio do
      // navegador não decide, e o do servidor web é um terceiro relógio.
      hoje: diaCivil(this.relogio.agora(), c.clinicaFuso),
    }
  }
}
