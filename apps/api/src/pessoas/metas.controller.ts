import {
  type ConversaSalva,
  type Conversas,
  CopiarMetas,
  CriarRotinaDePessoal,
  EditarMetaDePessoa,
  LancarRealizado,
  Mes,
  type MetasCopiadas,
  type MetasDoMes,
  type MinhasMetas,
  type RotinaDePessoalCriada,
  SalvarConversa,
  SalvarMetaDePessoa,
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
  Post,
  Put,
  Req,
} from '@nestjs/common'
import { DadoSensivel } from '../auditoria/acesso.decorator'
import { Exige } from '../autorizacao/autorizacao.guard'
import type { RequisicaoComContexto } from '../comum/contexto'
import { primeiroErro } from '../tarefas/tarefas.controller'
import { MetasService } from './metas.service'

/**
 * **Pessoas › Metas do mês · Conversas 1:1 · Minhas metas** (MANUAL cap. 13).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * O PREFIXO É `/v1/metas-de-pessoa`, E **NÃO** `/v1/metas` — E ISSO É UMA
 * DIVERGÊNCIA DELIBERADA DO QUE O COMMIT ANTERIOR PROMETEU.
 *
 * O commit `c5eb1b3` escreveu *"fecha quando `GET /v1/metas/:mes` nascer"*, e
 * essa rota seria um defeito: `/v1/metas/:mes` **já existe** como a meta de
 * FATURAMENTO da clínica — `PUT` e `DELETE` a gravam e a apagam, e
 * `GET /v1/metas/:mes/percentual` a lê. Um `GET /v1/metas/:mes` devolvendo as
 * metas das PESSOAS faria o mesmo caminho significar duas coisas segundo o
 * verbo: a meta de receita da clínica no `PUT`, as metas da equipe no `GET`.
 *
 * É exatamente a ambiguidade de `plano` que `CONTEXT.md` abre proibindo — "a
 * aba chama-se Planos, o campo chama-se planoId, e os dois significam coisas
 * diferentes em telas diferentes. É a ambiguidade mais cara do legado".
 *
 * O contrato (`packages/contracts/src/metas.ts`, escrito no mesmo commit) já
 * documentava `/v1/metas-de-pessoa/:mes`. **O que fechava o vermelho era a
 * rota existir e estar registrada, não o caminho dela.**
 * ────────────────────────────────────────────────────────────────────────────
 *
 * `pessoas.gerir` na CLASSE: meta e conversa 1:1 são RH, a mesma chave da
 * ficha e do salário. `config` não serve — *Usuários e acessos* é login e
 * perfil, e quem o administra não administra o desempenho de ninguém.
 *
 * **O que este controlador NÃO faz:** nenhum `if (pode('valores'))`. A meta de
 * `orc_valor` viaja em `metaEmDinheiro`/`realizadoEmDinheiro`, que estão em
 * `CAMPOS_MONETARIOS`, e o `RedacaoInterceptor` os apaga num ponto único
 * (regra 17). Sem `valores`, a meta entrega só o `percentual` — em TODA rota
 * daqui, inclusive na que ninguém revisou.
 */
@Controller('v1/metas-de-pessoa')
@Exige('pessoas.gerir')
export class MetasDePessoaController {
  // `@Inject` explícito: o esbuild não emite `design:paramtypes`.
  constructor(@Inject(MetasService) private readonly metas: MetasService) {}

  /** A aba **Metas** da tela Equipe: as fichas ativas, no mês pedido. */
  @Get(':mes')
  async doMes(
    @Param('mes') mes: string,
    @Req() req: RequisicaoComContexto,
  ): Promise<MetasDoMes> {
    return this.metas.metasDoMes(contexto(req), umMes(mes))
  }

  /** `meta` — adicionar. 409 na duplicata, pelo índice. */
  @Post(':mes')
  @HttpCode(HttpStatus.CREATED)
  async criar(
    @Param('mes') mes: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoComContexto,
  ): Promise<MetasDoMes> {
    const dados = SalvarMetaDePessoa.safeParse(corpo)
    if (!dados.success) throw new BadRequestException(primeiroErro(dados.error))
    return this.metas.criarMeta(contexto(req), umMes(mes), dados.data)
  }

  /**
   * `copiarMetas` — "Copiar metas de outubro".
   *
   * Declarado **antes** de `:mes/:id` de propósito: `copiar` é um segmento
   * literal, e o Fastify casa o literal primeiro, mas a ordem no arquivo é o
   * que faz a leitura não deixar dúvida.
   */
  @Post(':mes/copiar')
  // **200, e não 201.** A segunda cópia não cria nada (`copiadas: 0`,
  // `jaExistiam: N`), e um `201 Created` sobre uma chamada idempotente que não
  // escreveu linha nenhuma seria mentira na linha de status.
  @HttpCode(HttpStatus.OK)
  async copiar(
    @Param('mes') mes: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoComContexto,
  ): Promise<MetasCopiadas> {
    const dados = CopiarMetas.safeParse(corpo)
    if (!dados.success) throw new BadRequestException(primeiroErro(dados.error))
    return this.metas.copiarMetas(contexto(req), umMes(mes), dados.data)
  }

  /**
   * `meta` — **editar o alvo**. O indicador não muda (ver
   * `EditarMetaDePessoa`); o serviço recusa se o corpo tentar um diferente do
   * já gravado.
   */
  @Put(':mes/:id')
  async editar(
    @Param('mes') mes: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoComContexto,
  ): Promise<MetasDoMes> {
    const dados = EditarMetaDePessoa.safeParse(corpo)
    if (!dados.success) throw new BadRequestException(primeiroErro(dados.error))
    return this.metas.editarMeta(contexto(req), umMes(mes), id, dados.data)
  }

