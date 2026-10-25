import type { SaldoDoPaciente } from '@fir/contracts'
import { Controller, Get, Inject, NotFoundException, Param, ParseUUIDPipe, Req } from '@nestjs/common'
import { DadoSensivel } from '../auditoria/acesso.decorator'
import { Exige } from '../autorizacao/autorizacao.guard'
import { BancoService } from '../banco/banco.service'
import type { RequisicaoComContexto } from '../comum/contexto'
import { saldoDe, saldoNoContrato } from './saldo.repositorio'

/**
 * `GET /v1/pacientes/:id/saldo` — o saldo em aberto, **agrupado**.
 *
 * Mora em `financeiro/` e não em `pacientes/` porque a regra é do financeiro:
 * o que o paciente deve, por grupo, com o crédito preservado. O caminho é de
 * paciente porque é dele que a tela parte.
 *
 * `@Exige('pacientes')` e não `valores`: a equipe sem `valores` precisa saber
 * **que** existe saldo — é o aviso antes de uma sessão e é a fila da tela
 * Cobranças. O número é apagado pelo `RedacaoInterceptor`, num ponto só, e
 * `temSaldo` atravessa porque não é monetário. Nenhum `if` aqui.
 *
 * `@DadoSensivel` pelo mesmo motivo que a ficha: "quanto a paciente X deve" é
 * uma pergunta sobre uma pessoa, e a regra 18 pede registro de ACESSO, não só
 * de escrita.
 */
@Controller('v1/pacientes')
@Exige('pacientes')
export class SaldoController {
  // `@Inject` explícito: o esbuild não emite `design:paramtypes`.
  constructor(@Inject(BancoService) private readonly banco: BancoService) {}

  @Get(':id/saldo')
  @DadoSensivel('pacientes')
  async saldo(
    @Req() req: RequisicaoComContexto,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<SaldoDoPaciente> {
    // `!` seguro: `SessaoGuard` é global e esta rota não é `@Publico()`.
    const c = req.contexto!
    return this.banco.naClinica(c.clinicaId, c.ator, async (cx) => {
      // A RLS já filtra; zero linhas é a mesma resposta de "não existe", que é
      // o 404 que não confirma a existência de paciente em outra clínica.
      const p = await cx.query('SELECT 1 FROM pacientes WHERE id = $1', [id])
      if (p.rowCount === 0) throw new NotFoundException('Paciente não encontrado.')
      return saldoNoContrato(await saldoDe(cx, c.clinicaId, id))
    })
  }
}
