import { type FrequenciaDeKpi, lancamentosAGerar, marcadorDeLancamento } from '@fir/domain'
import type pg from 'pg'
import type { ClinicaId } from '../banco/clinica-id'

/**
 * **AS TAREFAS "LANÇAR [KPI]"** (spec I-30): gerar, reatribuir, cancelar.
 *
 * Três funções sobre a MESMA transação de quem chama (o job dentro de
 * `naClinica`, ou a escrita do KPI). Todas filtram por `clinica_id` além da
 * RLS (regra 19) e nenhuma loga — nem nome de KPI, nem "como medir" (appsec C29).
 *
 * A tarefa leva `marcador = 'lancamento-kpi:<kpiId>'`, `kpi_id` e
 * `kpi_referencia`. Só este arquivo escreve esse marcador (appsec C27).
 */

type KpiParaGerar = {
  id: string
  nome: string
  frequencia: FrequenciaDeKpi
  dia_de_lancamento: number
  responsavel_id: string
  solicitante_id: string
  tarefas_geradas_ate: string | null
}

/**
 * Gera para a frente, a partir do cursor `tarefas_geradas_ate`, até hoje + 35
 * (`lancamentosAGerar`, puro). **Reentrante**: o cursor só cresce, e o índice
 * `tarefa_de_rotina (clinica_id, marcador, prazo)` com `ON CONFLICT DO NOTHING`
 * fecha a corrida de duas rodadas ao mesmo tempo. Rodar três vezes dá o
 * mesmo conjunto; a tarefa excluída não volta, porque o prazo dela já ficou
 * atrás do cursor (C.3).
 *
 * Só KPI manual, vivo e com responsável ATIVO: a tarefa precisa de destino
 * (`tarefa_tem_destino`), e tarefa de quem saiu da clínica não aparece para
 * ninguém. Sem responsável, o cursor não anda — a geração começa quando
 * alguém for escolhida.
 *
 * `kpiId` restringe a um KPI (a escrita do KPI gera na hora, sem esperar a
 * madrugada). Devolve quantas tarefas nasceram.
 */
export async function gerarTarefasDeLancamento(
  c: pg.PoolClient,
  clinicaId: ClinicaId,
  hoje: string,
  kpiId: string | null = null,
): Promise<number> {
  const kpis = await c.query<KpiParaGerar>(
    `SELECT k.id, k.nome, k.frequencia, k.dia_de_lancamento, k.responsavel_id,
            coalesce(k.criado_por, k.responsavel_id) AS solicitante_id,
            k.tarefas_geradas_ate::text AS tarefas_geradas_ate
       FROM kpis k
       JOIN pessoas p ON p.clinica_id = k.clinica_id AND p.id = k.responsavel_id
                     AND p.ativo AND p.excluida_em IS NULL
      WHERE k.clinica_id = $1 AND k.origem = 'manual' AND k.arquivado_em IS NULL
        AND ($2::uuid IS NULL OR k.id = $2::uuid)
      ORDER BY k.id
        FOR UPDATE OF k`,
    [clinicaId, kpiId],
  )
  let criadas = 0
  for (const k of kpis.rows) {
    const g = lancamentosAGerar({ frequencia: k.frequencia, diaDeLancamento: k.dia_de_lancamento }, k.tarefas_geradas_ate, hoje)
    for (const t of g.tarefas) {
      const r = await c.query(
        `INSERT INTO tarefas
           (clinica_id, solicitante_id, responsavel_id, descricao, prazo, prioridade, status,
            historico, resultado, obs, recorrencia, marcador, kpi_id, kpi_referencia)
         VALUES ($1, $2, $3, $4, $5::date, 'normal', 'aberta', '[]', '', '', $6, $7, $8, $9::date)
         ON CONFLICT (clinica_id, marcador, prazo)
           WHERE marcador IS NOT NULL AND excluida_em IS NULL
           DO NOTHING`,
        [
          clinicaId,
          k.solicitante_id,
          k.responsavel_id,
          `Lançar ${k.nome}`,
          t.prazo,
          k.frequencia === 'semanal' ? 'Semanal' : 'Mensal',
          marcadorDeLancamento(k.id),
          k.id,
          t.referencia,
        ],
      )
      criadas += r.rowCount ?? 0
    }
    if (g.geradasAte !== null && g.geradasAte !== k.tarefas_geradas_ate) {
      // GREATEST: o cursor nunca anda para trás, nem numa corrida.
      await c.query(
        `UPDATE kpis SET tarefas_geradas_ate = GREATEST(coalesce(tarefas_geradas_ate, $3::date), $3::date)
          WHERE clinica_id = $1 AND id = $2`,
        [clinicaId, k.id, g.geradasAte],
      )
    }
  }
  return criadas
}

/**
 * Trocar a responsável leva as tarefas ABERTAS de lançamento junto (I-30) —
 * as atrasadas inclusive: a antiga não pode mais lançar (appsec C1), e uma
 * tarefa que ela vê e não consegue concluir é tarefa morta. As concluídas e
 * canceladas ficam como estão: são o histórico de quem lançou.
 *
 * Sem responsável nova (`null`), as abertas são canceladas — tarefa precisa
 * de destino.
 */
export async function reatribuirTarefasDeLancamento(
  c: pg.PoolClient,
  clinicaId: ClinicaId,
  kpiId: string,
  responsavelId: string | null,
): Promise<number> {
  if (responsavelId === null) return cancelarTarefasDeLancamento(c, clinicaId, kpiId)
  const r = await c.query(
    `UPDATE tarefas SET responsavel_id = $3
      WHERE clinica_id = $1 AND kpi_id = $2 AND kpi_referencia IS NOT NULL
        AND status = 'aberta' AND excluida_em IS NULL AND responsavel_id IS DISTINCT FROM $3`,
    [clinicaId, kpiId, responsavelId],
  )
  return r.rowCount ?? 0
}

/**
 * Arquivar o KPI cancela as tarefas ABERTAS de lançamento (I-30): lançar num
 * KPI arquivado é 409, e a tarefa ficaria pedindo o impossível. Cancelar é
 * estado, não exclusão — a trilha guarda.
 */
export async function cancelarTarefasDeLancamento(c: pg.PoolClient, clinicaId: ClinicaId, kpiId: string): Promise<number> {
  const r = await c.query(
    `UPDATE tarefas SET status = 'cancelada'
      WHERE clinica_id = $1 AND kpi_id = $2 AND kpi_referencia IS NOT NULL
        AND status = 'aberta' AND excluida_em IS NULL`,
    [clinicaId, kpiId],
  )
  return r.rowCount ?? 0
}
