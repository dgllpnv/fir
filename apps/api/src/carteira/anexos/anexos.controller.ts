import {
  type AnexoEnviadoSaida,
  type AnexosCarteiraSaida,
  type AnexosDoPortalSaida,
  type CodigoDeRecusaDeAnexo,
  EnviarAnexoCampos,
  LIMITE_DE_ANEXO_BYTES,
  ListarAnexosConsulta,
  Uuid,
} from '@fir/contracts'
import {
  BadRequestException,
  Body,
  type CallHandler,
  Controller,
  Delete,
  type ExecutionContext,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  type NestInterceptor,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common'
import { FileStreamInterceptor, type MultipartFileStream } from '@nestjs/platform-fastify/multipart'
import type { FastifyReply, FastifyRequest } from 'fastify'
import type { Observable } from 'rxjs'
import type { RequisicaoComCarteira } from '../contexto-da-carteira'
import type { RequisicaoComPortal } from '../portal/contexto-do-portal'
import { SoUsuarioDoPortal } from '../portal/so-usuario-do-portal.decorator'
import { SoUsuarioDeGestao } from '../so-usuario-de-gestao.decorator'
import {
  AnexoGrandeDemais,
  AnexoNaoEncontrado,
  AnexoNaoLiberado,
  AnexosService,
  AnexoTipoNaoAceito,
  type ConteudoDeAnexo,
  CotaDeAnexosCheia,
  DonoDoAnexoNaoEncontrado,
  EnviosDemaisAoMesmoTempo,
} from './anexos.service'
import { cabecalhoDeAnexo } from './tipo-pelos-bytes'

/**
 * Folga para o envelope do multipart (fronteiras, cabeçalhos das partes, os
 * dois campos de texto). 64 KB sobra com larga margem e não deixa passar um
 * arquivo de 20 MB + 1.
 */
const FOLGA_DO_MULTIPART = 64 * 1024

/**
 * PRIMEIRA camada do teto de 20 MB (A-13): o `Content-Length` declarado,
 * antes de um byte do corpo ser lido. As outras duas são o `limits.fileSize`
 * do busboy (no `FileStreamInterceptor`) e a contagem no stream
 * (`lerAteOLimite`) — porque um corpo `chunked` não declara tamanho nenhum.
 */
@Injectable()
export class TetoDoCorpoDoAnexo implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest<FastifyRequest>()
    const declarado = Number(req.headers['content-length'] ?? '0')
    if (Number.isFinite(declarado) && declarado > LIMITE_DE_ANEXO_BYTES + FOLGA_DO_MULTIPART) {
      throw recusa(HttpStatus.PAYLOAD_TOO_LARGE, 'ANEXO_GRANDE_DEMAIS', 'O arquivo passa de 20 MB.')
    }
    return next.handle()
  }
}

function recusa(status: HttpStatus, codigo: CodigoDeRecusaDeAnexo, message: string): HttpException {
  return new HttpException({ statusCode: status, codigo, message }, status)
}

const MENSAGEM_DE_TIPO =
  'Tipo de arquivo não aceito. Use PDF, imagem (PNG, JPEG, WebP, GIF), documento do Office (DOCX, XLSX, PPTX), texto (TXT, CSV, MD) ou vídeo (MP4, WebM) — ou cole um link do Drive.'

/** Erros do serviço → status. Exceção só na borda, num lugar só. */
function traduzir(e: unknown): never {
  if (e instanceof DonoDoAnexoNaoEncontrado || e instanceof AnexoNaoEncontrado) {
    throw new NotFoundException('Anexo não encontrado.')
  }
  if (e instanceof AnexoGrandeDemais) {
    throw recusa(HttpStatus.PAYLOAD_TOO_LARGE, 'ANEXO_GRANDE_DEMAIS', 'O arquivo passa de 20 MB.')
  }
  if (e instanceof AnexoTipoNaoAceito) {
    if (e.motivo === 'vazio') throw recusa(HttpStatus.UNPROCESSABLE_ENTITY, 'ANEXO_VAZIO', 'O arquivo está vazio.')
    throw recusa(HttpStatus.UNSUPPORTED_MEDIA_TYPE, 'ANEXO_TIPO_NAO_ACEITO', MENSAGEM_DE_TIPO)
  }
  if (e instanceof CotaDeAnexosCheia) {
    throw recusa(HttpStatus.INSUFFICIENT_STORAGE, 'ANEXO_COTA_CHEIA', 'O espaço de arquivos deste grupo está cheio.')
  }
  if (e instanceof EnviosDemaisAoMesmoTempo) {
    throw new HttpException('Muitos envios ao mesmo tempo. Tente de novo em instantes.', HttpStatus.SERVICE_UNAVAILABLE)
  }
  if (e instanceof AnexoNaoLiberado) {
    throw e.situacao === 'pendente'
      ? recusa(HttpStatus.CONFLICT, 'ANEXO_EM_VERIFICACAO', 'O arquivo ainda está passando pelo antivírus. Tente em alguns minutos.')
      : recusa(HttpStatus.CONFLICT, 'ANEXO_RECUSADO_PELO_ANTIVIRUS', 'O antivírus recusou este arquivo.')
  }
  // O stream do busboy estoura com `PayloadTooLargeException` (413) do Nest.
  if (e instanceof HttpException && e.getStatus() === HttpStatus.PAYLOAD_TOO_LARGE) {
    throw recusa(HttpStatus.PAYLOAD_TOO_LARGE, 'ANEXO_GRANDE_DEMAIS', 'O arquivo passa de 20 MB.')
  }
  throw e
}

