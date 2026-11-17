import { Dinheiro, TIPOS_DE_RECEITA, TIPOS_PAGAVEIS } from '@fir/domain'
import type pg from 'pg'
import type { ClinicaId } from '../banco/clinica-id'
import { DINHEIRO_QUE_ENTROU } from '../financeiro/dinheiro-que-entrou'
import { baseDeReceita, caixaFechado } from './metricas-diarias'

/** Uma indicadora e as pacientes que ela indicou na janela. */
export type IndicadoraDaJanela = {
  readonly pacienteId: string
  readonly nome: string
  readonly telefone: string
  readonly indicadas: number
  /** Os ids das indicadas — para contar quem virou paciente. Nunca o nome (terceiras, I-38). */
  readonly indicadaIds: readonly string[]
}

/**
 * **QUEM INDICOU NA JANELA** — a regra de "Quem mais indica" do Painel
 * (correções da PO, B3), movida para cá sem mudar o `WHERE` nem a ordem, para
 * o relatório 4 contar as mesmas pacientes que o Painel conta.
 *
 * Pela data de CADASTRO da indicada (`[de, ate)`), só por `indicado_por_id`,
 * indicadora ATIVA, `count(DISTINCT indicada)` — nenhum `JOIN` com tarefas ou
 * recebimentos aqui: com ele, a indicada com 12 sessões pagas viraria 12
 * indicações (N-19). `clinica_id = $1` nas DUAS pontas além da RLS (S-39).
 * Desempate `nome, id` antes do `LIMIT` (N-21).
 *
 * `limite`: o Painel mostra as dez primeiras; o relatório, todas.
 */
export async function indicadorasDaJanela(
  c: pg.PoolClient,
  clinicaId: ClinicaId,
  j: { readonly de: Date; readonly ate: Date },
  limite: number | null,
): Promise<IndicadoraDaJanela[]> {
  const r = await c.query<{ id: string; nome: string; telefone: string; n: string; indicadas: string[] }>(
    `SELECT i.id::text AS id, i.nome, i.telefone, count(DISTINCT p.id)::text AS n,
            array_agg(DISTINCT p.id::text) AS indicadas
       FROM pacientes p
       JOIN pacientes i ON i.clinica_id = p.clinica_id AND i.id = p.indicado_por_id
      WHERE p.clinica_id = $1 AND i.clinica_id = $1
        AND p.indicado_por_id IS NOT NULL
        AND i.ativo
        AND p.criado_em >= $2 AND p.criado_em < $3
      GROUP BY i.id, i.nome, i.telefone
      ORDER BY count(DISTINCT p.id) DESC, i.nome ASC, i.id ASC
      LIMIT $4`,
    [clinicaId, j.de, j.ate, limite],
  )
  return r.rows.map((l) => ({
    pacienteId: l.id,
    nome: l.nome,
    telefone: l.telefone,
    indicadas: Number(l.n),
    indicadaIds: l.indicadas,
  }))
}

/**
 * **A RECEITA DAS INDICADAS NO PERÍODO** (relatório 4; números N-22). As
 * mesmas portas do "Top pagantes" do Painel: o universo `baseDeReceita` (com
 * `DINHEIRO_QUE_ENTROU` e `estornado_em IS NULL`), a conclusão da tarefa em
 * `[de, ate)` e o corte `caixaFechado` — sem ele, a janela de hoje mostraria o
 * que a gaveta deve ter antes do fechamento (regra 6). Nunca `valorOrcamento`.
 */
export async function receitaNoPeriodo(
  c: pg.PoolClient,
  clinicaId: ClinicaId,
  fuso: string,
  pacienteIds: readonly string[],
  j: { readonly de: Date; readonly ate: Date },
): Promise<Map<string, Dinheiro>> {
  const fora = new Map<string, Dinheiro>()
  if (pacienteIds.length === 0) return fora
  const r = await c.query<{ id: string; valor: string }>(
    `SELECT t.paciente_id::text AS id, sum(r.valor)::text AS valor
       FROM tarefas t
       JOIN recebimentos r
         ON r.tarefa_id = t.id AND r.estornado_em IS NULL AND ${DINHEIRO_QUE_ENTROU}
      WHERE ${baseDeReceita('$1', '$3', '$4')}
        AND ${caixaFechado('$1', '$2')}
        AND t.concluida_em >= $5 AND t.concluida_em < $6
        AND t.paciente_id = ANY($7::uuid[])
      GROUP BY t.paciente_id`,
    [clinicaId, fuso, [...TIPOS_DE_RECEITA], [...TIPOS_PAGAVEIS], j.de, j.ate, [...pacienteIds]],
  )
  for (const l of r.rows) fora.set(l.id, Dinheiro.deCentavos(BigInt(l.valor)))
  return fora
}
