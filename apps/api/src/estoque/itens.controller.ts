import {
  EditarItemEstoque,
  EditarLocalEstoque,
  ImportarItensEstoque,
  type ItemNaLista,
  type ListaDeItens,
  type ListaDeLocais,
  type ListaDeMovimentos,
  type LocalNaLista,
  RegistrarMovimento,
  type ResultadoDaImportacaoDeItens,
  SalvarItemEstoque,
  SalvarLocalEstoque,
} from '@fir/contracts'
import {
  BadRequestException,
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
  Query,
  Req,
} from '@nestjs/common'
import { Exige } from '../autorizacao/autorizacao.guard'
import type { RequisicaoComContexto } from '../comum/contexto'
import { primeiroErro } from '../tarefas/tarefas.controller'
import { ImportacaoDeItensService } from './importacao.service'
import { ItensService } from './itens.service'
import { LocaisService } from './locais.service'
import { MovimentosService } from './movimentos.service'

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
@Controller('v1/estoque')
@Exige('estoque')
export class ItensController {
  // `@Inject` explícito: o esbuild não emite `design:paramtypes`.
  constructor(
    @Inject(ItensService) private readonly itens: ItensService,
    @Inject(LocaisService) private readonly locais: LocaisService,
    @Inject(MovimentosService) private readonly movimentos: MovimentosService,
    @Inject(ImportacaoDeItensService) private readonly importacao: ImportacaoDeItensService,
  ) {}

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
      throw new BadRequestException('Sem acesso a esta ação.')
    }
    // Custo só com `estoque.gerir` — ele é dinheiro, e a enfermagem não o vê.
    if (dados.data.tipo === 'entrada' && dados.data.custo != null && !c.pode('estoque.gerir')) {
      throw new BadRequestException('Sem acesso a esta ação.')
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
    return this.itens.listar({ clinicaId: c.clinicaId, ator: c.ator })
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
      { clinicaId: c.clinicaId, ator: c.ator },
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
    return this.itens.editar({ clinicaId: c.clinicaId, ator: c.ator }, id, dados.data)
  }

  @Delete(':id')
  @Exige('estoque.gerir')
  @HttpCode(HttpStatus.NO_CONTENT)
  async excluir(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: RequisicaoComContexto,
  ): Promise<void> {
    const c = req.contexto!
    await this.itens.excluir({ clinicaId: c.clinicaId, ator: c.ator }, id)
  }
}
