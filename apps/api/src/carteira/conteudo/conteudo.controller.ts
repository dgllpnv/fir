import {
  type BibliotecaSaida,
  CODIGO_CONTAGEM_MUDOU,
  CODIGO_LINHAS_DO_ASANA_INVALIDAS,
  type IdsDoAsanaImportadosSaida,
  type ImportacaoDoAsanaSaida,
  ImportarDoAsanaEntrada,
  type ProblemaDeLinhaDoAsana,
  CODIGO_MOTIVO_DO_DESCOMPARTILHAMENTO,
  type CompartilhamentoMudadoSaida,
  CompartilharTodasEntrada,
  type CompartilharTodasSaida,
  CriarDocumentoEntrada,
  CriarMaterialDaBibliotecaEntrada,
  CriarMaterialDoClienteEntrada,
  type DocumentoSaida,
  type DocumentosDoClienteSaida,
  EditarDocumentoEntrada,
  EditarMaterialDaBibliotecaEntrada,
  EditarMaterialDoClienteEntrada,
  EditarReuniaoEntrada,
  type EnvioDeMaterialSaida,
  type MateriaisDoClienteSaida,
  type MaterialSaida,
  MudarCompartilhamentoEntrada,
  RegistrarEnvioDeMaterialEntrada,
  RegistrarReuniaoEntrada,
  type ReuniaoRegistradaSaida,
  type ReuniaoSaida,
  type ReunioesDoClienteSaida,
  Uuid,
} from '@fir/contracts'
import { LIMITES_DO_ASANA } from '@fir/domain'
import { Body, Controller, Get, HttpCode, HttpException, HttpStatus, Inject, Param, Patch, Post, Req } from '@nestjs/common'
import type { RequisicaoComCarteira } from '../contexto-da-carteira'
import { SoUsuarioDeGestao } from '../so-usuario-de-gestao.decorator'
import {
  ChaveReutilizada,
  ConteudoArquivado,
  ContagemMudou,
  EntradaInvalida,
  MotivoObrigatorio,
  NaoEncontrado,
  ResponsavelInvalido,
  type Sessao,
  SemPermissaoDeAdministrar,
  recusa,
} from './conteudo-comum'
import { DocumentosEMateriaisService } from './documentos-e-materiais.service'
import { ReunioesCarteiraService } from './reunioes.service'

/**
 * Valida na borda. O erro NÃO ecoa o valor recebido (A-21): só o caminho dos
 * campos recusados — o Zod põe o valor recebido no texto de erro de enum, e
 * esse texto não sai daqui.
 */
type Esquema<T> = {
  safeParse(corpo: unknown):
    | { success: true; data: T }
    | { success: false; error: { issues: ReadonlyArray<{ path: ReadonlyArray<string | number> }> } }
}

function validar<T>(schema: Esquema<T>, corpo: unknown): T {
  const r = schema.safeParse(corpo)
  if (r.success) return r.data
  const campos = r.error.issues.map((i) => i.path.join('.') || 'corpo')
  throw recusa(HttpStatus.BAD_REQUEST, 'ENTRADA_INVALIDA', `Revise: ${campos.join(', ')}.`)
}

/**
 * A validação da importação do Asana (A-15): a recusa diz QUAL tarefa (a
 * posição na lista enviada) e QUAL campo, nunca o conteúdo — nem a mensagem
 * do Zod, que pode citar o valor. Nada disto vai para log.
 */
export function validarImportacaoDoAsana(corpo: unknown): ImportarDoAsanaEntrada {
  const r = ImportarDoAsanaEntrada.safeParse(corpo)
  if (r.success) return r.data
  const problemas: ProblemaDeLinhaDoAsana[] = []
  let geral = false
  for (const i of r.error.issues) {
    const [raiz, indice, campo] = i.path
    if (raiz === 'linhas' && typeof indice === 'number') {
      problemas.push({ indice, campo: typeof campo === 'string' ? campo : 'linha' })
    } else geral = true
  }
  const lista = problemas
    .slice(0, 10)
    .map((p) => `tarefa ${p.indice + 1} (${p.campo})`)
    .join(', ')
  const message = geral
    ? `Envie de 1 a ${LIMITES_DO_ASANA.tarefas.toLocaleString('pt-BR')} tarefas, só com id, nome, anotações e data.`
    : `Revise: ${lista}${problemas.length > 10 ? ` e mais ${problemas.length - 10}` : ''}. Nada foi importado.`
  throw new HttpException(
    { statusCode: HttpStatus.BAD_REQUEST, codigo: CODIGO_LINHAS_DO_ASANA_INVALIDAS, message, problemas: problemas.slice(0, 100) },
    HttpStatus.BAD_REQUEST,
  )
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
      throw recusa(HttpStatus.FORBIDDEN, 'SEM_PERMISSAO', 'Só a diretoria da Firmare pode fazer isto.')
    }
    if (e instanceof ConteudoArquivado) throw recusa(HttpStatus.CONFLICT, 'ARQUIVADO', 'Este registro foi arquivado.')
    if (e instanceof ResponsavelInvalido) {
      throw recusa(HttpStatus.BAD_REQUEST, 'RESPONSAVEL_INVALIDO', 'Escolha um responsável ativo da equipe desta cliente.')
    }
    if (e instanceof EntradaInvalida) throw recusa(HttpStatus.BAD_REQUEST, e.codigo, e.message)
    if (e instanceof MotivoObrigatorio) {
      throw recusa(
        HttpStatus.CONFLICT,
        CODIGO_MOTIVO_DO_DESCOMPARTILHAMENTO,
        'A cliente abriu o espaço dela depois que esta ata foi compartilhada. Diga o motivo de deixar só para a equipe.',
      )
    }
    if (e instanceof ContagemMudou) {
      throw recusa(HttpStatus.CONFLICT, CODIGO_CONTAGEM_MUDOU, 'A lista de reuniões mudou. Confira de novo antes de compartilhar.')
    }
    if (e instanceof ChaveReutilizada) {
      throw recusa(HttpStatus.CONFLICT, 'CHAVE_REUTILIZADA', 'Feche o formulário e abra de novo.')
    }
    throw e
  }
}