  /**
   * `realizado` — **só na meta MANUAL**, e o serviço recusa nas outras (422).
   *
   * `PUT` e não `POST`: lançar o mesmo resultado duas vezes é o mesmo estado,
   * e `null` LIMPA o lançamento.
   */
  @Put(':mes/:id/realizado')
  async lancar(
    @Param('mes') mes: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoComContexto,
  ): Promise<MetasDoMes> {
    const dados = LancarRealizado.safeParse(corpo)
    if (!dados.success) throw new BadRequestException(primeiroErro(dados.error))
    return this.metas.lancarRealizado(contexto(req), umMes(mes), id, dados.data)
  }

  /** `excluirMeta` — soft delete (regra 20). */
  @Delete(':mes/:id')
  async excluir(
    @Param('mes') mes: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: RequisicaoComContexto,
  ): Promise<MetasDoMes> {
    return this.metas.excluirMeta(contexto(req), umMes(mes), id)
  }
}

/**
 * **Minhas metas** — a tela que TODO perfil tem.
 *
 * **Sem `@Exige`, e isso é desenho, não omissão.** Na navegação dela a entrada
 * *Minhas metas* não tem chave (`epico: null` no menu), e o `pesSaida` do
 * protótipo prova por quê: quem não tem `pessoas.gerir` recebe a própria ficha
 * reduzida e as próprias metas, e nada mais — `conversas: []`, `horas: []`.
 *
 * **Não há parâmetro de pessoa**, e é a defesa inteira: a ficha é achada por
 * `pessoa_id = ator`. Um `?fichaId=` aqui seria a porta pela qual a recepção lê
 * a meta — e o atingimento — da colega, numa tela sem permissão nenhuma.
 */
@Controller('v1/minhas-metas')
export class MinhasMetasController {
  constructor(@Inject(MetasService) private readonly metas: MetasService) {}

  @Get(':mes')
  async doMes(
    @Param('mes') mes: string,
    @Req() req: RequisicaoComContexto,
  ): Promise<MinhasMetas> {
    return this.metas.minhasMetas(contexto(req), umMes(mes))
  }
}

/**
 * As **conversas 1:1** e as duas rotinas mensais da tela Equipe.
 *
 * `@DadoSensivel` na LEITURA: a conversa 1:1 é avaliação de desempenho de uma
 * funcionária identificada, e a pergunta que a clínica faz depois é *"quem leu
 * o que foi dito dela"*. É a mesma classificação do salário — registro de
 * ACESSO, não só de escrita (regra 18, pelo espírito do art. 11 para dado de
 * RH). A trigger de escrita não vê `SELECT`.
 */
@Controller('v1/conversas')
@Exige('pessoas.gerir')
export class ConversasController {
  constructor(@Inject(MetasService) private readonly metas: MetasService) {}

  @Get()
  @DadoSensivel('conversas_1a1', { lista: true })
  async listar(@Req() req: RequisicaoComContexto): Promise<Conversas> {
    return this.metas.conversas(contexto(req))
  }

  /**
   * `conversa` — registrar, e criar **uma tarefa por combinado** na MESMA
   * transação.
   *
   * No protótipo é um laço na tela chamando a API uma vez por linha: a
   * terceira falha deixa a conversa gravada com dois combinados virados em
   * tarefa e um não, e nada diz qual.
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async registrar(
    @Body() corpo: unknown,
    @Req() req: RequisicaoComContexto,
  ): Promise<ConversaSalva> {
    const dados = SalvarConversa.safeParse(corpo)
    if (!dados.success) throw new BadRequestException(primeiroErro(dados.error))
    return this.metas.registrarConversa(contexto(req), dados.data)
  }

  /**
   * As duas rotinas mensais: 1:1 no dia 20, banco de horas no dia 5.
   *
   * **Idempotente sem lock**, pelo índice `(clinica_id, marcador, prazo)` — o
   * segundo toque gera o mesmo conjunto e não escreve nada.
   */
  @Post('rotinas')
  async criarRotina(
    @Body() corpo: unknown,
    @Req() req: RequisicaoComContexto,
  ): Promise<RotinaDePessoalCriada> {
    const dados = CriarRotinaDePessoal.safeParse(corpo)
    if (!dados.success) throw new BadRequestException(primeiroErro(dados.error))
    return this.metas.criarRotina(contexto(req), dados.data.rotina)
  }
}

/**
 * O contexto na forma que o serviço espera. A clínica vem da SESSÃO, nunca do
 * corpo nem da query — ver `banco/clinica-id.ts`.
 */
function contexto(req: RequisicaoComContexto) {
  // `!` seguro: `SessaoGuard` é global e nenhuma rota daqui é `@Publico()`.
  const c = req.contexto!
  return { clinicaId: c.clinicaId, ator: c.ator, fuso: c.clinicaFuso }
}

/**
 * `aaaa-mm` validado pelo CONTRATO, não por confiança no caminho.
 *
 * Sem isto, `/v1/metas-de-pessoa/outubro` chegaria ao `CHECK` da coluna e a
 * recusa seria um erro de banco com texto de Postgres na tela.
 */
function umMes(mes: string): string {
  const r = Mes.safeParse(mes)
  if (!r.success) throw new BadRequestException('Use o mês no formato aaaa-mm.')
  return r.data
}
