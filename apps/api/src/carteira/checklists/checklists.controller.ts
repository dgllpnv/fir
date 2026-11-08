import {
  AplicarChecklistEntrada,
  CadastrarMetasEmAndamentoEntrada,
  type ChecklistAplicadoSaida,
  type ChecklistDoClienteSaida,
  type ChecklistsDoMetodoSaida,
  CriarItemDeModeloEntrada,
  CriarModeloDeChecklistEntrada,
  EditarItemDeModeloEntrada,
  type EntradaDoClienteSaida,
  type ItemDeModeloNaSaida,
  type ItemDeModeloSalvoSaida,
  type MetasEmAndamentoSalvasSaida,
  type ModeloDeChecklistSaida,
  type PassoDaEntradaSaida,
  Uuid,
} from '@fir/contracts'
import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Param, Patch, Post, Req } from '@nestjs/common'
import type { RequisicaoComCarteira } from '../contexto-da-carteira'
import { SoUsuarioDeGestao } from '../so-usuario-de-gestao.decorator'
import { ChecklistDoClienteService } from './checklist-do-cliente.service'
import {
  ClienteSemDataDeEntrada,
  EntradaInvalida,
  MetasJaCadastradas,
  ModeloJaExiste,
  NaoEhClienteExistente,
  NaoEncontrado,
  type Sessao,
  SemPermissaoDeAdministrar,
  TarefaCancelada,
  ValorSemPermissao,
  recusa,
} from './checklists-comum'
import { EntradaDeClienteService } from './entrada-de-cliente.service'
import { ModelosDeChecklistService } from './modelos.service'

type Esquema<T> = {
  safeParse(corpo: unknown):
    | { success: true; data: T }
    | { success: false; error: { issues: ReadonlyArray<{ path: ReadonlyArray<string | number>; message: string }> } }
}

/**
 * Valida na borda. O erro NÃO ecoa o valor recebido (A-21): só o caminho e a
 * mensagem escrita no contrato — e a mensagem de enum do Zod, que traz o
 * valor recebido, é trocada por "valor fora da lista".
 */
function validar<T>(schema: Esquema<T>, corpo: unknown): T {
  const r = schema.safeParse(corpo)
  if (r.success) return r.data
  const partes = r.error.issues.map((i) => {
    const campo = i.path.join('.') || 'corpo'
    const mensagem = /received|expected/i.test(i.message) ? 'valor fora da lista' : i.message
    return `${campo}: ${mensagem}`
  })
  throw recusa(HttpStatus.BAD_REQUEST, 'ENTRADA_INVALIDA', `Revise — ${partes.join('; ')}.`)
}

function id(bruto: string): string {
  if (!Uuid.safeParse(bruto).success) throw recusa(HttpStatus.NOT_FOUND, 'NAO_ENCONTRADO', 'Não encontrado.')
  return bruto
}

/** O ponto único de tradução erro de serviço → status. */
async function traduzir<T>(f: () => Promise<T>): Promise<T> {
  try {
    return await f()
  } catch (e) {
    if (e instanceof NaoEncontrado) throw recusa(HttpStatus.NOT_FOUND, 'NAO_ENCONTRADO', 'Não encontrado.')
    if (e instanceof SemPermissaoDeAdministrar) {
      throw recusa(HttpStatus.FORBIDDEN, 'SEM_PERMISSAO', 'Só a diretoria da Firmare edita os checklists.')
    }
    if (e instanceof ValorSemPermissao) {
      throw recusa(HttpStatus.FORBIDDEN, 'SEM_PERMISSAO_DE_VALORES', 'Meta em R$ só com a permissão de ver valores.')
    }
    if (e instanceof ModeloJaExiste) throw recusa(HttpStatus.CONFLICT, 'MODELO_JA_EXISTE', 'Esse checklist já existe.')
    if (e instanceof ClienteSemDataDeEntrada) {
      throw recusa(HttpStatus.BAD_REQUEST, 'SEM_CLIENTE_DESDE', 'Informe desde quando a cliente é da Firmare.')
    }
    if (e instanceof NaoEhClienteExistente) {
      throw recusa(HttpStatus.CONFLICT, 'NAO_EH_CLIENTE_EXISTENTE', 'Esta cliente não entrou como cliente que já era da Firmare.')
    }
    if (e instanceof MetasJaCadastradas) {
      throw recusa(HttpStatus.CONFLICT, 'METAS_JA_CADASTRADAS', 'As metas em andamento já foram cadastradas. As próximas vão pela tela de metas.')
    }
    if (e instanceof TarefaCancelada) throw recusa(HttpStatus.CONFLICT, 'TAREFA_CANCELADA', 'Esta tarefa foi cancelada na rotina.')
    if (e instanceof EntradaInvalida) throw recusa(HttpStatus.BAD_REQUEST, e.codigo, e.message)
    throw e
  }
}

const sessaoDe = (req: RequisicaoComCarteira): Sessao => req.carteira!.usuarioDeGestao

/**
 * **G8 2C — checklists dos programas e entrada de cliente.**
 * `@SoUsuarioDeGestao()`: só a sessão da carteira; o `CarteiraGuard` global
 * resolve `req.carteira` a partir do banco. Criar o cliente NÃO é daqui: a
 * tela chama `POST /v1/carteira/clientes` (0.4) e depois aplica o checklist
 * por `POST /v1/carteira/clientes/:id/checklist`.
 */