const sessaoDe = (req: RequisicaoComCarteira): Sessao => req.carteira!.usuarioDeGestao

/**
 * **G8 1B — escrita e leitura de reuniões, documentos e materiais pela
 * equipe Firmare.** `@SoUsuarioDeGestao()`: só a sessão da carteira; o
 * `CarteiraGuard` (global) resolve `req.carteira` a partir do banco.
 *
 * O acesso às atas é registrado pelo serviço (LGPD A14) e não por
 * `@DadoSensivel`: aquele mecanismo grava na trilha da CLÍNICA a partir de
 * `req.contexto`, que a sessão da carteira não tem.
 */
@SoUsuarioDeGestao()
@Controller('v1/carteira')
export class ConteudoCarteiraController {
  constructor(
    @Inject(ReunioesCarteiraService) private readonly reunioes: ReunioesCarteiraService,
    @Inject(DocumentosEMateriaisService) private readonly conteudo: DocumentosEMateriaisService,
  ) {}

  /* ── Reuniões ──────────────────────────────────────────────────────── */

  @Get('clientes/:id/reunioes')
  listarReunioes(@Param('id') clienteId: string, @Req() req: RequisicaoComCarteira): Promise<ReunioesDoClienteSaida> {
    return traduzir(() => this.reunioes.listar(sessaoDe(req), id(clienteId)))
  }

  @Post('clientes/:id/reunioes')
  registrarReuniao(
    @Param('id') clienteId: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoComCarteira,
  ): Promise<ReuniaoRegistradaSaida> {
    const dados = validar(RegistrarReuniaoEntrada, corpo)
    return traduzir(() => this.reunioes.registrar(sessaoDe(req), id(clienteId), dados))
  }

  @Post('clientes/:id/reunioes/compartilhar-todas')
  @HttpCode(200)
  async compartilharTodas(
    @Param('id') clienteId: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoComCarteira,
  ): Promise<CompartilharTodasSaida> {
    const dados = validar(CompartilharTodasEntrada, corpo)
    const compartilhadas = await traduzir(() => this.reunioes.compartilharTodas(sessaoDe(req), id(clienteId), dados))
    return { compartilhadas }
  }

  /** G8 4B: a prévia desabilita o que já tem ata (L1800). */
  @Get('clientes/:id/reunioes/asana-importados')
  idsDoAsanaImportados(@Param('id') clienteId: string, @Req() req: RequisicaoComCarteira): Promise<IdsDoAsanaImportadosSaida> {
    return traduzir(() => this.reunioes.idsDoAsanaImportados(sessaoDe(req), id(clienteId)))
  }

  /** G8 4B: "Importar do Asana". Tudo ou nada; o erro aponta tarefa e campo, nunca o valor (A-15). */
  @Post('clientes/:id/reunioes/importar-asana')
  @HttpCode(200)
  importarDoAsana(
    @Param('id') clienteId: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoComCarteira,
  ): Promise<ImportacaoDoAsanaSaida> {
    const dados = validarImportacaoDoAsana(corpo)
    return traduzir(() => this.reunioes.importarDoAsana(sessaoDe(req), id(clienteId), dados))
  }

  @Patch('reunioes/:id')
  async editarReuniao(
    @Param('id') reuniaoId: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoComCarteira,
  ): Promise<ReuniaoSaida> {
    const dados = validar(EditarReuniaoEntrada, corpo)
    return { reuniao: await traduzir(() => this.reunioes.editar(sessaoDe(req), id(reuniaoId), dados)) }
  }

  @Post('reunioes/:id/compartilhamento')
  @HttpCode(200)
  mudarCompartilhamento(
    @Param('id') reuniaoId: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoComCarteira,
  ): Promise<CompartilhamentoMudadoSaida> {
    const dados = validar(MudarCompartilhamentoEntrada, corpo)
    return traduzir(() => this.reunioes.mudarCompartilhamento(sessaoDe(req), id(reuniaoId), dados))
  }

