import {
  type CadastroDoSegundoFatorSaida,
  type CodigosDeRecuperacaoSaida,
  type SegundoFatorDaCarteiraSaida,
  ConfirmarCadastroDoSegundoFatorEntrada,
  IniciarCadastroDoSegundoFatorEntrada,
  RegenerarCodigosDeRecuperacaoEntrada,
} from '@fir/contracts'
import {
  BadRequestException,
  Body,
  type CanActivate,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common'
import type { FastifyReply } from 'fastify'
import { FilaCheia, RETRY_AFTER_FILA_CHEIA } from '../../autenticacao/concorrencia'
import { NOME_DO_COOKIE_CARTEIRA } from '../carteira.guard'
import type { RequisicaoComCarteira } from '../contexto-da-carteira'
import { SoUsuarioDeGestao } from '../so-usuario-de-gestao.decorator'
import { segundoFatorLigado } from './ligado'
import {
  CadastroDoSegundoFatorExpirado,
  CodigoDoSegundoFatorInvalido,
  LimiteDeSenhaNoSegundoFator,
  LimiteDoSegundoFator,
  SegundoFatorDaCarteiraService,
  SegundoFatorInativo,
  SegundoFatorJaAtivo,
  SenhaNaoConfereNoSegundoFator,
} from './segundo-fator.service'

type Req = RequisicaoComCarteira & { cookies?: Record<string, string> }

/**
 * Com `SEGUNDO_FATOR_CARTEIRA_LIGADO` desligada (ADR 0023), as rotas de
 * cadastro não existem: 404, como uma rota que nunca foi escrita. Roda depois
 * dos `APP_GUARD` — sem sessão, o `CarteiraGuard` já respondeu 404.
 */
@Injectable()
export class SoComSegundoFatorLigado implements CanActivate {
  canActivate(): boolean {
    if (!segundoFatorLigado()) throw new NotFoundException()
    return true
  }
}

/**
 * O segundo fator do PRÓPRIO `Usuário de Gestão` (A-12). Cadastro e
 * confirmação passam pelo `SegundoFatorDaCarteiraGuard` mesmo numa sessão
 * sem segundo fator; a regeneração de códigos, não — ela exige a sessão
 * verificada e, ainda assim, senha e código na hora.
 *
 * Toda resposta que carrega segredo ou código sai com `Cache-Control:
 * no-store`: o segredo não fica num cache de disco do navegador.
 */
@SoUsuarioDeGestao()
@UseGuards(SoComSegundoFatorLigado)
@Controller('v1/carteira/eu/segundo-fator')
export class SegundoFatorDaCarteiraController {
  constructor(@Inject(SegundoFatorDaCarteiraService) private readonly servico: SegundoFatorDaCarteiraService) {}

  @Get()
  async estado(@Req() req: Req): Promise<SegundoFatorDaCarteiraSaida> {
    return this.servico.resumo(req.carteira!.usuarioDeGestao.id)
  }

  /**
   *  - **403** a senha não confere.
   *  - **409** o segundo fator já está ativo (só o Operador reseta).
   *  - **429** limite de senha.
   */
  @Post('cadastro')
  @HttpCode(HttpStatus.OK)
  async iniciar(
    @Body() corpo: unknown,
    @Req() req: Req,
    @Res({ passthrough: true }) res: FastifyReply,
  ): Promise<CadastroDoSegundoFatorSaida> {
    const dados = IniciarCadastroDoSegundoFatorEntrada.safeParse(corpo)
    if (!dados.success) throw new BadRequestException('Informe a sua senha.')
    res.header('Cache-Control', 'no-store')
    return this.traduzindo(res, () => this.servico.iniciarCadastro(req.carteira!.usuarioDeGestao, dados.data.senha))
  }

  /**
   *  - **401** código incorreto (conta no limite POR CONTA).
   *  - **410** o cadastro pendente venceu — comece de novo.
   */
  @Post('confirmar')
  @HttpCode(HttpStatus.OK)
  async confirmar(
    @Body() corpo: unknown,
    @Req() req: Req,
    @Res({ passthrough: true }) res: FastifyReply,
  ): Promise<CodigosDeRecuperacaoSaida> {
    const dados = ConfirmarCadastroDoSegundoFatorEntrada.safeParse(corpo)
    if (!dados.success) throw new BadRequestException('Informe o código de seis dígitos.')
    res.header('Cache-Control', 'no-store')
    const token = req.cookies?.[NOME_DO_COOKIE_CARTEIRA] ?? ''
    return this.traduzindo(res, async () => ({
      codigosDeRecuperacao: await this.servico.confirmarCadastro(req.carteira!.usuarioDeGestao, token, dados.data.codigo),
    }))
  }

  @Post('codigos')
  @HttpCode(HttpStatus.OK)
  async regenerar(
    @Body() corpo: unknown,
    @Req() req: Req,
    @Res({ passthrough: true }) res: FastifyReply,
  ): Promise<CodigosDeRecuperacaoSaida> {
    const dados = RegenerarCodigosDeRecuperacaoEntrada.safeParse(corpo)
    if (!dados.success) throw new BadRequestException('Informe a senha e o código de seis dígitos.')
    res.header('Cache-Control', 'no-store')
    const token = req.cookies?.[NOME_DO_COOKIE_CARTEIRA] ?? ''
    return this.traduzindo(res, async () => ({
      codigosDeRecuperacao: await this.servico.regenerarCodigos(
        req.carteira!.usuarioDeGestao,
        token,
        dados.data.senha,
        dados.data.codigo,
      ),
    }))
  }

  private async traduzindo<T>(res: FastifyReply, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn()
    } catch (e) {
      if (e instanceof SenhaNaoConfereNoSegundoFator) throw new ForbiddenException('A senha não confere.')
      if (e instanceof SegundoFatorJaAtivo) {
        throw new ConflictException('A verificação em duas etapas já está ativa nesta conta.')
      }
      if (e instanceof SegundoFatorInativo) {
        throw new ConflictException('A verificação em duas etapas ainda não está ativa nesta conta.')
      }
      if (e instanceof CadastroDoSegundoFatorExpirado) {
        throw new HttpException('O cadastro expirou. Comece de novo.', HttpStatus.GONE)
      }
      if (e instanceof CodigoDoSegundoFatorInvalido) {
        throw new HttpException('Código incorreto. Confira o horário do celular e tente o próximo.', HttpStatus.UNAUTHORIZED)
      }
      if (e instanceof LimiteDoSegundoFator) {
        res.header('Retry-After', String(Math.ceil(e.esperaMs / 1000)))
        throw new HttpException('Muitos códigos errados. Espere um pouco e tente de novo.', HttpStatus.TOO_MANY_REQUESTS)
      }
      if (e instanceof LimiteDeSenhaNoSegundoFator) {
        res.header('Retry-After', String(15 * 60))
        throw new HttpException('Muitas tentativas. Espere quinze minutos e tente de novo.', HttpStatus.TOO_MANY_REQUESTS)
      }
      if (e instanceof FilaCheia) {
        res.header('Retry-After', String(RETRY_AFTER_FILA_CHEIA))
        throw new HttpException('O serviço está ocupado. Tente de novo em instantes.', HttpStatus.SERVICE_UNAVAILABLE)
      }
      throw e
    }
  }
}
