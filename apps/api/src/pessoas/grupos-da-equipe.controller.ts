import {
  CriarGrupoDaEquipe,
  DefinirGruposDaPessoa,
  EditarGrupoDaEquipe,
  type GrupoDaEquipeNaLista,
  type GruposDaEquipe,
  type GruposDaEquipeParaAdministrar,
  type MeusGrupos,
} from '@fir/contracts'
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common'
import { Exige } from '../autorizacao/autorizacao.guard'
import { LimiteDeEscritaDoFluxoGuard } from '../tarefas/limite-de-escrita.guard'
import type { RequisicaoComContexto } from '../comum/contexto'
import { primeiroErro } from '../comum/primeiro-erro'
import { GruposDaEquipeService } from './grupos-da-equipe.service'

/**
 * **Grupos de colaboradores** (ADR 2026-11-14).
 *
 * Duas leituras com públicos diferentes, e a diferença é a regra L5:
 *
 *  - `GET /v1/grupos` e `GET /v1/grupos/meus` — SEM `@Exige`: todo mundo cria e
 *    transfere tarefa, e precisa do nome dos grupos ativos. Nome não é dado
 *    pessoal; **composição é**, e não sai daqui.
 *  - `GET /v1/grupos/administracao` e toda escrita — `config`, a chave de
 *    *Usuários e acessos*. Pôr alguém num grupo é dar acesso a tarefas.
 *
 * As escritas recusam a sessão de suporte no serviço (E3), e o vínculo recusa o
 * próprio id (E4). Nenhum corpo, nome ou id entra em log desta camada.
 *
 * A ordem das rotas importa: `meus` e `administracao` vêm antes de qualquer
 * `:id`, e o Fastify as distingue por serem literais.
 */
@Controller('v1')
export class GruposDaEquipeController {
  constructor(@Inject(GruposDaEquipeService) private readonly grupos: GruposDaEquipeService) {}

  @Get('grupos')
  async listar(@Req() req: RequisicaoComContexto): Promise<GruposDaEquipe> {
    const c = req.contexto!
    return { grupos: await this.grupos.listar(c.clinicaId, c.ator) }
  }

  @Get('grupos/meus')
  async meus(@Req() req: RequisicaoComContexto): Promise<MeusGrupos> {
    const c = req.contexto!
    return this.grupos.meus(c.clinicaId, c.ator)
  }

  @Get('grupos/administracao')
  @Exige('config')
  async administracao(@Req() req: RequisicaoComContexto): Promise<GruposDaEquipeParaAdministrar> {
    const c = req.contexto!
    return { grupos: await this.grupos.listarParaAdministrar(c.clinicaId, c.ator) }
  }

  @Post('grupos')
  @Exige('config')
  @UseGuards(LimiteDeEscritaDoFluxoGuard)
  @HttpCode(HttpStatus.CREATED)
  async criar(
    @Req() req: RequisicaoComContexto,
    @Body() corpo: unknown,
  ): Promise<GrupoDaEquipeNaLista> {
    const dados = CriarGrupoDaEquipe.safeParse(corpo)
    if (!dados.success) throw new BadRequestException(primeiroErro(dados.error))
    const c = req.contexto!
    return this.grupos.criar(c.clinicaId, c.ator, dados.data)
  }

  @Patch('grupos/:id')
  @Exige('config')
  @UseGuards(LimiteDeEscritaDoFluxoGuard)
  async editar(
    @Req() req: RequisicaoComContexto,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() corpo: unknown,
  ): Promise<GrupoDaEquipeNaLista> {
    const dados = EditarGrupoDaEquipe.safeParse(corpo)
    if (!dados.success) throw new BadRequestException(primeiroErro(dados.error))
    const c = req.contexto!
    return this.grupos.editar(c.clinicaId, c.ator, id, dados.data)
  }

  @Get('pessoas/:id/grupos')
  @Exige('config')
  async gruposDaPessoa(
    @Req() req: RequisicaoComContexto,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<MeusGrupos> {
    const c = req.contexto!
    return this.grupos.gruposDaPessoa(c.clinicaId, c.ator, id)
  }

  @Put('pessoas/:id/grupos')
  @Exige('config')
  @UseGuards(LimiteDeEscritaDoFluxoGuard)
  async definirGruposDaPessoa(
    @Req() req: RequisicaoComContexto,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() corpo: unknown,
  ): Promise<MeusGrupos> {
    const dados = DefinirGruposDaPessoa.safeParse(corpo)
    if (!dados.success) throw new BadRequestException(primeiroErro(dados.error))
    const c = req.contexto!
    return this.grupos.definirGruposDaPessoa(c.clinicaId, c.ator, id, dados.data.grupoIds)
  }
}
