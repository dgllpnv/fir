import {
  type CadastroDoClienteSaida,
  type CarteiraEuDaSessaoSaida,
  type EntrarNaCarteiraSaida,
  type ListaDeClientesDaCarteiraSaida,
  type OpcoesDoCadastroSaida,
  CriarClienteNaCarteiraEntrada,
  EditarCadastroDoClienteEntrada,
  EntrarNaCarteiraEntrada,
  SegundaEtapaDeEntrarNaCarteiraEntrada,
  TrocarSenhaDaCarteiraEntrada,
  Uuid,
} from '@fir/contracts'
import {
  BadRequestException,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  Body,
  Req,
  Res,
} from '@nestjs/common'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { DURACAO_DESAFIO_MS } from '@fir/domain'
import { FilaCheia, RETRY_AFTER_FILA_CHEIA } from '../autenticacao/concorrencia'
import { LimitePorOrigem } from '../autenticacao/limite-por-origem'
import type { RequisicaoComCarteira } from './contexto-da-carteira'
import { DURACAO_SESSAO_CARTEIRA_MS, NOME_DO_COOKIE_CARTEIRA } from './carteira.guard'
import { mensagemDeValidacao, traduzirErroDoBanco, trazCampoDeValor } from './cadastro-do-cliente'
import {
  CarteiraService,
  ChaveDeCriacaoEmUso,
  ClienteDaCarteiraNaoEncontrado,
  CredencialDaCarteiraInvalida,
  GrupoCruzadoNaCriacao,
  GrupoDeCriacaoInvalido,
  LimiteDeTentativasDaCarteira,
  ResponsavelForaDoGrupo,
  SemPermissaoDeEncerrar,
  SemPermissaoDeTrocarResponsavel,
  SemPermissaoDeValoresNaCarteira,
} from './carteira.service'
import { LIMITE_DA_CARTEIRA } from './limite-da-carteira'
import { SoUsuarioDeGestao } from './so-usuario-de-gestao.decorator'
import {
  CodigoDoSegundoFatorInvalido,
  DesafioDaCarteiraInvalido,
  LimiteDoSegundoFator,
  SegundoFatorDaCarteiraService,
} from './segundo-fator/segundo-fator.service'
import { segundoFatorLigado } from './segundo-fator/ligado'

const FRASE = 'Usuário ou senha incorretos.'

