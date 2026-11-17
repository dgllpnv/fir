import { fimDoMes, somarMeses } from '@fir/domain'
import type pg from 'pg'
import type { ClinicaId } from '../banco/clinica-id'

/**
 * **A META RECORRENTE (I-24)**: uma `Série` (`series_de_meta`) que materializa
 * a meta `recorrente` do mês corrente e do próximo, cada uma um mês civil
 * inteiro, com o alvo da série.
 *
 * - **Idempotente:** `ON CONFLICT (serie_id, inicio) DO NOTHING`. Rodar o job
 *   três vezes deixa uma meta por mês. A meta do mês que alguém arquivou
 *   continua lá, arquivada, e por isso **não renasce** (regra 27).
 * - **O mês já ocupado** por outra meta viva do KPI (o `EXCLUDE` da I-25)
 *   fica sem a meta da série, e nada falha. A meta que a pessoa criou vale
 *   mais que a série. Cada tentativa corre num `SAVEPOINT`.
 * - A série não tem partida: cada mês parte do zero.
 *
 * Os meses de antes de `desde` nunca são materializados, e o job não volta
 * atrás de mês passado.
 */
export async function materializarSeries(
  c: pg.PoolClient,
  clinicaId: ClinicaId,
  hoje: string,
  serieId: string | null = null,
): Promise<number> {
  const series = await c.query<{
    id: string
    kpi_id: string
    resultado_chave_id: string | null
    alvo_centavos: string | null
    alvo_numero: string | null
    responsavel_id: string | null
    medida_por: string
    desde: string
    criada_por: string | null
  }>(
    `SELECT id, kpi_id, resultado_chave_id, alvo_centavos::text AS alvo_centavos, alvo_numero::text AS alvo_numero,
            responsavel_id, medida_por, desde::text AS desde, criada_por
       FROM series_de_meta
      WHERE clinica_id = $1 AND arquivada_em IS NULL AND ($2::uuid IS NULL OR id = $2::uuid)`,
    [clinicaId, serieId],
  )
  const corrente = `${hoje.slice(0, 7)}-01`
  let criadas = 0
  for (const s of series.rows) {
    for (const inicio of [corrente, somarMeses(corrente, 1)]) {
      if (inicio < s.desde) continue
      await c.query('SAVEPOINT serie_de_meta')
      try {
        const r = await c.query(
          `INSERT INTO metas_de_kpi (clinica_id, kpi_id, resultado_chave_id, serie_id, tipo, inicio, prazo,
                                     alvo_centavos, alvo_numero, responsavel_id, medida_por, definida_por)
           VALUES ($1, $2, $3, $4, 'recorrente', $5::date, $6::date, $7, $8, $9, $10, $11)
           ON CONFLICT (serie_id, inicio) DO NOTHING`,
          [clinicaId, s.kpi_id, s.resultado_chave_id, s.id, inicio, fimDoMes(inicio.slice(0, 7)),
            s.alvo_centavos, s.alvo_numero, s.responsavel_id, s.medida_por, s.criada_por],
        )
        criadas += r.rowCount ?? 0
        await c.query('RELEASE SAVEPOINT serie_de_meta')
      } catch (e) {
        await c.query('ROLLBACK TO SAVEPOINT serie_de_meta')
        // Só o mês ocupado (EXCLUDE, 23P01) é esperado; o resto sobe.
        if ((e as { code?: string }).code !== '23P01') throw e
      }
    }
  }
  return criadas
}