  @Post('reunioes/:id/arquivar')
  @HttpCode(204)
  async arquivarReuniao(@Param('id') reuniaoId: string, @Req() req: RequisicaoComCarteira): Promise<void> {
    await traduzir(() => this.reunioes.arquivar(sessaoDe(req), id(reuniaoId)))
  }

  /* ── Documentos ────────────────────────────────────────────────────── */

  @Get('clientes/:id/documentos')
  listarDocumentos(
    @Param('id') clienteId: string,
    @Req() req: RequisicaoComCarteira,
  ): Promise<DocumentosDoClienteSaida> {
    return traduzir(() => this.conteudo.listarDocumentos(sessaoDe(req), id(clienteId)))
  }

  @Post('clientes/:id/documentos')
  async criarDocumento(
    @Param('id') clienteId: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoComCarteira,
  ): Promise<DocumentoSaida> {
    const dados = validar(CriarDocumentoEntrada, corpo)
    return { documento: await traduzir(() => this.conteudo.criarDocumento(sessaoDe(req), id(clienteId), dados)) }
  }

  @Patch('documentos/:id')
  async editarDocumento(
    @Param('id') documentoId: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoComCarteira,
  ): Promise<DocumentoSaida> {
    const dados = validar(EditarDocumentoEntrada, corpo)
    return { documento: await traduzir(() => this.conteudo.editarDocumento(sessaoDe(req), id(documentoId), dados)) }
  }

  @Post('documentos/:id/arquivar')
  @HttpCode(204)
  async arquivarDocumento(@Param('id') documentoId: string, @Req() req: RequisicaoComCarteira): Promise<void> {
    await traduzir(() => this.conteudo.arquivarDocumento(sessaoDe(req), id(documentoId)))
  }

  /* ── Materiais do cliente ──────────────────────────────────────────── */

  @Get('clientes/:id/materiais')
  materiaisDoCliente(
    @Param('id') clienteId: string,
    @Req() req: RequisicaoComCarteira,
  ): Promise<MateriaisDoClienteSaida> {
    return traduzir(() => this.conteudo.materiaisDoCliente(sessaoDe(req), id(clienteId)))
  }

  @Post('clientes/:id/materiais')
  async criarMaterialDoCliente(
    @Param('id') clienteId: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoComCarteira,
  ): Promise<MaterialSaida> {
    const dados = validar(CriarMaterialDoClienteEntrada, corpo)
    return {
      material: await traduzir(() => this.conteudo.criarMaterialDoCliente(sessaoDe(req), id(clienteId), dados)),
    }
  }

  @Post('clientes/:id/materiais/envios')
  registrarEnvio(
    @Param('id') clienteId: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoComCarteira,
  ): Promise<EnvioDeMaterialSaida> {
    const dados = validar(RegistrarEnvioDeMaterialEntrada, corpo)
    return traduzir(() => this.conteudo.registrarEnvio(sessaoDe(req), id(clienteId), dados))
  }

  @Patch('materiais/:id')
  async editarMaterialDoCliente(
    @Param('id') materialId: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoComCarteira,
  ): Promise<MaterialSaida> {
    const dados = validar(EditarMaterialDoClienteEntrada, corpo)
    return {
      material: await traduzir(() => this.conteudo.editarMaterialDoCliente(sessaoDe(req), id(materialId), dados)),
    }
  }

  @Post('materiais/:id/arquivar')
  @HttpCode(204)
  async arquivarMaterialDoCliente(@Param('id') materialId: string, @Req() req: RequisicaoComCarteira): Promise<void> {
    await traduzir(() => this.conteudo.arquivarMaterialDoCliente(sessaoDe(req), id(materialId)))
  }

  /* ── Biblioteca geral ──────────────────────────────────────────────── */

  @Get('biblioteca')
  biblioteca(@Req() req: RequisicaoComCarteira): Promise<BibliotecaSaida> {
    return traduzir(() => this.conteudo.biblioteca(sessaoDe(req)))
  }

  @Post('biblioteca')
  async criarNaBiblioteca(@Body() corpo: unknown, @Req() req: RequisicaoComCarteira): Promise<MaterialSaida> {
    const dados = validar(CriarMaterialDaBibliotecaEntrada, corpo)
    return { material: await traduzir(() => this.conteudo.criarNaBiblioteca(sessaoDe(req), dados)) }
  }

  @Patch('biblioteca/:id')
  async editarNaBiblioteca(
    @Param('id') materialId: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoComCarteira,
  ): Promise<MaterialSaida> {
    const dados = validar(EditarMaterialDaBibliotecaEntrada, corpo)
    return { material: await traduzir(() => this.conteudo.editarNaBiblioteca(sessaoDe(req), id(materialId), dados)) }
  }

  @Post('biblioteca/:id/arquivar')
  @HttpCode(204)
  async arquivarNaBiblioteca(@Param('id') materialId: string, @Req() req: RequisicaoComCarteira): Promise<void> {
    await traduzir(() => this.conteudo.arquivarNaBiblioteca(sessaoDe(req), id(materialId)))
  }
}
