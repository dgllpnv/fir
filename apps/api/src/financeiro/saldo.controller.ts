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
      const saldo = saldoNoContrato(await saldoDe(cx, c.clinicaId, id))
      // O NOME do programa, para a tela dizer QUAL dívida: os procedimentos que
      // ele contém ("Tirzepatida", "Tirzepatida + Semaglutida"). Nome de
      // procedimento não é dinheiro nem dose.
      const ids = saldo.grupos.flatMap((g) => (g.programaId === null ? [] : [g.programaId]))
      if (ids.length === 0) return saldo
      const nomes = await cx.query<{ programa_id: string; nome: string }>(
        `SELECT i.programa_id, string_agg(DISTINCT pr.nome, ' + ' ORDER BY pr.nome) AS nome
           FROM itens_do_programa i JOIN procedimentos pr ON pr.id = i.procedimento_id
          WHERE i.programa_id = ANY($1::uuid[]) GROUP BY i.programa_id`,
        [ids],
      )
      const porPrograma = new Map(nomes.rows.map((x) => [x.programa_id, x.nome]))
      return {
        ...saldo,
        grupos: saldo.grupos.map((g) => ({
          ...g,
          programa: g.programaId === null ? null : (porPrograma.get(g.programaId) ?? 'Programa'),
        })),
      }
    })
  }
}
