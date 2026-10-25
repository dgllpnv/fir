import type { BlocoFinanceiroDeHoje } from '@fir/contracts'
import { diaCivil } from '@fir/domain'
import { Inject, Injectable } from '@nestjs/common'
import type { PessoaId } from '../banco/ator'
import { BancoService } from '../banco/banco.service'
import type { ClinicaId } from '../banco/clinica-id'
import { RELOGIO, type Relogio } from '../comum/relogio'
import { ContasService } from './contas.service'

export type ContextoDeHojeFinanceiro = {
  readonly clinicaId: ClinicaId
  readonly ator: PessoaId
  readonly fuso: string
  readonly podeCaixa: boolean
  readonly podeContas: boolean
  readonly podeGerirContas: boolean
  readonly podeFinmes: boolean
}

/**
 * O bloco financeiro da tela **Hoje** — montado no servidor, e **sem número
 * nenhum do caixa**.
 *
 * `caixaPendente` é booleano. A tela Hoje é a que a recepção recarrega o dia
 * inteiro; um valor aqui seria o esperado chegando pela porta dos fundos, com
 * a conferência do dia ainda por fazer. É a regra 6, e é por causa deste campo
 * que `/v1/hoje` está em `ROTAS_DE_CONFERENCIA`.
 */
@Injectable()
export class HojeFinanceiroService {
  // `@Inject` explícito: o esbuild não emite `design:paramtypes`.
  constructor(
    @Inject(BancoService) private readonly banco: BancoService,
    @Inject(ContasService) private readonly contas: ContasService,
    @Inject(RELOGIO) private readonly relogio: Relogio,
  ) {}

  async bloco(ctx: ContextoDeHojeFinanceiro): Promise<BlocoFinanceiroDeHoje> {
    const contas = ctx.podeContas
      ? await this.contas.paraAvisarHoje({
          clinicaId: ctx.clinicaId,
          ator: ctx.ator,
          fuso: ctx.fuso,
          gerir: ctx.podeGerirContas,
        })
      : []

    return { caixaPendente: await this.caixaPendente(ctx), contas: [...contas] }
  }

  /**
   * *"Fechar o caixa de hoje"* — e para QUEM o lembrete aparece.
   *
   * Três condições, e cada uma tem razão:
   *
   *  - **`caixa`**, porque um lembrete de uma ação que a pessoa não pode
   *    executar é ruído que ela aprende a ignorar — e junto com ele os outros;
   *  - **ser a responsável pelo caixa, ou não haver responsável definido, ou
   *    ter `finmes`.** A responsável é quem conta a gaveta; quem tem `finmes`
   *    é quem cobra o fechamento; e, sem ninguém configurado, o lembrete vai
   *    para todo mundo que pode fechar — porque o pior desfecho é o caixa não
   *    ser fechado por falta de uma configuração que ninguém sabia existir;
   *  - **o caixa de hoje ainda não ter sido fechado**.
   */
  private async caixaPendente(ctx: ContextoDeHojeFinanceiro): Promise<boolean> {
    if (!ctx.podeCaixa) return false
    const hoje = diaCivil(this.relogio.agora(), ctx.fuso)

    return this.banco.naClinica(ctx.clinicaId, ctx.ator, async (c) => {
      const fechado = await c.query(
        'SELECT 1 FROM caixas_do_dia WHERE clinica_id = $1 AND dia = $2::date',
        [ctx.clinicaId, hoje],
      )
      if (fechado.rowCount !== 0) return false
      if (ctx.podeFinmes) return true

      const cfg = await c.query<{ caixa_responsavel_id: string | null }>(
        'SELECT caixa_responsavel_id FROM configuracao_financeira WHERE clinica_id = $1',
        [ctx.clinicaId],
      )
      const responsavel = cfg.rows[0]?.caixa_responsavel_id ?? null
      return responsavel === null || responsavel === ctx.ator
    })
  }
}
