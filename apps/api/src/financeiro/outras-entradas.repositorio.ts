import { Dinheiro } from '@fir/domain'
import type pg from 'pg'

/**
 * **A LEITURA DAS OUTRAS ENTRADAS, escrita uma vez** (fatia 4.2).
 *
 * Quem pergunta "quanto entrou de outras entradas" — esperado do caixa, mudança
 * depois do fechamento, Visão do mês, painel — passa por aqui, e por isso o
 * filtro de vivas (`estornada_em IS NULL`) e a janela semiaberta moram num lugar
 * só. O quinto leitor não será revisado com o cuidado do primeiro.
 *
 * `outras_entradas` NÃO é `recebimentos`: não tem paciente, não tem tarefa, não
 * entra em LTV, ticket, campanhas, saldo, funil, indicadores nem na conferência
 * de migração — e nenhuma dessas consultas passa por este arquivo.
 */
export const OUTRA_ENTRADA_VIVA = 'oe.estornada_em IS NULL'

export type OutraEntradaDaJanela = {
  readonly forma: string
  readonly valor: Dinheiro
  /** O dia civil da clínica em que caiu (para o recorte "dias com caixa fechado"). */
  readonly dia: string
}

/**
 * As outras entradas VIVAS de uma janela semiaberta `[de, ate)` — instantes UTC
 * calculados no fuso da clínica por `janela()` (regras 22 e 23), nunca `::date`
 * sobre UTC.
 */
export async function outrasEntradasDaJanela(
  c: pg.PoolClient,
  clinicaId: string,
  j: { readonly de: Date; readonly ate: Date },
  fuso: string,
): Promise<readonly OutraEntradaDaJanela[]> {
  const r = await c.query<{ forma: string; valor: string; dia: string }>(
    `SELECT oe.forma, oe.valor::text AS valor,
            ((oe.recebida_em AT TIME ZONE $4)::date)::text AS dia
       FROM outras_entradas oe
      WHERE oe.clinica_id = $1 AND ${OUTRA_ENTRADA_VIVA}
        AND oe.recebida_em >= $2 AND oe.recebida_em < $3`,
    [clinicaId, j.de, j.ate, fuso],
  )
  return r.rows.map((x) => ({
    forma: x.forma,
    valor: Dinheiro.deCentavos(BigInt(x.valor)),
    dia: x.dia,
  }))
}
