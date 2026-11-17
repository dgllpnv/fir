import type { EventoDeJornada } from '@fir/domain'
import type pg from 'pg'
import type { ClinicaId } from '../banco/clinica-id'

/** O cartão de jornada e o histórico dele — o que os KPIs I-10/I-11 e o relatório 14 leem. */
export type HistoricoDoCartao = {
  readonly tarefaId: string
  readonly pacienteId: string
  /** Nome da paciente ATIVA; `null` se desativada ou anonimizada. */
  readonly paciente: string | null
  readonly telefone: string | null
  readonly historico: readonly Pick<EventoDeJornada, 'acao' | 'etapa' | 'em'>[]
}

/**
 * **OS CARTÕES COM ALGUM EVENTO NA JANELA** `[de, ate)` (I-10, I-11) — a
 * leitura de `comparecimento` e `faltas_recontatadas` e a do relatório 14,
 * escrita uma vez: o relatório conta as mesmas faltas que o KPI.
 *
 * O cartão de paciente desativada continua (o KPI o conta); só o nome sai
 * `null`.
 */
export async function historicosDaJanela(
  c: pg.PoolClient,
  clinicaId: ClinicaId,
  j: { readonly de: Date; readonly ate: Date },
): Promise<HistoricoDoCartao[]> {
  const r = await c.query<{
    id: string
    paciente_id: string
    paciente: string | null
    telefone: string | null
    historico: HistoricoDoCartao['historico']
  }>(
    `SELECT t.id, t.paciente_id, CASE WHEN pa.ativo THEN pa.nome END AS paciente,
            CASE WHEN pa.ativo THEN pa.telefone END AS telefone, t.historico
       FROM tarefas t
       LEFT JOIN pacientes pa ON pa.id = t.paciente_id AND pa.clinica_id = t.clinica_id
      WHERE t.clinica_id = $1 AND t.excluida_em IS NULL AND t.paciente_id IS NOT NULL
        AND EXISTS (SELECT 1 FROM jsonb_array_elements(t.historico) ev
                     WHERE ev ? 'em' AND (ev->>'em')::timestamptz >= $2 AND (ev->>'em')::timestamptz < $3)
      ORDER BY t.id`,
    [clinicaId, j.de, j.ate],
  )
  return r.rows.map((l) => ({
    tarefaId: l.id,
    pacienteId: l.paciente_id,
    paciente: l.paciente,
    telefone: l.telefone,
    historico: l.historico,
  }))
}
