import type pg from 'pg'
import type { ClinicaId } from '../banco/clinica-id'
import { sqlEventoDesfeito } from './parcial'

/** Um cartão de orçamento do relatório 13. */
export type OrcamentoDaJanela = {
  readonly tarefaId: string
  readonly pacienteId: string
  /** Nome da paciente ATIVA; `null` se desativada ou anonimizada. */
  readonly nome: string | null
  /** O dia civil (fuso da clínica) do último `registrarOrcamento` vivo — na janela, se houver; senão, o último. */
  readonly dia: string
  readonly etapa: string
  /** O NOME do motivo do último `perder` vivo — só com o cartão em `perdido`. Nunca a nota. */
  readonly motivo: string | null
  readonly valorOrcamento: bigint | null
}

/**
 * **OS ORÇAMENTOS DO RELATÓRIO 13** — os cartões com `registrarOrcamento` VIVO
 * em `[de, ate)` (o passo "Orçamentos" do funil, ADR 0004), mais os cartões
 * `alem` (os que receberam um pagamento de orçamento no período, para a coluna
 * somar o resumo). O orçamento excluído não é orçamento (`sqlEventoDesfeito`,
 * o fragmento do funil). A paciente desativada fica, sem nome: o resumo, que é
 * o do Painel, a conta.
 */
export async function orcamentosDaJanela(
  c: pg.PoolClient,
  clinicaId: ClinicaId,
  j: { readonly de: Date; readonly ate: Date },
  fuso: string,
  alem: readonly string[] = [],
): Promise<OrcamentoDaJanela[]> {
  const r = await c.query<{
    id: string
    paciente_id: string
    nome: string | null
    dia: string
    etapa: string
    motivo: string | null
    valor_orcamento: string | null
  }>(
    `SELECT t.id, t.paciente_id, CASE WHEN pa.ativo THEN pa.nome END AS nome,
            (coalesce(o.em, g.em) AT TIME ZONE $4)::date::text AS dia, t.etapa,
            CASE WHEN t.etapa = 'perdido' THEN (
              SELECT p.v->>'motivo' FROM jsonb_array_elements(t.historico) WITH ORDINALITY AS p(v, o)
               WHERE p.v->>'acao' = 'perder' AND NOT ${sqlEventoDesfeito('t', 'p.v', 'p.o')}
               ORDER BY p.o DESC LIMIT 1) END AS motivo,
            t.valor_orcamento::text AS valor_orcamento
       FROM tarefas t
       JOIN pacientes pa ON pa.id = t.paciente_id AND pa.clinica_id = t.clinica_id
       CROSS JOIN LATERAL (
         SELECT max((e.v->>'em')::timestamptz) AS em
           FROM jsonb_array_elements(t.historico) WITH ORDINALITY AS e(v, o)
          WHERE e.v->>'acao' = 'registrarOrcamento'
            AND (e.v->>'em')::timestamptz >= $2 AND (e.v->>'em')::timestamptz < $3
            AND NOT ${sqlEventoDesfeito('t', 'e.v', 'e.o')}
       ) o
       CROSS JOIN LATERAL (
         SELECT max((e.v->>'em')::timestamptz) AS em
           FROM jsonb_array_elements(t.historico) AS e(v)
          WHERE e.v->>'acao' = 'registrarOrcamento'
       ) g
      WHERE t.clinica_id = $1 AND t.excluida_em IS NULL
        AND (o.em IS NOT NULL OR (t.id = ANY($5::uuid[]) AND g.em IS NOT NULL))
      ORDER BY coalesce(o.em, g.em), t.id`,
    [clinicaId, j.de, j.ate, fuso, [...alem]],
  )
  return r.rows.map((l) => ({
    tarefaId: l.id,
    pacienteId: l.paciente_id,
    nome: l.nome,
    dia: l.dia,
    etapa: l.etapa,
    motivo: l.motivo,
    valorOrcamento: l.valor_orcamento === null ? null : BigInt(l.valor_orcamento),
  }))
}

/**
 * De qual cartão é cada "Pagamento de orçamento": a companheira nasce no
 * `fechar` do cartão, concluída NO INSTANTE do evento, da mesma paciente — a
 * mesma ligação que `efeitoDoDesfazerOrcamento` usa para estornar. O pagamento
 * sem cartão (lançado à mão) não volta no mapa.
 */
export async function cartoesDosPagamentos(
  c: pg.PoolClient,
  clinicaId: ClinicaId,
  pagamentoIds: readonly string[],
): Promise<Map<string, string>> {
  const fora = new Map<string, string>()
  if (pagamentoIds.length === 0) return fora
  const r = await c.query<{ pagamento: string; cartao: string }>(
    `SELECT DISTINCT ON (pg.id) pg.id::text AS pagamento, o.id::text AS cartao
       FROM tarefas pg
       JOIN tarefas o ON o.clinica_id = pg.clinica_id AND o.paciente_id = pg.paciente_id
                     AND o.id <> pg.id AND o.excluida_em IS NULL
      WHERE pg.clinica_id = $1 AND pg.id = ANY($2::uuid[])
        AND EXISTS (SELECT 1 FROM jsonb_array_elements(o.historico) f
                     WHERE f->>'acao' = 'fechar' AND (f->>'em')::timestamptz = pg.concluida_em)
      ORDER BY pg.id, o.id`,
    [clinicaId, [...pagamentoIds]],
  )
  for (const l of r.rows) fora.set(l.pagamento, l.cartao)
  return fora
}