@SoUsuarioDeGestao()
@Controller('v1/carteira')
export class ChecklistsCarteiraController {
  constructor(
    @Inject(ModelosDeChecklistService) private readonly modelos: ModelosDeChecklistService,
    @Inject(ChecklistDoClienteService) private readonly checklist: ChecklistDoClienteService,
    @Inject(EntradaDeClienteService) private readonly entrada: EntradaDeClienteService,
  ) {}

  /* ── Método Firmare · Checklists ─────────────────────────────────────── */

  @Get('metodo/checklists')
  listarModelos(@Req() req: RequisicaoComCarteira): Promise<ChecklistsDoMetodoSaida> {
    return traduzir(() => this.modelos.listar(sessaoDe(req)))
  }

  @Post('metodo/checklists')
  async criarModelo(@Body() corpo: unknown, @Req() req: RequisicaoComCarteira): Promise<ModeloDeChecklistSaida> {
    const dados = validar(CriarModeloDeChecklistEntrada, corpo)
    return { modelo: await traduzir(() => this.modelos.criarModelo(sessaoDe(req), dados)) }
  }

  @Post('metodo/checklists/:id/itens')
  async criarItem(
    @Param('id') modeloId: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoComCarteira,
  ): Promise<{ item: ItemDeModeloNaSaida }> {
    const dados = validar(CriarItemDeModeloEntrada, corpo)
    return { item: await traduzir(() => this.modelos.criarItem(sessaoDe(req), id(modeloId), dados)) }
  }

  @Patch('metodo/checklists/itens/:id')
  editarItem(@Param('id') itemId: string, @Body() corpo: unknown, @Req() req: RequisicaoComCarteira): Promise<ItemDeModeloSalvoSaida> {
    const dados = validar(EditarItemDeModeloEntrada, corpo)
    return traduzir(() => this.modelos.editarItem(sessaoDe(req), id(itemId), dados))
  }

  @Post('metodo/checklists/itens/:id/arquivar')
  @HttpCode(204)
  arquivarItem(@Param('id') itemId: string, @Req() req: RequisicaoComCarteira): Promise<void> {
    return traduzir(() => this.modelos.arquivarItem(sessaoDe(req), id(itemId)))
  }

  /* ── Checklist do contrato ───────────────────────────────────────────── */

  @Get('clientes/:id/checklist')
  lerChecklist(@Param('id') clienteId: string, @Req() req: RequisicaoComCarteira): Promise<ChecklistDoClienteSaida> {
    return traduzir(() => this.checklist.ler(sessaoDe(req), id(clienteId)))
  }

  @Post('clientes/:id/checklist')
  @HttpCode(200)
  aplicar(@Param('id') clienteId: string, @Body() corpo: unknown, @Req() req: RequisicaoComCarteira): Promise<ChecklistAplicadoSaida> {
    const dados = validar(AplicarChecklistEntrada, corpo)
    return traduzir(() => this.checklist.aplicar(sessaoDe(req), id(clienteId), dados))
  }

  @Post('clientes/:id/checklist/:item/concluir')
  @HttpCode(204)
  concluir(@Param('id') clienteId: string, @Param('item') itemId: string, @Req() req: RequisicaoComCarteira): Promise<void> {
    return traduzir(() => this.checklist.mudarStatus(sessaoDe(req), id(clienteId), id(itemId), true))
  }

  @Post('clientes/:id/checklist/:item/reabrir')
  @HttpCode(204)
  reabrir(@Param('id') clienteId: string, @Param('item') itemId: string, @Req() req: RequisicaoComCarteira): Promise<void> {
    return traduzir(() => this.checklist.mudarStatus(sessaoDe(req), id(clienteId), id(itemId), false))
  }

  /* ── Entrada de cliente que já é da Firmare ──────────────────────────── */

  @Get('clientes/:id/entrada')
  lerEntrada(@Param('id') clienteId: string, @Req() req: RequisicaoComCarteira): Promise<EntradaDoClienteSaida> {
    return traduzir(() => this.entrada.ler(sessaoDe(req), id(clienteId)))
  }

  @Post('clientes/:id/entrada/metas')
  @HttpCode(200)
  cadastrarMetas(
    @Param('id') clienteId: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoComCarteira,
  ): Promise<MetasEmAndamentoSalvasSaida> {
    const dados = validar(CadastrarMetasEmAndamentoEntrada, corpo)
    return traduzir(() => this.entrada.cadastrarMetas(sessaoDe(req), id(clienteId), dados))
  }

  @Post('clientes/:id/entrada/metas/depois')
  @HttpCode(200)
  metasDepois(@Param('id') clienteId: string, @Req() req: RequisicaoComCarteira): Promise<PassoDaEntradaSaida> {
    return traduzir(() => this.entrada.metasDepois(sessaoDe(req), id(clienteId)))
  }

  @Post('clientes/:id/entrada/asana/dispensar')
  @HttpCode(200)
  dispensarAsana(@Param('id') clienteId: string, @Req() req: RequisicaoComCarteira): Promise<PassoDaEntradaSaida> {
    return traduzir(() => this.entrada.dispensarAsana(sessaoDe(req), id(clienteId)))
  }
}
