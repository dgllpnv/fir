import {
  CadastrarMeuEmailEntrada,
  ConsultarLinkEntrada,
  EsqueciSenhaEntrada,
  FRASE_DO_ESQUECI_SENHA,
  UsarLinkEntrada,
  type ConfigDoAcesso,
  type EnvioFeito,
  type EsqueciSenhaSaida,
  type LinkConsultado,
} from '@fir/contracts'
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Post,
  Req,
  Res,
} from '@nestjs/common'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { PISO_DE_RESPOSTA_MS } from '../autenticacao/autenticacao.service'
import { LimitePorOrigem } from '../autenticacao/limite-por-origem'
import { Publico } from '../autorizacao/publico.decorator'
import type { RequisicaoComContexto } from '../comum/contexto'
import { AcessoPorEmailService } from './acesso-por-email.service'
import { LIMITE_ESQUECI_POR_ORIGEM } from './limites'

/** A frase do link que não vale — vencido, usado, invalidado, inexistente ou de pessoa inativa. */
export const FRASE_LINK_INVALIDO = 'Este link não vale mais. Peça um novo.'

const goneLink = () => new HttpException(FRASE_LINK_INVALIDO, HttpStatus.GONE)

/**
 * As rotas do acesso por e-mail (spec 5 e 10). Quatro públicas — e nenhuma
 * devolve dado de clínica a quem não tem o link — e uma da sessão.
 */
@Controller('v1')
export class AcessoPorEmailController {
  // `@Inject` explícito: o esbuild não emite `design:paramtypes`.
  constructor(
    @Inject(AcessoPorEmailService) private readonly acesso: AcessoPorEmailService,
    @Inject(LimitePorOrigem) private readonly limiteDoEntrar: LimitePorOrigem,
    @Inject(LIMITE_ESQUECI_POR_ORIGEM) private readonly limiteDoEsqueci: LimitePorOrigem,
  ) {}

  /** A tela de entrada esconde "Esqueci minha senha" com o envio desligado. Nenhum dado de clínica. */
  @Publico()
  @Get('acesso/config')
  config(): ConfigDoAcesso {
    return { envioDeEmail: this.acesso.ligado }
  }

