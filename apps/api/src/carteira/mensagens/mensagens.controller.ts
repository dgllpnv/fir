import {
  ChaveDeModelo,
  CODIGO_MENSAGEM_RESTRITA,
  CODIGO_NAO_CONTATAR,
  type ConfiguracaoDasMensagensSaida,
  CriarModeloDeMensagemEntrada,
  CriarRoteiroComercialEntrada,
  EditarModeloDeMensagemEntrada,
  EditarPagamentoDaCarteiraEntrada,
  EditarRoteiroComercialEntrada,
  type EnvioDeMensagemRegistradoSaida,
  FrenteDoParceiroContrato,
  type MensagemMontadaSaida,
  type ModeloDeMensagemSaida,
  type ModelosDeMensagemSaida,
  MontarMensagemEntrada,
  OposicaoDoParceiroEntrada,
  RegistrarEnvioDeMensagemEntrada,
  type RoteiroComercialSaida,
  type RoteirosComerciaisSaida,
  Uuid,
} from '@fir/contracts'
import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Param, Patch, Post, Put, Req } from '@nestjs/common'
import type { RequisicaoComCarteira } from '../contexto-da-carteira'
import { SoUsuarioDeGestao } from '../so-usuario-de-gestao.decorator'
import {
  ChaveReutilizada,
  EntradaInvalida,
  MensagemRestrita,
  NaoContatar,
  NaoEncontrado,
  type Sessao,
  SemPermissao,
  recusa,
} from './mensagens-comum'
import { MensagensCarteiraService } from './mensagens.service'

type Esquema<T> = {
  safeParse(corpo: unknown):
    | { success: true; data: T }
    | { success: false; error: { issues: ReadonlyArray<{ path: ReadonlyArray<string | number> }> } }
}

/** Valida na borda sem ecoar o valor recebido (A-21) — só o caminho dos campos. */
function validar<T>(schema: Esquema<T>, corpo: unknown): T {
  const r = schema.safeParse(corpo)
  if (r.success) return r.data
  const campos = r.error.issues.map((i) => i.path.join('.') || 'corpo')
  throw recusa(HttpStatus.BAD_REQUEST, 'ENTRADA_INVALIDA', `Revise: ${campos.join(', ')}.`)
}

const naoEncontrado = () => recusa(HttpStatus.NOT_FOUND, 'NAO_ENCONTRADO', 'Não encontrado.')

function parametro<T>(schema: Esquema<T>, bruto: string): T {
  const r = schema.safeParse(bruto)
  if (!r.success) throw naoEncontrado()
  return r.data
}

/** O ponto único de tradução erro de serviço → status. */
async function traduzir<T>(f: () => Promise<T>): Promise<T> {
  try {
    return await f()
  } catch (e) {
    if (e instanceof NaoEncontrado) throw naoEncontrado()
    if (e instanceof SemPermissao) throw recusa(HttpStatus.FORBIDDEN, 'SEM_PERMISSAO', 'Sem permissão para fazer isto.')
    if (e instanceof NaoContatar) {
      throw recusa(HttpStatus.CONFLICT, CODIGO_NAO_CONTATAR, 'Este contato pediu para não receber mensagens da Firmare.')
    }
    if (e instanceof MensagemRestrita) {
      throw recusa(
        HttpStatus.FORBIDDEN,
        CODIGO_MENSAGEM_RESTRITA,
        'Esta mensagem tem valor ou chave Pix. Só quem tem acesso a valores pode enviá-la.',
      )
    }
    if (e instanceof ChaveReutilizada) {
      throw recusa(HttpStatus.CONFLICT, 'CHAVE_REUTILIZADA', 'Feche a mensagem e abra de novo.')
    }
    if (e instanceof EntradaInvalida) throw recusa(HttpStatus.BAD_REQUEST, e.codigo, e.message)
    throw e
  }
}

const sessaoDe = (req: RequisicaoComCarteira): Sessao => req.carteira!.usuarioDeGestao

/**
 * **G8 3A — mensagens prontas e WhatsApp.** `@SoUsuarioDeGestao()`: só a
 * sessão da carteira. Nada aqui recebe texto de mensagem por query string
 * (A-14): montar é `POST`, e o texto volta no corpo.
 */
@SoUsuarioDeGestao()
@Controller('v1/carteira/mensagens')
export class MensagensCarteiraController {
  constructor(@Inject(MensagensCarteiraService) private readonly mensagens: MensagensCarteiraService) {}