/**
 * Os cabeçalhos de entrega do A-13, iguais para a equipe e para o portal:
 * sempre `attachment` (nunca inline), `nosniff` (o navegador não "adivinha"
 * HTML num PNG), `CSP: sandbox` (se algo ainda assim for renderizado, sem
 * script e sem origem), e nada em cache compartilhado.
 */
function entregar(res: FastifyReply, conteudo: ConteudoDeAnexo): StreamableFile {
  res.header('Content-Type', conteudo.tipo)
  res.header('Content-Disposition', cabecalhoDeAnexo(conteudo.nome))
  res.header('Content-Length', String(conteudo.bytes.length))
  res.header('X-Content-Type-Options', 'nosniff')
  res.header('Content-Security-Policy', "sandbox; default-src 'none'")
  res.header('Cache-Control', 'private, no-store')
  res.header('Cross-Origin-Resource-Policy', 'same-origin')
  return new StreamableFile(conteudo.bytes)
}

function idValido(id: string): string {
  // Um id que não é UUID nunca é anexo de ninguém — 404, e não 400, para não
  // ensinar o formato a quem tateia.
  if (!Uuid.safeParse(id).success) throw new NotFoundException('Anexo não encontrado.')
  return id
}

/**
 * Os anexos pela EQUIPE DA FIRMARE (`Usuário de Gestão`). Isolamento por
 * grupo na RLS e no `WHERE` (ver `AnexosService`).
 */
@SoUsuarioDeGestao()
@Controller('v1/carteira/anexos')
export class AnexosCarteiraController {
  constructor(@Inject(AnexosService) private readonly anexos: AnexosService) {}

  @Get()
  async listar(@Query() consulta: unknown, @Req() req: RequisicaoComCarteira): Promise<AnexosCarteiraSaida> {
    const dados = ListarAnexosConsulta.safeParse(consulta)
    if (!dados.success) throw new BadRequestException('Informe o dono do anexo.')
    const anexos = await this.anexos.listar(req.carteira!.usuarioDeGestao, dados.data.donoTipo, dados.data.donoId)
    return { anexos }
  }

  /**
   * `multipart/form-data`: `donoTipo` e `donoId` ANTES do campo `arquivo`.
   * Um arquivo por envio (o protótipo manda um por vez, `L1690`).
   */
  @Post()
  @UseInterceptors(
    TetoDoCorpoDoAnexo,
    FileStreamInterceptor('arquivo', {
      limits: { fileSize: LIMITE_DE_ANEXO_BYTES, files: 1, fields: 4, fieldSize: 200, parts: 6 },
    }),
  )
  async enviar(
    @Body() corpo: unknown,
    @UploadedFile() arquivo: MultipartFileStream | undefined,
    @Req() req: RequisicaoComCarteira,
  ): Promise<AnexoEnviadoSaida> {
    const campos = EnviarAnexoCampos.safeParse(corpo)
    if (!campos.success) throw new BadRequestException('Informe o dono do anexo antes do arquivo.')
    if (!arquivo) throw new BadRequestException('Envie o arquivo no campo "arquivo".')
    const usuario = req.carteira!.usuarioDeGestao
    try {
      await this.anexos.conferirDono(usuario, campos.data.donoTipo, campos.data.donoId)
      return await this.anexos.enviar(usuario, campos.data.donoTipo, campos.data.donoId, {
        nomeOriginal: arquivo.originalname,
        stream: arquivo.stream,
      })
    } catch (e) {
      traduzir(e)
    }
  }

  @Get(':id/conteudo')
  async conteudo(
    @Param('id') id: string,
    @Req() req: RequisicaoComCarteira,
    @Res({ passthrough: true }) res: FastifyReply,
  ): Promise<StreamableFile> {
    try {
      return entregar(res, await this.anexos.conteudoParaCarteira(req.carteira!.usuarioDeGestao, idValido(id)))
    } catch (e) {
      traduzir(e)
    }
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remover(@Param('id') id: string, @Req() req: RequisicaoComCarteira): Promise<void> {
    try {
      await this.anexos.remover(req.carteira!.usuarioDeGestao, idValido(id))
    } catch (e) {
      traduzir(e)
    }
  }
}

/**
 * Os anexos pelo PORTAL DO GRUPO (`Usuário do portal`). Read-only (ADR 0018
 * §4). Só `limpo` de dono compartilhado; todo o resto é 404.
 */
@SoUsuarioDoPortal()
@Controller('v1/portal/anexos')
export class AnexosDoPortalController {
  constructor(@Inject(AnexosService) private readonly anexos: AnexosService) {}

  @Get()
  async listar(@Query() consulta: unknown, @Req() req: RequisicaoComPortal): Promise<AnexosDoPortalSaida> {
    const dados = ListarAnexosConsulta.safeParse(consulta)
    if (!dados.success) throw new BadRequestException('Informe o dono do anexo.')
    const anexos = await this.anexos.listarParaPortal(
      req.portal!.usuarioDoPortal,
      dados.data.donoTipo,
      dados.data.donoId,
    )
    return { anexos }
  }

  @Get(':id/conteudo')
  async conteudo(
    @Param('id') id: string,
    @Req() req: RequisicaoComPortal,
    @Res({ passthrough: true }) res: FastifyReply,
  ): Promise<StreamableFile> {
    try {
      return entregar(res, await this.anexos.conteudoParaPortal(req.portal!.usuarioDoPortal, idValido(id)))
    } catch (e) {
      traduzir(e)
    }
  }
}
