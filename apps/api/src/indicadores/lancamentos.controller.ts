import { type LancamentoDeKpiNaSaida, LancarKpi, ReferenciaDoLancamento } from '@fir/contracts'
import { BadRequestException, Body, Controller, Inject, Param, ParseUUIDPipe, Put, Req } from '@nestjs/common'
import type { RequisicaoComContexto } from '../comum/contexto'
import { primeiroErro } from '../comum/primeiro-erro'
import { LancamentosDeKpiService } from './lancamentos.service'

/**
 * **A EXCEÇÃO NOMEADA DA MATRIZ DE ACESSO** (appsec C4): esta é a única rota
 * de `/v1/indicadores*` sem `@Exige`, e está registrada como tal em
 * `teste/registro.ts` (`EXCECOES_DE_ACESSO`). A responsável pelo KPI manual
 * lança mesmo sem `indicadores`; quem decide é `podeLancar`, no serviço,
 * dentro da transação que grava (appsec C1).
 *
 * **Não abre leitura nenhuma** (appsec C2): é `PUT`, devolve só o lançamento,
 * e nenhuma rota de leitura usa `podeLancar`. Um controlador à parte, e não
 * um método a mais em `IndicadoresController`, para que o `@Exige` de cada
 * rota de lá continue explícito e nada herde a exceção.
 */
@Controller('v1/indicadores')
export class LancamentosDeKpiController {
  // `@Inject` explícito: o esbuild não emite `design:paramtypes`.
  constructor(@Inject(LancamentosDeKpiService) private readonly lancamentos: LancamentosDeKpiService) {}

  @Put('kpis/:id/lancamentos/:referencia')
  async lancar(
    @Req() req: RequisicaoComContexto,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('referencia') referencia: string,
    @Body() corpo: unknown,
  ): Promise<LancamentoDeKpiNaSaida> {
    const ref = ReferenciaDoLancamento.safeParse(referencia)
    if (!ref.success) throw new BadRequestException(primeiroErro(ref.error))
    const dados = LancarKpi.safeParse(corpo)
    if (!dados.success) throw new BadRequestException(primeiroErro(dados.error))
    // `!` seguro: `SessaoGuard` é global e esta rota não é `@Publico()`.
    const c = req.contexto!
    return this.lancamentos.lancar({ clinicaId: c.clinicaId, ator: c.ator, fuso: c.clinicaFuso }, id, ref.data, dados.data)
  }
}