  /**
   * **Sempre 202 e a mesma frase** (spec 3.5, appsec 11): e-mail com conta,
   * sem conta, clínica inexistente, limite por e-mail e envio desligado. O
   * PISO vale em `finally`, para todos os caminhos — inclusive o 429 da origem,
   * que também é igual para todo mundo. O envio sai depois da resposta.
   */
  @Publico()
  @Post('esqueci-senha')
  @HttpCode(HttpStatus.ACCEPTED)
  async esqueciSenha(
    @Body() corpo: unknown,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) res: FastifyReply,
  ): Promise<EsqueciSenhaSaida> {
    const inicio = performance.now()
    try {
      const origem = req.ip
      if (!this.limiteDoEsqueci.registrar(origem)) {
        res.header('Retry-After', String(this.limiteDoEsqueci.esperaEmSegundos(origem)))
        throw new HttpException(
          'Muitos pedidos deste endereço. Espere uma hora e tente de novo.',
          HttpStatus.TOO_MANY_REQUESTS,
        )
      }
      const dados = EsqueciSenhaEntrada.safeParse(corpo)
      if (!dados.success) {
        throw new BadRequestException(dados.error.issues[0]?.message ?? 'Informe o e-mail.')
      }
      // FORA do relógio da resposta (appsec 11). Com conta, o pedido abre uma
      // transação (link, evento, commit) que mediu de 35 a 127 ms — e passava
      // do piso: o tempo dizia quem tem conta. Agora toda saída faz só o
      // parse, o limite por origem e o piso. Nada que aconteça depois muda o
      // que o cliente vê; o erro não é registrado com o e-mail.
      // E só DEPOIS de a resposta sair (`finish`): começar no meio da espera
      // do piso pôs a transação para competir com o timer do piso, e o caminho
      // "conta" seguia 8 ms mais lento em uma de cinco rodadas.
      const { clinica, email } = dados.data
      const respondida = new Promise<void>((pronto) => {
        res.raw.once('finish', pronto)
        res.raw.once('close', pronto)
      })
      this.acesso.emSegundoPlano(() => this.acesso.pedirRedefinicao(clinica, email), respondida)
      return { mensagem: FRASE_DO_ESQUECI_SENHA }
    } finally {
      const falta = PISO_DE_RESPOSTA_MS - (performance.now() - inicio)
      if (falta > 0) await new Promise((r) => setTimeout(r, falta))
    }
  }

  private conferirOrigem(req: FastifyRequest, res: FastifyReply): void {
    const origem = req.ip
    if (!this.limiteDoEntrar.registrar(origem)) {
      res.header('Retry-After', String(this.limiteDoEntrar.esperaEmSegundos(origem)))
      throw new HttpException(
        'Muitas tentativas deste endereço. Espere alguns minutos.',
        HttpStatus.TOO_MANY_REQUESTS,
      )
    }
  }

  /** Não consome o link (appsec 16). Inválido: 410, a mesma frase para todo motivo. */
  @Publico()
  @Post('link-de-acesso/consultar')
  @HttpCode(HttpStatus.OK)
  async consultar(
    @Body() corpo: unknown,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) res: FastifyReply,
  ): Promise<LinkConsultado> {
    this.conferirOrigem(req, res)
    const dados = ConsultarLinkEntrada.safeParse(corpo)
    if (!dados.success) throw goneLink()
    const r = await this.acesso.consultar(dados.data.token)
    if (r === null) throw goneLink()
    return r
  }

  /**
   * Consome o link. **204 sem `Set-Cookie`** (appsec 8): a pessoa entra
   * depois por `/v1/entrar`, que cria um token novo.
   *
   *  - **410** o link não vale.
   *  - **422** a senha não passa na regra (frase do domínio) ou não veio.
   *  - **400** senha num link de confirmação de e-mail.
   *  - **409** outra pessoa da clínica já confirmou este e-mail.
   */
  @Publico()
  @Post('link-de-acesso/usar')
  @HttpCode(HttpStatus.NO_CONTENT)
  async usar(
    @Body() corpo: unknown,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) res: FastifyReply,
  ): Promise<void> {
    this.conferirOrigem(req, res)
    const dados = UsarLinkEntrada.safeParse(corpo)
    if (!dados.success) {
      throw new BadRequestException(dados.error.issues[0]?.message ?? 'Confira os dados.')
    }
    const r = await this.acesso.usar(dados.data.token, dados.data.senha)
    switch (r.tipo) {
      case 'ok':
        return
      case 'invalido':
        throw goneLink()
      case 'senha-obrigatoria':
        throw new HttpException('Informe a senha nova.', HttpStatus.UNPROCESSABLE_ENTITY)
      case 'senha-fraca':
        throw new HttpException(
          { statusCode: 422, codigo: r.erro.codigo, message: r.erro.mensagem },
          HttpStatus.UNPROCESSABLE_ENTITY,
        )
      case 'senha-proibida':
        throw new BadRequestException('A confirmação de e-mail não leva senha.')
      case 'email-em-uso':
        throw new ConflictException(
          'Este e-mail já é usado por outra pessoa da clínica. Fale com a administradora.',
        )
    }
  }

  /**
   * Cadastrar, trocar ou retirar (`email: null`) o próprio e-mail. Exige a
   * senha atual (403 sem ela), responde **202** e nunca 409 (appsec 1), e
   * **503** com o envio desligado — exceto para retirar, que não manda nada.
   *
   * NÃO é liberada pela guarda da provisória (spec 5): quem está presa pela
   * provisória troca a senha primeiro.
   */
  @Post('eu/email')
  @HttpCode(HttpStatus.ACCEPTED)
  async meuEmail(@Body() corpo: unknown, @Req() req: RequisicaoComContexto): Promise<EnvioFeito> {
    const dados = CadastrarMeuEmailEntrada.safeParse(corpo)
    if (!dados.success) {
      throw new BadRequestException(dados.error.issues[0]?.message ?? 'Informe o e-mail e a senha.')
    }
    return this.acesso.cadastrarMeuEmail(req.contexto!, dados.data.email, dados.data.senha)
  }
}
