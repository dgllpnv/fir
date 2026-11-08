import {
  type AcaoDoPlanoSalvaSaida,
  type AcoesDoPlanoSaida,
  CriarAcaoDoPlanoEntrada,
  EditarAcaoDoPlanoEntrada,
  Uuid,
} from '@fir/contracts'
import { Body, Controller, Get, HttpCode, HttpException, HttpStatus, Inject, Param, Patch, Post, Req } from '@nestjs/common'
import type { RequisicaoComCarteira } from '../contexto-da-carteira'
import { SoUsuarioDeGestao } from '../so-usuario-de-gestao.decorator'
import { AcaoInvalida, AcaoNaoEncontrada, AcoesDoPlanoService } from './acoes-do-plano.service'

const recusa = (status: HttpStatus, codigo: string, message: string): HttpException =>
  new HttpException({ statusCode: status, codigo, message }, status)

type Esquema<T> = {
  safeParse(corpo: unknown):
    | { success: true; data: T }
    | { success: false; error: { issues: ReadonlyArray<{ path: ReadonlyArray<string | number> }> } }
}

/** Valida na borda; o erro não ecoa o valor recebido (A-21), só os campos. */
function validar<T>(schema: Esquema<T>, corpo: unknown): T {
  const r = schema.safeParse(corpo)
  if (r.success) return r.data
  const campos = r.error.issues.map((i) => i.path.join('.') || 'corpo')
  throw recusa(HttpStatus.BAD_REQUEST, 'ENTRADA_INVALIDA', `Revise: ${campos.join(', ')}.`)
}

const id = (bruto: string): string => {
  if (!Uuid.safeParse(bruto).success) throw recusa(HttpStatus.NOT_FOUND, 'NAO_ENCONTRADO', 'Não encontrado.')
  return bruto
}

async function traduzir<T>(f: () => Promise<T>): Promise<T> {
  try {
    return await f()
  } catch (e) {
    if (e instanceof AcaoNaoEncontrada) throw recusa(HttpStatus.NOT_FOUND, 'NAO_ENCONTRADO', 'Não encontrado.')
    if (e instanceof AcaoInvalida) throw recusa(HttpStatus.BAD_REQUEST, e.codigo, e.message)
    throw e
  }
}

/**
 * **`Ação do plano`** (G8 2B, V8). Só `Usuário de Gestão`; o portal não vê
 * ações (o protótipo não as mostra lá, portal L94-173).
 */
@SoUsuarioDeGestao()
@Controller('v1/carteira/clientes/:id/acoes-do-plano')
export class AcoesDoPlanoController {
  constructor(@Inject(AcoesDoPlanoService) private readonly acoes: AcoesDoPlanoService) {}

  @Get()
  listar(@Param('id') clienteId: string, @Req() req: RequisicaoComCarteira): Promise<AcoesDoPlanoSaida> {
    return traduzir(() => this.acoes.listar(req.carteira!.usuarioDeGestao, id(clienteId)))
  }

  @Post()
  async criar(@Param('id') clienteId: string, @Body() corpo: unknown, @Req() req: RequisicaoComCarteira): Promise<AcaoDoPlanoSalvaSaida> {
    const dados = validar(CriarAcaoDoPlanoEntrada, corpo)
    return { acao: await traduzir(() => this.acoes.criar(req.carteira!.usuarioDeGestao, id(clienteId), dados)) }
  }

  @Patch(':acaoId')
  async editar(
    @Param('id') clienteId: string,
    @Param('acaoId') acaoId: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoComCarteira,
  ): Promise<AcaoDoPlanoSalvaSaida> {
    const dados = validar(EditarAcaoDoPlanoEntrada, corpo)
    return { acao: await traduzir(() => this.acoes.editar(req.carteira!.usuarioDeGestao, id(clienteId), id(acaoId), dados)) }
  }

  @Post(':acaoId/alternar')
  @HttpCode(200)
  async alternar(@Param('id') clienteId: string, @Param('acaoId') acaoId: string, @Req() req: RequisicaoComCarteira): Promise<AcaoDoPlanoSalvaSaida> {
    return { acao: await traduzir(() => this.acoes.alternar(req.carteira!.usuarioDeGestao, id(clienteId), id(acaoId))) }
  }

  @Post(':acaoId/arquivar')
  @HttpCode(204)
  async arquivar(@Param('id') clienteId: string, @Param('acaoId') acaoId: string, @Req() req: RequisicaoComCarteira): Promise<void> {
    await traduzir(() => this.acoes.arquivar(req.carteira!.usuarioDeGestao, id(clienteId), id(acaoId)))
  }
}
