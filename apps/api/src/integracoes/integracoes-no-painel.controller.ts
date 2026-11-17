import {
  ChaveDeIntegracaoEntrada,
  type IntegracaoNoPainel,
  LigacoesDaIntegracaoEntrada,
  StatusDeCanceladoEntrada,
  TermoDeIntegracaoEntrada,
  Uuid,
} from '@fir/contracts'
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  Post,
  Put,
  Req,
} from '@nestjs/common'
import { clinicaIdDeFonteConfiavel } from '../banco/clinica-id'
import type { ContextoDoPainel, RequisicaoComPainel } from '../painel/contexto-do-painel'
import { ClinicaDesativada, ClinicaNaoExiste, PainelClinicasService } from '../painel/painel-clinicas.service'
import { SoOperador } from '../painel/so-operador.decorator'
import {
  AgendaPorIcalLigada,
  ChaveEmOutraClinica,
  IntegracoesNoPainelService,
  SemChave,
  SemEscopoDeFinancas,
  SemResponsavelDaAgenda,
  SemTermo,
  SemVerificacao,
  TesteCedoDemais,
} from './integracoes-no-painel.service'

/**
 * As integrações da clínica, pelo superadmin (spec `integracao-medx.md` A).
 * Só Operador (`@SoOperador`): a clínica não tem rota que leia nem grave a chave (A.10).
 */
@SoOperador()
@Controller('v1/superadmin/clinicas/:clinicaId/integracoes')
export class IntegracoesNoPainelController {
  constructor(
    @Inject(IntegracoesNoPainelService) private readonly integracoes: IntegracoesNoPainelService,
    @Inject(PainelClinicasService) private readonly clinicas: PainelClinicasService,
  ) {}

  @Get()
  async ler(@Param('clinicaId') clinicaId: string, @Req() req: RequisicaoComPainel): Promise<IntegracaoNoPainel> {
    return this.integracoes.ler(await this.clinica(clinicaId), painelDe(req).ator)
  }

  @Put('chave')
  async gravarChave(
    @Param('clinicaId') clinicaId: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoComPainel,
  ): Promise<IntegracaoNoPainel> {
    const dados = validar(ChaveDeIntegracaoEntrada, corpo, 'Confira a chave.')
    return traduzir(async () =>
      this.integracoes.gravarChave(await this.clinica(clinicaId), painelDe(req).ator, dados.chave),
    )
  }

  @Delete('chave')
  async removerChave(
    @Param('clinicaId') clinicaId: string,
    @Req() req: RequisicaoComPainel,
  ): Promise<IntegracaoNoPainel> {
    return this.integracoes.removerChave(await this.clinica(clinicaId), painelDe(req).ator)
  }

  @Put('termo')
  async registrarTermo(
    @Param('clinicaId') clinicaId: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoComPainel,
  ): Promise<IntegracaoNoPainel> {
    const dados = validar(TermoDeIntegracaoEntrada, corpo, 'Confira os dados do termo.')
    return this.integracoes.registrarTermo(await this.clinica(clinicaId), painelDe(req).ator, dados)
  }

  @Put('ligacoes')
  async ligar(
    @Param('clinicaId') clinicaId: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoComPainel,
  ): Promise<IntegracaoNoPainel> {
    const dados = validar(LigacoesDaIntegracaoEntrada, corpo, 'Confira o que ligar.')
    return traduzir(async () =>
      this.integracoes.ligar(await this.clinica(clinicaId), painelDe(req).ator, dados),
    )
  }

  @Put('status-de-cancelado')
  async definirStatusDeCancelado(
    @Param('clinicaId') clinicaId: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoComPainel,
  ): Promise<IntegracaoNoPainel> {
    const dados = validar(StatusDeCanceladoEntrada, corpo, 'Confira os códigos de status (0 a 12).')
    return traduzir(async () =>
      this.integracoes.definirStatusDeCancelado(await this.clinica(clinicaId), painelDe(req).ator, dados),
    )
  }

  @Post('testar')
  @HttpCode(HttpStatus.ACCEPTED)
  async testar(
    @Param('clinicaId') clinicaId: string,
    @Req() req: RequisicaoComPainel,
  ): Promise<IntegracaoNoPainel> {
    return traduzir(async () =>
      this.integracoes.pedirTeste(await this.clinica(clinicaId), painelDe(req).ator),
    )
  }

  private async clinica(bruto: string) {
    const id = Uuid.safeParse(bruto)
    if (!id.success) throw new NotFoundException()
    try {
      return clinicaIdDeFonteConfiavel((await this.clinicas.clinicaPorId(id.data)).id)
    } catch (e) {
      if (e instanceof ClinicaNaoExiste) throw new NotFoundException('Clínica não encontrada.')
      if (e instanceof ClinicaDesativada) throw new ConflictException('Esta clínica está desativada.')
      throw e
    }
  }
}

type Esquema<T> = {
  safeParse(x: unknown): { success: true; data: T } | { success: false; error: { issues: Array<{ message: string }> } }
}

function validar<T>(schema: Esquema<T>, corpo: unknown, padrao: string): T {
  const r = schema.safeParse(corpo)
  if (!r.success) throw new BadRequestException(r.error.issues[0]?.message ?? padrao)
  return r.data
}

async function traduzir<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (e) {
    if (e instanceof ChaveEmOutraClinica) {
      throw new ConflictException('Essa chave já está ligada a outra clínica. Cada clínica gera a sua.')
    }
    if (e instanceof SemChave) throw new ConflictException('Cole a chave do MedX antes.')
    if (e instanceof SemTermo) {
      throw new ConflictException('Registre o termo de autorização da clínica antes de ligar.')
    }
    if (e instanceof SemVerificacao) {
      throw new ConflictException('Use Testar conexão e espere o resultado verde antes de ligar.')
    }
    if (e instanceof SemEscopoDeFinancas) {
      throw new ConflictException('O usuário do MedX não tem a permissão de finanças. O faturamento não liga.')
    }
    if (e instanceof AgendaPorIcalLigada) {
      throw new ConflictException(
        'A clínica lê a agenda pelo link iCal. Desligue o link em Configurações → Agenda do sistema antes de ligar o MedX.',
      )
    }
    if (e instanceof SemResponsavelDaAgenda) {
      throw new ConflictException('A clínica não tem administrador ativo para receber os cartões da agenda.')
    }
    if (e instanceof TesteCedoDemais) {
      throw new HttpException(
        `Espere ${e.esperaEmSegundos} s para testar de novo.`,
        HttpStatus.TOO_MANY_REQUESTS,
      )
    }
    throw e
  }
}

const painelDe = (req: RequisicaoComPainel): ContextoDoPainel => {
  if (!req.painel) throw new NotFoundException()
  return req.painel
}
