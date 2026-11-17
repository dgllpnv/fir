import { Dinheiro } from '@fir/domain'
import type pg from 'pg'
import type { ClinicaId } from '../banco/clinica-id'
import { DINHEIRO_QUE_ENTROU } from './dinheiro-que-entrou'

/**
 * **QUANTO ENTROU NA FIR, recebimento a recebimento, com o dia civil da
 * clínica.** A Visão do mês (o `recebido` e a meta) e a Conferência MedX × FIR
 * do Painel leem daqui (parecer de números A8): uma segunda consulta de
 * "quanto entrou" é uma consulta que um dia discorda desta.
 *
 * UM item por recebimento, com `r.valor` (a receita conta cada pagamento uma
 * vez, regra 3), sem estornado, sem tarefa excluída, sem Outras entradas. A
 * receita soma `recebimentos` e nunca lê o valor da tarefa (regra 4).
 *
 * `janela` em instantes UTC, semiaberta `[de, ate)` (regra 23).
 */
export async function recebidosDaJanela(
  c: pg.PoolClient,
  clinicaId: ClinicaId,
  janela: { readonly de: Date; readonly ate: Date },
  fuso: string,
): Promise<{ valor: Dinheiro; dia: string }[]> {
  const r = await c.query<{ valor: string; dia: string }>(
    `SELECT r.valor::text AS valor,
            ((r.recebido_em AT TIME ZONE $4)::date)::text AS dia
       FROM recebimentos r
       LEFT JOIN tarefas t ON t.id = r.tarefa_id
      WHERE r.clinica_id = $1 AND r.estornado_em IS NULL
        AND ${DINHEIRO_QUE_ENTROU}
        AND r.recebido_em >= $2 AND r.recebido_em < $3
        AND (t.id IS NULL OR t.excluida_em IS NULL)`,
    [clinicaId, janela.de, janela.ate, fuso],
  )
  return r.rows.map((x) => ({ valor: Dinheiro.deCentavos(BigInt(x.valor)), dia: x.dia }))
}

/** A soma por dia civil. */
export function porDia(recebidos: readonly { valor: Dinheiro; dia: string }[]): Map<string, Dinheiro> {
  const m = new Map<string, Dinheiro>()
  for (const x of recebidos) m.set(x.dia, (m.get(x.dia) ?? Dinheiro.zero()).mais(x.valor))
  return m
}