  @Get('modelos')
  listarModelos(@Req() req: RequisicaoComCarteira): Promise<ModelosDeMensagemSaida> {
    return traduzir(() => this.mensagens.listarModelos(sessaoDe(req)))
  }

  @Post('modelos')
  async criarModelo(@Body() corpo: unknown, @Req() req: RequisicaoComCarteira): Promise<ModeloDeMensagemSaida> {
    const dados = validar(CriarModeloDeMensagemEntrada, corpo)
    return { modelo: await traduzir(() => this.mensagens.criarModelo(sessaoDe(req), dados)) }
  }

  @Patch('modelos/:chave')
  async editarModelo(
    @Param('chave') chave: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoComCarteira,
  ): Promise<ModeloDeMensagemSaida> {
    const dados = validar(EditarModeloDeMensagemEntrada, corpo)
    const k = parametro(ChaveDeModelo, chave)
    return { modelo: await traduzir(() => this.mensagens.editarModelo(sessaoDe(req), k, dados)) }
  }

  @Get('roteiros')
  listarRoteiros(@Req() req: RequisicaoComCarteira): Promise<RoteirosComerciaisSaida> {
    return traduzir(() => this.mensagens.listarRoteiros(sessaoDe(req)))
  }

  @Post('roteiros')
  async criarRoteiro(@Body() corpo: unknown, @Req() req: RequisicaoComCarteira): Promise<RoteiroComercialSaida> {
    const dados = validar(CriarRoteiroComercialEntrada, corpo)
    return { roteiro: await traduzir(() => this.mensagens.criarRoteiro(sessaoDe(req), dados)) }
  }

  @Patch('roteiros/:id')
  async editarRoteiro(
    @Param('id') id: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoComCarteira,
  ): Promise<RoteiroComercialSaida> {
    const dados = validar(EditarRoteiroComercialEntrada, corpo)
    const rid = parametro(Uuid, id)
    return { roteiro: await traduzir(() => this.mensagens.editarRoteiro(sessaoDe(req), rid, dados)) }
  }

  @Post('roteiros/:id/arquivar')
  @HttpCode(204)
  async arquivarRoteiro(@Param('id') id: string, @Req() req: RequisicaoComCarteira): Promise<void> {
    const rid = parametro(Uuid, id)
    await traduzir(() => this.mensagens.arquivarRoteiro(sessaoDe(req), rid))
  }

  @Get('configuracao')
  lerConfiguracao(@Req() req: RequisicaoComCarteira): Promise<ConfiguracaoDasMensagensSaida> {
    return traduzir(() => this.mensagens.lerConfiguracao(sessaoDe(req)))
  }

  @Put('configuracao/pagamento')
  editarPagamento(@Body() corpo: unknown, @Req() req: RequisicaoComCarteira): Promise<ConfiguracaoDasMensagensSaida> {
    const dados = validar(EditarPagamentoDaCarteiraEntrada, corpo)
    return traduzir(() => this.mensagens.editarPagamento(sessaoDe(req), dados))
  }

  @Post('montar')
  @HttpCode(200)
  montar(@Body() corpo: unknown, @Req() req: RequisicaoComCarteira): Promise<MensagemMontadaSaida> {
    const { destino } = validar(MontarMensagemEntrada, corpo)
    return traduzir(() => this.mensagens.montar(sessaoDe(req), destino))
  }

  @Post('envios')
  @HttpCode(200)
  registrarEnvio(@Body() corpo: unknown, @Req() req: RequisicaoComCarteira): Promise<EnvioDeMensagemRegistradoSaida> {
    const dados = validar(RegistrarEnvioDeMensagemEntrada, corpo)
    return traduzir(() => this.mensagens.registrarEnvio(sessaoDe(req), dados))
  }

  @Post('parceiros/:clienteId/:frente/oposicao')
  @HttpCode(204)
  async oposicaoDoParceiro(
    @Param('clienteId') clienteId: string,
    @Param('frente') frente: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoComCarteira,
  ): Promise<void> {
    const { naoContatar } = validar(OposicaoDoParceiroEntrada, corpo)
    const cid = parametro(Uuid, clienteId)
    const f = parametro(FrenteDoParceiroContrato, frente)
    await traduzir(() => this.mensagens.marcarOposicaoDoParceiro(sessaoDe(req), cid, f, naoContatar))
  }
}
