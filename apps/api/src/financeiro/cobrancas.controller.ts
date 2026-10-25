import {
  type ListaDeCobrancas,
  type MensagemDeCobranca,
  RegistrarCobranca,
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
  Post,
  Req,
} from '@nestjs/common'
import { Exige } from '../autorizacao/autorizacao.guard'
import type { RequisicaoComContexto } from '../comum/contexto'
import { primeiroErro } from '../tarefas/tarefas.controller'
import { CobrancasService } from './cobrancas.service'

/**
 * Cobranças — e a permissão que o protótipo **não** exige.
 *
 * Medido no protótipo: `registrarCobranca` chamada como Camila (perfil
 * Enfermagem, sem `cobrancas`) devolveu `ok`. A tela guarda por `VIEW_PERM`;
 * um POST direto não passa pela tela. Aqui é `@Exige('cobrancas')` na CLASSE,
 * e o servidor sempre valida (regra 16).
 */
@Controller('v1/cobrancas')
@Exige('cobrancas')
export class CobrancasController {
  // `@Inject` explícito: o esbuild não emite `design:paramtypes`.
  constructor(@Inject(CobrancasService) private readonly cobrancas: CobrancasService) {}

  @Get()
  async listar(@Req() req: RequisicaoComContexto): Promise<ListaDeCobrancas> {
    // `!` seguro: `SessaoGuard` é global e esta rota não é `@Publico()`.
    const c = req.contexto!
    return this.cobrancas.listar({
      clinicaId: c.clinicaId,
      ator: c.ator,
      fuso: c.clinicaFuso,
      clinicaNome: c.clinicaNome,
    })
  }

  @Get(':pacienteId/mensagem')
  async mensagem(
    @Req() req: RequisicaoComContexto,
    @Param('pacienteId', ParseUUIDPipe) pacienteId: string,
  ): Promise<MensagemDeCobranca> {
    const c = req.contexto!
    return this.cobrancas.mensagem(
      { clinicaId: c.clinicaId, ator: c.ator, fuso: c.clinicaFuso, clinicaNome: c.clinicaNome },
      pacienteId,
    )
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async registrar(
    @Req() req: RequisicaoComContexto,
    @Body() corpo: unknown,
  ): Promise<{ ok: true }> {
    const dados = RegistrarCobranca.safeParse(corpo)
    if (!dados.success) throw new BadRequestException(primeiroErro(dados.error))
    const c = req.contexto!
    await this.cobrancas.registrar(
      { clinicaId: c.clinicaId, ator: c.ator, fuso: c.clinicaFuso, clinicaNome: c.clinicaNome },
      dados.data,
    )
    return { ok: true }
  }
}
