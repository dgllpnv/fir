import {
  type AnaliseDoEstoque,
  type ConferenciaDeContagem,
  ConsultaDaAnalise,
  CriarContagem,
  EditarItemEstoque,
  EditarLocalEstoque,
  ImportarItensEstoque,
  type ItemNaLista,
  LerNotaFiscal,
  LigarCodigoItem,
  type ListaDeContagens,
  type ListaDeItens,
  type ListaDeLocais,
  type ListaDeMovimentos,
  type LocalNaLista,
  type NotaLida,
  RegistrarEntradaPelaNota,
  RegistrarMovimento,
  type ResultadoDaContagem,
  type ResultadoDaEntradaPelaNota,
  type ResultadoDaImportacaoDeItens,
  SalvarContagem,
  SalvarItemEstoque,
  SalvarLocalEstoque,
} from '@fir/contracts'
import {
  BadRequestException,
  ForbiddenException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common'
import { Exige } from '../autorizacao/autorizacao.guard'
import type { ContextoDaRequisicao, RequisicaoComContexto } from '../comum/contexto'
import { primeiroErro } from '../tarefas/tarefas.controller'
import { AnaliseService } from './analise.service'
import { ContagensService } from './contagens.service'
import { ImportacaoDeItensService } from './importacao.service'
import { ItensService } from './itens.service'
import { LocaisService } from './locais.service'
import { MovimentosService } from './movimentos.service'
import { NotasService } from './notas.service'

/**
 * O ESTOQUE pela porta HTTP — as quatro primeiras ações do épico 6.
 *
 * **A DIVISÃO DE PERMISSÃO, lida do protótipo e mantida:**
 *
 *  - `estoque` (classe) **lê** e **movimenta**: a enfermagem registra o uso em
 *    paciente, a recepção lança a entrada que chegou. É a operação do dia.
 *  - `estoque.gerir` (no handler, sobrepondo) **cadastra**: item, local,
 *    importação, ajuste e custo. É configuração, e é onde está o dinheiro.
 *
 * O protótipo faz a mesma divisão (`mePode("estoque.gerir")` em
 * `salvarItemEstoque`, `salvarLocalEstoque`, `importarItensEstoque` e no ajuste
 * de `movEstoque`), e `PERMS` já descreve as duas chaves exatamente assim.
 *
 * **O AJUSTE é o caso especial:** ele é um tipo de `movEstoque`, não uma rota
 * própria, e exige `estoque.gerir`. Por isso a checagem dele mora no handler —
 * não há como um `@Exige` por rota distinguir um campo do corpo.
 */
/**
 * O contexto que `ItensService` pede — com o CÓDIGO da clínica.
 *
 * Ele monta a etiqueta QR (`FRMEST:<código>:<id>`), e o código vem do guard,
 * nunca de um `SELECT` em `clinicas`: aquela tabela não tem RLS, e um
 * `LIMIT 1` nela devolve a primeira clínica do banco. Ver a nota em
 * `itens.service.ts`.
 */
const contextoDoItem = (c: ContextoDaRequisicao) => ({
  clinicaId: c.clinicaId,
  ator: c.ator,
  clinicaCodigo: c.clinicaCodigo,
})

@Controller('v1/estoque')
@Exige('estoque')
export class ItensController {
  // `@Inject` explícito: o esbuild não emite `design:paramtypes`.
  constructor(
    @Inject(ItensService) private readonly itens: ItensService,
    @Inject(LocaisService) private readonly locais: LocaisService,
    @Inject(MovimentosService) private readonly movimentos: MovimentosService,
    @Inject(ImportacaoDeItensService) private readonly importacao: ImportacaoDeItensService,
    @Inject(ContagensService) private readonly contagens: ContagensService,
    @Inject(NotasService) private readonly notas: NotasService,
    @Inject(AnaliseService) private readonly analise: AnaliseService,
  ) {}

  /* ── CONTAGEM ──────────────────────────────────────────────────────────── */

  /**
   * As contagens — e as duas rotas de leitura entram em
   * `ROTAS_DE_CONFERENCIA`, nunca em `ROTAS_FORA_DA_CONFERENCIA`.
   *
   * **A classificação das três rotas de leitura de ITEM não vale aqui**, e a
   * nota em `rotas-de-conferencia.ts` avisa exatamente disto: `/v1/estoque`,
   * `/v1/estoque/locais` e `/v1/estoque/movimentos` ficam fora porque a
   * conferência às cegas é sobre o **esperado de quem vai contar**, e nenhuma
   * das três é isso. A contagem É isso.
   *
   * **Permissão `estoque`, não `estoque.gerir`** — deliberado, apesar de
   * `movEstoque` com `tipo: 'contagem'` exigir `estoque.gerir`. Os dois
   * caminhos não são o mesmo poder:
   *
   *  - a contagem pela LISTA é **às cegas**, sai de uma lista que alguém gerou,
   *    e a diferença fica relatada para a gestão ver. É o ritual, e quem o faz
   *    é a enfermagem — exigir `estoque.gerir` aqui mataria o produto.
   *  - `movEstoque` com `contagem` é a gestão **reescrevendo o saldo** num
   *    número à mão, sem lista e sem cegueira. Esse é o que exige a chave.
   *
   * O protótipo não checa permissão em `criarContagem` nem em
   * `salvarContagem`, e a divisão acima é a razão escrita de concordar com ele.
   */
  @Get('contagens')
  async listarContagens(@Req() req: RequisicaoComContexto): Promise<ListaDeContagens> {
    const c = req.contexto!
    return this.contagens.listar({ clinicaId: c.clinicaId, ator: c.ator, fuso: c.clinicaFuso })
  }

  @Post('contagens')
  @HttpCode(HttpStatus.CREATED)
  async criarContagem(
    @Body() corpo: unknown,
    @Req() req: RequisicaoComContexto,
  ): Promise<ResultadoDaContagem> {
    const dados = CriarContagem.safeParse(corpo)
    if (!dados.success) throw new BadRequestException(primeiroErro(dados.error))
    const c = req.contexto!
    return this.contagens.criar(
      { clinicaId: c.clinicaId, ator: c.ator, fuso: c.clinicaFuso },
      dados.data,
    )
  }

  @Get('contagens/:id')
  async verContagem(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: RequisicaoComContexto,
  ): Promise<ConferenciaDeContagem> {
    const c = req.contexto!
    return this.contagens.ver({ clinicaId: c.clinicaId, ator: c.ator, fuso: c.clinicaFuso }, id)
  }

  /**
   * `PUT` e não `POST`: salvar o rascunho é **idempotente** — mandar as mesmas
   * quantidades duas vezes deixa a contagem no mesmo estado. É o que torna
   * seguro o "Salvar e continuar depois" de uma conexão ruim no corredor da
   * geladeira.
   */
  @Put('contagens/:id')
  async salvarContagem(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoComContexto,
  ): Promise<ResultadoDaContagem> {
    const dados = SalvarContagem.safeParse(corpo)
    if (!dados.success) throw new BadRequestException(primeiroErro(dados.error))
    const c = req.contexto!
    return this.contagens.salvar(
      { clinicaId: c.clinicaId, ator: c.ator, fuso: c.clinicaFuso },
      id,
      dados.data,
    )
  }

  /* ── ANÁLISE ───────────────────────────────────────────────────────────── */

  /**
   * A análise do período — **só de contagens já concluídas**.
   *
   * Ela devolve `esperadoEmEstoque`, e isso não viola a regra 14: o esperado de
   * uma contagem FECHADA não pode mais influenciar quem conta. É a mesma
   * classificação de `GET /v1/caixa/ultimos`. Por construção ela não alcança
   * rascunho: `analiseDoPeriodo` só olha movimento de `contagem`, e um rascunho
   * aberto não gerou movimento nenhum.
   */
  @Get('analise')
  async verAnalise(
    @Req() req: RequisicaoComContexto,
    @Query() consulta: unknown,
  ): Promise<AnaliseDoEstoque> {
    const dados = ConsultaDaAnalise.safeParse(consulta ?? {})
    if (!dados.success) throw new BadRequestException(primeiroErro(dados.error))
    const c = req.contexto!
    return this.analise.doPeriodo(
      { clinicaId: c.clinicaId, ator: c.ator, fuso: c.clinicaFuso },
      dados.data,
    )
  }

  /* ── NOTA FISCAL ───────────────────────────────────────────────────────── */

  /**
   * Lê o XML e sugere o casamento. **Não grava nada** (regra 27: conciliação
   * sugere, nunca sobrescreve).
   *
   * `POST` porque o XML vai no CORPO — uma nota tem quilobytes, e nenhum deles
   * cabe numa query string. A rota não escreve, e por isso não aparece na
   * varredura de rotas `GET` da conferência às cegas; ela também não tem o que
   * vazar, porque uma nota de compra não é agregado de dia nenhum.
   */
  @Post('notas/ler')
  @Exige('estoque.gerir')
  @HttpCode(HttpStatus.OK)
  async lerNota(@Body() corpo: unknown, @Req() req: RequisicaoComContexto): Promise<NotaLida> {
    const dados = LerNotaFiscal.safeParse(corpo)
    if (!dados.success) throw new BadRequestException(primeiroErro(dados.error))
    const c = req.contexto!
    return this.notas.ler(
      { clinicaId: c.clinicaId, ator: c.ator, fuso: c.clinicaFuso },
      dados.data.xml,
    )
  }

  /**
   * `entradaNota` — registra as entradas da nota, **idempotente** (regra 26).
   *
   * A chave é a chave de acesso da NF-e; para a nota digitada, emissor +
   * número. Reimportar o mesmo arquivo três vezes devolve os MESMOS movimentos
   * e não cria nada novo — garantido pelos dois índices únicos da 0017, não por
   * um `SELECT` antes do `INSERT`.
   *
   * **`estoque.gerir`**, e aqui divergimos do protótipo (que deixa qualquer
   * perfil de estoque lançar a nota): a nota carrega CUSTO, e custo é dinheiro
   * — é a mesma razão pela qual `movEstoque` já recusa `custo` de quem não tem
   * a chave. Lançar entrada sem custo continua sendo
   * `POST /v1/estoque/movimentos`, que a enfermagem pode.
   */
  @Post('notas')
  @Exige('estoque.gerir')
  @HttpCode(HttpStatus.CREATED)
  async registrarNota(
    @Body() corpo: unknown,
    @Req() req: RequisicaoComContexto,
  ): Promise<ResultadoDaEntradaPelaNota> {
    const dados = RegistrarEntradaPelaNota.safeParse(corpo)
    if (!dados.success) throw new BadRequestException(primeiroErro(dados.error))
    const c = req.contexto!
    return this.notas.registrar(
      { clinicaId: c.clinicaId, ator: c.ator, fuso: c.clinicaFuso },
      dados.data,
    )
  }

  /* ── LOCAIS ────────────────────────────────────────────────────────────── */

  /**
   * Os locais são de LEITURA aberta dentro do estoque: a lista de contagem e o
   * cadastro de item precisam escolher onde o item mora.
   */
  @Get('locais')
  async listarLocais(@Req() req: RequisicaoComContexto): Promise<ListaDeLocais> {
    const c = req.contexto!
    return this.locais.listar({ clinicaId: c.clinicaId, ator: c.ator })
  }

  @Post('locais')
  @Exige('estoque.gerir')
  @HttpCode(HttpStatus.CREATED)
  async criarLocal(
    @Body() corpo: unknown,
    @Req() req: RequisicaoComContexto,
  ): Promise<LocalNaLista> {
    const dados = SalvarLocalEstoque.safeParse(corpo)
    if (!dados.success) throw new BadRequestException(primeiroErro(dados.error))
    const c = req.contexto!
    return this.locais.criar({ clinicaId: c.clinicaId, ator: c.ator }, dados.data)
  }

  @Patch('locais/:id')
  @Exige('estoque.gerir')
  async editarLocal(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoComContexto,
  ): Promise<LocalNaLista> {
    const dados = EditarLocalEstoque.safeParse(corpo)
    if (!dados.success) throw new BadRequestException(primeiroErro(dados.error))
    const c = req.contexto!
    return this.locais.editar({ clinicaId: c.clinicaId, ator: c.ator }, id, dados.data)
  }

  /* ── MOVIMENTOS ────────────────────────────────────────────────────────── */

  /**
   * **Antes de `:id`**, e isto não é estilo: o Nest casa rota por ordem de
   * registro, e `@Get(':id')` declarado antes engoliria `/movimentos` como um
   * id — que o `ParseUUIDPipe` recusaria com 400, numa rota que existe.
   *
   * **Sem `@DadoSensivel`, e a razão é a mesma de `GET /v1/pacientes`:** a
   * marcação registra quem olhou UM registro — *"quem olhou o cadastro da
   * minha paciente"* —, e uma listagem viraria cem linhas de trilha por dia,
   * escondendo o acesso à ficha no meio delas. Este extrato é cronológico, do
   * estoque, não a história de uma paciente.
   *
   * **O dia em que existir uma rota que filtra movimento POR PACIENTE, ela é
   * `@DadoSensivel`** — aí a resposta passa a ser "que doses a paciente X
   * recebeu, de que lote", que é literalmente o que a regra 18 nomeia. É a
   * primeira coisa a revisitar quando a ficha da paciente ganhar o histórico
   * de aplicação.
   */
  @Get('movimentos')
  async listarMovimentos(
    @Req() req: RequisicaoComContexto,
    @Query('limite') limite?: string,
  ): Promise<ListaDeMovimentos> {
    const c = req.contexto!
    const n = Number(limite ?? '100')
    return this.movimentos.listar(
      { clinicaId: c.clinicaId, ator: c.ator, fuso: c.clinicaFuso },
      Number.isInteger(n) && n > 0 && n <= 500 ? n : 100,
    )
  }

  /**
   * `movEstoque` — entrada, saída e ajuste.
   *
   * O **ajuste** exige `estoque.gerir` (MANUAL: *"Ajuste de estoque — só
   * administrativo"*, e regra 13: ajuste manual exige motivo e permissão). A
   * checagem é aqui porque ele é um ramo da união do corpo, e nenhum `@Exige`
   * por rota alcança um campo.
   *
   * **O `contagem` também**: uma contagem reinicia o saldo do item, que é mais
   * poderoso que qualquer ajuste. Sem isso, quem não pode ajustar poderia
   * reescrever o saldo contando.
   */
  @Post('movimentos')
  @HttpCode(HttpStatus.CREATED)
  async registrarMovimento(
    @Body() corpo: unknown,
    @Req() req: RequisicaoComContexto,
  ): Promise<ListaDeMovimentos> {
    const dados = RegistrarMovimento.safeParse(corpo)
    if (!dados.success) throw new BadRequestException(primeiroErro(dados.error))
    const c = req.contexto!

    if (
      (dados.data.tipo === 'ajuste' || dados.data.tipo === 'contagem') &&
      !c.pode('estoque.gerir')
    ) {
      // Mesma frase do `AutorizacaoGuard`, sem dizer qual permissão falta: a
      // lista de chaves de quem não as tem é um mapa do que existe atrás da
      // porta.
      throw new ForbiddenException('Sem acesso a esta ação.')
    }
    // Custo só com `estoque.gerir` — ele é dinheiro, e a enfermagem não o vê.
    if (dados.data.tipo === 'entrada' && dados.data.custo != null && !c.pode('estoque.gerir')) {
      throw new ForbiddenException('Sem acesso a esta ação.')
    }

    return this.movimentos.registrar(
      { clinicaId: c.clinicaId, ator: c.ator, fuso: c.clinicaFuso },
      dados.data,
    )
  }

  /* ── IMPORTAÇÃO ────────────────────────────────────────────────────────── */

  @Post('importar')
  @Exige('estoque.gerir')
  @HttpCode(HttpStatus.OK)
  async importar(
    @Body() corpo: unknown,
    @Req() req: RequisicaoComContexto,
  ): Promise<ResultadoDaImportacaoDeItens> {
    const dados = ImportarItensEstoque.safeParse(corpo)
    if (!dados.success) throw new BadRequestException(primeiroErro(dados.error))
    const c = req.contexto!
    return this.importacao.importar({ clinicaId: c.clinicaId, ator: c.ator }, dados.data)
  }

  /* ── ITENS ─────────────────────────────────────────────────────────────── */

  @Get()
  async listar(@Req() req: RequisicaoComContexto): Promise<ListaDeItens> {
    const c = req.contexto!
    return this.itens.listar(contextoDoItem(c))
  }

  @Post()
  @Exige('estoque.gerir')
  @HttpCode(HttpStatus.CREATED)
  async criar(
    @Body() corpo: unknown,
    @Req() req: RequisicaoComContexto,
  ): Promise<ItemNaLista> {
    const dados = SalvarItemEstoque.safeParse(corpo)
    if (!dados.success) throw new BadRequestException(primeiroErro(dados.error))
    const c = req.contexto!
    return this.itens.criar(
      contextoDoItem(c),
      dados.data,
      // O FUSO DA CLÍNICA, não uma constante (regra 22): a contagem inicial
      // carrega o dia civil, e `America/Bahia` fixo quebra na primeira clínica
      // de outro estado.
      c.clinicaFuso,
    )
  }

  @Patch(':id')
  @Exige('estoque.gerir')
  async editar(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoComContexto,
  ): Promise<ItemNaLista> {
    const dados = EditarItemEstoque.safeParse(corpo)
    if (!dados.success) throw new BadRequestException(primeiroErro(dados.error))
    const c = req.contexto!
    return this.itens.editar(contextoDoItem(c), id, dados.data)
  }

  /**
   * `ligarCodigoItem` — o código de barras da caixa, ligado ao item.
   *
   * **Permissão `estoque`**, como no protótipo: quem lê a caixa com a câmera é
   * quem está com o frasco na mão, e ligar o código é parte de registrar a
   * entrada. Não há dinheiro nem saldo nesta escrita — ela só diz "esta caixa
   * é este item".
   */
  @Post(':id/codigo')
  async ligarCodigo(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoComContexto,
  ): Promise<ItemNaLista> {
    const dados = LigarCodigoItem.safeParse(corpo)
    if (!dados.success) throw new BadRequestException(primeiroErro(dados.error))
    const c = req.contexto!
    return this.itens.ligarCodigo(contextoDoItem(c), id, dados.data.gtin)
  }

  @Delete(':id')
  @Exige('estoque.gerir')
  @HttpCode(HttpStatus.NO_CONTENT)
  async excluir(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: RequisicaoComContexto,
  ): Promise<void> {
    const c = req.contexto!
    await this.itens.excluir(contextoDoItem(c), id)
  }
}