/** O cookie do DESAFIO (A-12): não é sessão, nenhuma rota de carteira o lê. */
export const NOME_DO_COOKIE_DESAFIO_DA_CARTEIRA = '__Host-fir-carteira-desafio'
export const CODIGO_DESAFIO_INVALIDO = 'DESAFIO_DA_CARTEIRA_INVALIDO'
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
    @Inject(SegundoFatorDaCarteiraService) private readonly segundoFator: SegundoFatorDaCarteiraService,
  ) {}

  @Post('entrar')
  @HttpCode(HttpStatus.OK)
  async entrar(
    @Body() corpo: unknown,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) res: FastifyReply,
  ): Promise<EntrarNaCarteiraSaida> {
    const origem = req.ip
    if (!this.limitePorOrigem.registrar(origem)) {
      res.header('Retry-After', String(this.limitePorOrigem.esperaEmSegundos(origem)))
      throw new HttpException(
        'Muitas tentativas deste endereço. Espere alguns minutos.',
        HttpStatus.TOO_MANY_REQUESTS,
      )
    }

    // G8 0.6 (A-12): a SEGUNDA etapa vem pela mesma rota — mesmo limite por
    // origem, mesma liberação no `CarteiraGuard` —, com o cookie do desafio.
    // Desligado (ADR 0023), não há segunda etapa: o corpo dela cai no 400 da
    // senha, e nenhum desafio antigo vira sessão.
    const ligado = segundoFatorLigado()
    const segunda = SegundaEtapaDeEntrarNaCarteiraEntrada.safeParse(corpo)
    if (ligado && segunda.success) return this.segundaEtapa(segunda.data, req, res)

    const dados = EntrarNaCarteiraEntrada.safeParse(corpo)
    if (!dados.success) throw new BadRequestException('Confira o usuário e a senha.')

    try {
      const r = await this.carteira.entrar(dados.data.usuario, dados.data.senha)
      if ('desafio' in r) {
        // Nenhuma sessão nasceu: só o desafio, 5 min, num cookie à parte.
        res.setCookie(NOME_DO_COOKIE_DESAFIO_DA_CARTEIRA, r.desafio, {
          httpOnly: true,
          secure: true,
          sameSite: 'strict',
          path: '/',
          maxAge: Math.floor(DURACAO_DESAFIO_MS / 1000),
        })
        return { segundoFatorExigido: true }
      }
      this.gravarSessao(res, r.token)
      // Sessão sem desafio: com o segundo fator ligado, é conta ainda sem
      // TOTP, e só alcança o cadastro; desligado, é a sessão inteira.
      return {
        usuarioDeGestao: r.usuarioDeGestao,
        segundoFator: { ativo: r.segundoFatorAtivo, exigido: ligado },
        avisoDeRecuperacao: null,
      }
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

  /**
   * O desafio + um código (TOTP ou de recuperação) → a sessão.
   *  - **401** `DESAFIO_DA_CARTEIRA_INVALIDO`: sem desafio, vencido, usado, ou
   *    morto por cinco erros — volte à senha.
   *  - **401** código incorreto.
   *  - **429** limite POR CONTA do segundo fator.
   */
  private async segundaEtapa(
    entrada: SegundaEtapaDeEntrarNaCarteiraEntrada,
    req: { cookies?: { [nome: string]: string | undefined } },
    res: FastifyReply,
  ): Promise<EntrarNaCarteiraSaida> {
    const desafio = req.cookies?.[NOME_DO_COOKIE_DESAFIO_DA_CARTEIRA]
    const expirado = () =>
      new HttpException(
        { statusCode: HttpStatus.UNAUTHORIZED, codigo: CODIGO_DESAFIO_INVALIDO, message: 'O tempo para o código acabou. Entre de novo com a senha.' },
        HttpStatus.UNAUTHORIZED,
      )
    if (!desafio) throw expirado()
    try {
      const { token, aviso } = await this.segundoFator.concluirDesafio(desafio, entrada)
      res.clearCookie(NOME_DO_COOKIE_DESAFIO_DA_CARTEIRA, { path: '/' })
      this.gravarSessao(res, token)
      const contexto = await this.carteira.contextoDoToken(token)
      if (!contexto) throw expirado()
      return {
        usuarioDeGestao: contexto.usuarioDeGestao,
        segundoFator: { ativo: true, exigido: true },
        avisoDeRecuperacao: aviso,
      }
    } catch (e) {
      if (e instanceof DesafioDaCarteiraInvalido) {
        res.clearCookie(NOME_DO_COOKIE_DESAFIO_DA_CARTEIRA, { path: '/' })
        throw expirado()
      }
      if (e instanceof CodigoDoSegundoFatorInvalido) throw new HttpException('Código incorreto.', HttpStatus.UNAUTHORIZED)
      if (e instanceof LimiteDoSegundoFator) {
        res.header('Retry-After', String(Math.ceil(e.esperaMs / 1000)))
        throw new HttpException('Muitos códigos errados. Espere um pouco e tente de novo.', HttpStatus.TOO_MANY_REQUESTS)
      }
      throw e
    }
  }

  private gravarSessao(res: FastifyReply, token: string): void {
    res.setCookie(NOME_DO_COOKIE_CARTEIRA, token, {
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      path: '/',
      maxAge: Math.floor(DURACAO_SESSAO_CARTEIRA_MS / 1000),
    })
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

  /**
   * O `Usuário de Gestão` troca a PRÓPRIA senha — uma rota só para a troca
   * voluntária e para a saída obrigatória da provisória (liberada pelo
   * `CarteiraGuard` enquanto ela durar). Mesmos três status da clínica e do
   * painel:
   *  - **400** o corpo não é o corpo desta rota.
   *  - **403** a senha ATUAL não confere. Não é 401: a sessão vale.
   *  - **422** a senha nova não passa na regra, com a mensagem do DOMÍNIO.
   */
  @Post('eu/senha')
  @HttpCode(HttpStatus.NO_CONTENT)
  async trocarSenha(
    @Body() corpo: unknown,
    @Req() req: RequisicaoComCarteira & { cookies?: Record<string, string> },
  ): Promise<void> {
    const dados = TrocarSenhaDaCarteiraEntrada.safeParse(corpo)
    if (!dados.success) throw new BadRequestException('Informe a senha atual e a nova senha.')

    const contexto = req.carteira
    if (!contexto) throw new NotFoundException()
    // O token da sessão ATUAL — a única que sobrevive à troca. É o mesmo
    // cookie que o `CarteiraGuard` acabou de validar.
    const token = req.cookies?.[NOME_DO_COOKIE_CARTEIRA] ?? ''

    const r = await this.carteira.trocarAPropriaSenha(contexto, token, dados.data.atual, dados.data.nova)
    if (r === 'ok') return
    if (r === 'atual-invalida') throw new ForbiddenException('A senha atual não confere.')
    throw new HttpException(r.mensagem, HttpStatus.UNPROCESSABLE_ENTITY)
  }

  @Get('eu')
  async eu(@Req() req: RequisicaoComCarteira): Promise<CarteiraEuDaSessaoSaida> {
    // O guard já recusou (404) se não houver contexto — chegar aqui garante
    // que `req.carteira` existe. `segundoFator` diz à tela se manda para o
    // cadastro (G8 0.6) — só se o servidor o exige (ADR 0023).
    const id = req.carteira!.usuarioDeGestao.id
    const [{ ativo }, contaDoOperador] = await Promise.all([
      this.segundoFator.resumo(id),
      this.carteira.ehContaDoOperador(id),
    ])
    return {
      usuarioDeGestao: req.carteira!.usuarioDeGestao,
      segundoFator: { ativo, exigido: segundoFatorLigado() },
      contaDoOperador,
    }
  }

  @Get('clientes')
  async clientes(@Req() req: RequisicaoComCarteira): Promise<ListaDeClientesDaCarteiraSaida> {
    const clientes = await this.carteira.clientes(req.carteira!.usuarioDeGestao)
    return { clientes }
  }

  /**
   * G8 0.4 — criar um `Cliente Firmare` do zero, sem clínica (D-22 item 4).
   *  - **400** corpo fora do contrato (a mensagem nunca ecoa o valor).
   *  - **403** campo de valor sem `valores` (A-6), ou grupo de outro escopo.
   *  - **409** a chave de criação é de um cliente que esta sessão não vê.
   *  - **422** grupo ausente/inativo para `geral`, ou responsável de fora.
   * Repetir a mesma `chaveDeCriacao` devolve o mesmo cliente (A-20).
   */
  @Post('clientes')
  async criarCliente(@Body() corpo: unknown, @Req() req: RequisicaoComCarteira): Promise<CadastroDoClienteSaida> {
    const dados = CriarClienteNaCarteiraEntrada.safeParse(corpo)
    if (!dados.success) throw new BadRequestException(mensagemDeValidacao(dados.error.issues))
    return this.traduzindo(async () => {
      const r = await this.carteira.criarCliente(req.carteira!.usuarioDeGestao, dados.data, trazCampoDeValor(corpo))
      return { cliente: r.cliente }
    })
  }

  @Get('cadastro/opcoes')
  async opcoesDoCadastro(@Req() req: RequisicaoComCarteira): Promise<OpcoesDoCadastroSaida> {
    return this.carteira.opcoesDoCadastro(req.carteira!.usuarioDeGestao)
  }

  /** O cadastro de UM cliente. 404 idêntico para "não existe" e "é de outro grupo". */
  @Get('clientes/:id')
  async cadastro(@Param('id') id: string, @Req() req: RequisicaoComCarteira): Promise<CadastroDoClienteSaida> {
    if (!Uuid.safeParse(id).success) throw new NotFoundException('Cliente não encontrado.')
    return this.traduzindo(async () => ({ cliente: await this.carteira.cadastro(req.carteira!.usuarioDeGestao, id) }))
  }

  /**
   * Edita o cadastro. Campo ausente = não mexer. Campo de valor presente —
   * mesmo `null` — sem `valores` = 403, e nada é gravado (appsec A-6).
   */
  @Patch('clientes/:id')
  async editarCadastro(
    @Param('id') id: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoComCarteira,
  ): Promise<CadastroDoClienteSaida> {
    if (!Uuid.safeParse(id).success) throw new NotFoundException('Cliente não encontrado.')
    const dados = EditarCadastroDoClienteEntrada.safeParse(corpo)
    if (!dados.success) throw new BadRequestException(mensagemDeValidacao(dados.error.issues))
    return this.traduzindo(async () => ({
      cliente: await this.carteira.editarCadastro(req.carteira!.usuarioDeGestao, id, dados.data, trazCampoDeValor(corpo)),
    }))
  }

  /** As exceções do cadastro → status HTTP, num lugar só. */
  private async traduzindo<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn()
    } catch (e) {
      if (e instanceof ClienteDaCarteiraNaoEncontrado) throw new NotFoundException('Cliente não encontrado.')
      if (e instanceof SemPermissaoDeValoresNaCarteira) {
        throw new ForbiddenException('Mensalidade e pagamento só com a permissão de valores.')
      }
      if (e instanceof SemPermissaoDeEncerrar) {
        throw new ForbiddenException('Encerrar ou reativar um cliente encerrado exige administrar a carteira.')
      }
      if (e instanceof SemPermissaoDeTrocarResponsavel) {
        throw new ForbiddenException('Trocar o responsável exige ver todas as clientes.')
      }
      if (e instanceof GrupoCruzadoNaCriacao) {
        throw new ForbiddenException('Você não pode criar um cliente em outro grupo.')
      }
      if (e instanceof GrupoDeCriacaoInvalido) throw new HttpException(e.mensagem, HttpStatus.UNPROCESSABLE_ENTITY)
      if (e instanceof ResponsavelForaDoGrupo) {
        throw new HttpException(
          'Este responsável não é do grupo do cliente, ou está desativado.',
          HttpStatus.UNPROCESSABLE_ENTITY,
        )
      }
      if (e instanceof ChaveDeCriacaoEmUso) {
        throw new ConflictException('Este formulário já foi usado. Recarregue a página e tente de novo.')
      }
      const traduzido = traduzirErroDoBanco(e)
      if (traduzido) throw new HttpException(traduzido.mensagem, traduzido.status)
      throw e
    }
  }
}
