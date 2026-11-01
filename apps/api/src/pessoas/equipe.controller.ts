import {
  type BancoDeHoras,
  type ConfiguracaoDePessoal,
  type Equipe,
  type FichaCompleta,
  Mes,
  SalvarBancoDeHoras,
  SalvarConfiguracaoDePessoal,
  SalvarDocumento,
  SalvarFerias,
  SalvarFicha,
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
import { EquipeService } from './equipe.service'

/**
 * **Pessoas › Equipe** — ficha, documentos, férias e banco de horas.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * `pessoas.gerir` EM TODA ROTA, E É ELA QUE GUARDA O SALÁRIO
 *
 * `pessoas.gerir` e **não** `config`: são duas telas com públicos diferentes,
 * como a navegação dela mostra. *Usuários e acessos* (`config`) é login,
 * perfil e ativação; *Equipe* é ficha, contrato, férias e **salário**. Juntar
 * as duas poria salário e permissão na mesma tela.
 *
 * **A defesa do salário tem três camadas, e nenhuma substitui as outras:**
 *
 *  1. **Esta rota é 403 sem `pessoas.gerir`.** Quem tem `valores` para fechar
 *     o caixa não abre a Equipe.
 *  2. **O `RedacaoInterceptor` apaga `salario` por nome de chave**, com a
 *     única entrada de `CHAVE_DO_CAMPO` que **não** é `valores`. Isso importa
 *     porque existe uma rota que entrega o campo sem passar por aqui:
 *     `GET /v1/auditoria` devolve o `de`/`para` de toda escrita da clínica, e
 *     ela exige `config`. Um perfil com `config` + `valores` e sem
 *     `pessoas.gerir` — exatamente o do administrativo que não deve ver
 *     salário — leria o valor na trilha se o mapeamento não existisse.
 *  3. **`@DadoSensivel`, na ficha aberta:** quem olhou o salário dela fica na
 *     trilha (regra 18 — registro de ACESSO, não só de escrita). A LISTA não é
 *     marcada, e por isso ela **não carrega `salario`**: marcar a lista encheria
 *     a trilha de "abriu a Equipe" e esconderia a pergunta útil.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * **Não há `DELETE` de ficha.** Desativar é um estado (regra 20, e a mesma
 * decisão da ADR 0003 para paciente): o histórico de férias, documento e
 * banco de horas de quem saiu não pode desaparecer. O `ativo` do `PUT` é esse
 * caminho, e é o "desmarque quando a pessoa sair da clínica" dela.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * **O PREFIXO É `/v1/fichas`, e NÃO `/v1/equipe` — colisão real, achada pelo
 * roteador.**
 *
 * `GET /v1/equipe` já existe em `ClinicaController`: é a lista de `Pessoa`
 * ativas para os seletores de responsável, liberada para todos. O Fastify
 * recusa em tempo de subida (*"Method 'GET' already declared for route
 * '/v1/equipe'"*), e a recusa foi uma sorte — a alternativa silenciosa seriam
 * duas rotas com o mesmo nome e públicos opostos: uma de todos, outra com o
 * salário atrás de `pessoas.gerir`.
 *
 * `fichas` é o nome da ENTIDADE (`Ficha de pessoa`, em `CONTEXT.md`). A TELA
 * continua sendo `/equipe`, que é o nome que a equipe lê.
 */
@Controller('v1/fichas')
@Exige('pessoas.gerir')
export class EquipeController {
  // `@Inject` explícito: o esbuild não emite `design:paramtypes`.
  constructor(@Inject(EquipeService) private readonly equipe: EquipeService) {}

  @Get()
  async listar(@Req() req: RequisicaoComContexto): Promise<Equipe> {
    // `!` seguro: `SessaoGuard` é global e esta rota não é `@Publico()`.
    return this.equipe.equipe(contexto(req))
  }

  /**
   * O limite do banco de horas. `GET` próprio porque a tabela de horas o
   * precisa sem carregar a equipe inteira.
   */
  @Get('configuracao')
  async configuracao(@Req() req: RequisicaoComContexto): Promise<ConfiguracaoDePessoal> {
    return this.equipe.configuracao(contexto(req))
  }

  /**
   * `config` dela — e é só o `limiteHoras`.
   *
   * `PUT` porque o corpo é o valor inteiro, e salvar duas vezes o mesmo limite
   * é o mesmo estado. Declarado ANTES de `:id` não por necessidade (os verbos
   * diferem) e sim para que a leitura do arquivo não deixe dúvida.
   */
  @Put('configuracao')
  async salvarConfiguracao(
    @Body() corpo: unknown,
    @Req() req: RequisicaoComContexto,
  ): Promise<ConfiguracaoDePessoal> {
    const dados = SalvarConfiguracaoDePessoal.safeParse(corpo)
    if (!dados.success) throw new BadRequestException(primeiroErro(dados.error))
    return this.equipe.salvarConfiguracao(contexto(req), dados.data)
  }

  /** A tabela do banco de horas: o mês pedido e os cinco anteriores. */
  @Get('horas/:mes')
  async bancoDeHoras(
    @Param('mes') mes: string,
    @Req() req: RequisicaoComContexto,
  ): Promise<BancoDeHoras> {
    return this.equipe.bancoDeHoras(contexto(req), umMes(mes))
  }

  /**
   * `horas` — "Salvar saldos de outubro".
   *
   * `PUT` e não `POST`: salvar a mesma tabela duas vezes produz o mesmo
   * estado, garantido pelo índice único `horas_por_ficha_e_mes` e não por um
   * `if` no serviço (regra 26 pelo espírito — duas abas não criam dois saldos
   * para o mesmo mês).
   */
  @Put('horas/:mes')
  async salvarBancoDeHoras(
    @Param('mes') mes: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoComContexto,
  ): Promise<BancoDeHoras> {
    const dados = SalvarBancoDeHoras.safeParse(corpo)
    if (!dados.success) throw new BadRequestException(primeiroErro(dados.error))
    return this.equipe.salvarBancoDeHoras(contexto(req), umMes(mes), dados.data)
  }

  /** `ficha` — criar. */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async criar(
    @Body() corpo: unknown,
    @Req() req: RequisicaoComContexto,
  ): Promise<FichaCompleta> {
    const dados = SalvarFicha.safeParse(corpo)
    if (!dados.success) throw new BadRequestException(primeiroErro(dados.error))
    return this.equipe.salvarFicha(contexto(req), null, dados.data)
  }

  /**
   * A ficha aberta — **a única resposta do produto com `salario`**.
   *
   * `@DadoSensivel('fichas_de_pessoa')`: a pergunta que a clínica faz depois é
   * *"quem abriu o salário dela"*, e ninguém alterou nada — a trigger de
   * escrita não vê `SELECT`.
   */
  @Get(':id')
  @DadoSensivel('fichas_de_pessoa')
  async ficha(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: RequisicaoComContexto,
  ): Promise<FichaCompleta> {
    return this.equipe.ficha(contexto(req), id)
  }

  /**
   * `ficha` — substituir. **`PUT`, a ficha inteira.**
   *
   * Num `PATCH`, "campo ausente" e "campo apagado" se confundem, e a tela que
   * reenvia o formulário sem o campo que não carregou apagaria o salário de
   * alguém em silêncio. Com `PUT`, o corpo É a ficha.
   */
  @Put(':id')
  async salvar(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoComContexto,
  ): Promise<FichaCompleta> {
    const dados = SalvarFicha.safeParse(corpo)
    if (!dados.success) throw new BadRequestException(primeiroErro(dados.error))
    return this.equipe.salvarFicha(contexto(req), id, dados.data)
  }

  /** `ferias` — e o servidor recusa período SOBREPOSTO (409). */
  @Post(':id/ferias')
  @HttpCode(HttpStatus.CREATED)
  async registrarFerias(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoComContexto,
  ): Promise<FichaCompleta> {
    const dados = SalvarFerias.safeParse(corpo)
    if (!dados.success) throw new BadRequestException(primeiroErro(dados.error))
    return this.equipe.registrarFerias(contexto(req), id, dados.data)
  }

  /** `excluirFerias` — soft delete, e devolve a ficha recalculada. */
  @Delete(':id/ferias/:feriasId')
  async removerFerias(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('feriasId', ParseUUIDPipe) feriasId: string,
    @Req() req: RequisicaoComContexto,
  ): Promise<FichaCompleta> {
    return this.equipe.removerFerias(contexto(req), id, feriasId)
  }

  /** `doc` — documento com validade. */
  @Post(':id/documentos')
  @HttpCode(HttpStatus.CREATED)
  async registrarDocumento(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoComContexto,
  ): Promise<FichaCompleta> {
    const dados = SalvarDocumento.safeParse(corpo)
    if (!dados.success) throw new BadRequestException(primeiroErro(dados.error))
    return this.equipe.registrarDocumento(contexto(req), id, dados.data)
  }

  /** `excluirDoc` — soft delete. */
  @Delete(':id/documentos/:docId')
  async removerDocumento(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('docId', ParseUUIDPipe) docId: string,
    @Req() req: RequisicaoComContexto,
  ): Promise<FichaCompleta> {
    return this.equipe.removerDocumento(contexto(req), id, docId)
  }
}

/**
 * O contexto na forma que o serviço espera. A clínica vem da SESSÃO, nunca do
 * corpo nem da query — ver `banco/clinica-id.ts`.
 */
function contexto(req: RequisicaoComContexto) {
  const c = req.contexto!
  return { clinicaId: c.clinicaId, ator: c.ator, fuso: c.clinicaFuso }
}

/**
 * `aaaa-mm` validado pelo CONTRATO, não por confiança no caminho.
 *
 * Sem isto, `/v1/fichas/horas/outubro` chegaria ao `CHECK` da coluna e a
 * recusa seria um erro de banco com texto de Postgres na tela.
 */
function umMes(mes: string): string {
  const r = Mes.safeParse(mes)
  if (!r.success) throw new BadRequestException('Use o mês no formato aaaa-mm.')
  return r.data
}
