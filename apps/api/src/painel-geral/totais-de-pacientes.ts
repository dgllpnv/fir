import {
  Dinheiro,
  TIPOS_DE_CONTATO,
  TIPOS_DE_RECEITA,
  TIPOS_PAGAVEIS,
  TIPOS_QUE_ATENDEM,
  TIPO_PAGAMENTO_DE_ORCAMENTO,
} from '@fir/domain'
import type pg from 'pg'
import type { ClinicaId } from '../banco/clinica-id'
import { DINHEIRO_QUE_ENTROU } from '../financeiro/dinheiro-que-entrou'

export type TotaisDePacientes = {
  /** `ehReceita`: grupo Pagamentos, mais o atendimento pagável com dinheiro na própria tarefa. */
  readonly receita: Dinheiro
  readonly pagamentos: number
  readonly atendidos: number
  readonly contatos: number
  readonly orcamentosPagos: number
  /** PARTE da receita (`Pagamento de orçamento`), nunca somada a ela (números c.3). */
  readonly valorDosOrcamentosPagos: Dinheiro
}

/**
 * **OS TOTAIS DA TABELA "PACIENTES" DO PAINEL** — a fonte única da receita, do
 * ticket médio e do valor fechado em orçamentos, para o Painel e para os KPIs
 * `ticket_medio` e `valor_fechado_em_orcamentos` (spec I-7: movida do
 * `PainelService.pacientes`, sem mudar uma linha do SQL).
 *
 * Sobre TAREFAS CONCLUÍDAS na janela `[de, ate)`, com o recebimento vivo da
 * própria tarefa: a receita do Painel soma o que ENTROU, nunca a venda a prazo.
 */
export async function totaisDePacientes(
  c: pg.PoolClient,
  clinicaId: ClinicaId,
  j: { de: Date; ate: Date },
): Promise<TotaisDePacientes> {
  const EH_RECEITA = `(t.tipo = ANY($4::text[]) OR (t.tipo = ANY($5::text[]) AND r.valor > 0))`
  const r = await c.query<{
    receita: string
    pagamentos: string
    atendidos: string
    contatos: string
    orc_qtd: string
    orc_valor: string
  }>(
    `SELECT coalesce(sum(r.valor) FILTER (WHERE ${EH_RECEITA}), 0)::text AS receita,
            count(*) FILTER (WHERE ${EH_RECEITA})::text AS pagamentos,
            count(DISTINCT t.paciente_id) FILTER (WHERE t.tipo = ANY($7::text[]))::text AS atendidos,
            count(*) FILTER (WHERE t.tipo = ANY($6::text[]))::text AS contatos,
            count(*) FILTER (WHERE t.tipo = $8)::text AS orc_qtd,
            coalesce(sum(r.valor) FILTER (WHERE t.tipo = $8), 0)::text AS orc_valor
       FROM tarefas t
       LEFT JOIN recebimentos r
              ON r.tarefa_id = t.id AND r.estornado_em IS NULL AND ${DINHEIRO_QUE_ENTROU}
      WHERE t.clinica_id = $1
        AND t.excluida_em IS NULL
        AND t.status = 'concluida'
        AND t.paciente_id IS NOT NULL
        AND t.concluida_em >= $2 AND t.concluida_em < $3`,
    [
      clinicaId,
      j.de,
      j.ate,
      [...TIPOS_DE_RECEITA],
      [...TIPOS_PAGAVEIS],
      [...TIPOS_DE_CONTATO],
      [...TIPOS_QUE_ATENDEM],
      TIPO_PAGAMENTO_DE_ORCAMENTO,
    ],
  )
  const t = r.rows[0]!
  return {
    receita: Dinheiro.deCentavos(BigInt(t.receita)),
    pagamentos: Number(t.pagamentos),
    atendidos: Number(t.atendidos),
    contatos: Number(t.contatos),
    orcamentosPagos: Number(t.orc_qtd),
    valorDosOrcamentosPagos: Dinheiro.deCentavos(BigInt(t.orc_valor)),
  }
}

/** O ticket médio do Painel: receita ÷ pagamentos, pelo value object. Sem pagamento, `null`. */
export const ticketMedio = (t: Pick<TotaisDePacientes, 'receita' | 'pagamentos'>): Dinheiro | null =>
  t.pagamentos === 0 ? null : t.receita.media(t.pagamentos)

/** Os totais ADITIVOS de janelas disjuntas. `atendidos` é distinto por paciente e não soma — fica de fora. */
export type TotaisAditivos = Pick<TotaisDePacientes, 'receita' | 'pagamentos' | 'valorDosOrcamentosPagos'>

export const somarTotais = (partes: readonly TotaisDePacientes[]): TotaisAditivos =>
  partes.reduce<TotaisAditivos>(
    (s, t) => ({
      receita: s.receita.mais(t.receita),
      pagamentos: s.pagamentos + t.pagamentos,
      valorDosOrcamentosPagos: s.valorDosOrcamentosPagos.mais(t.valorDosOrcamentosPagos),
    }),
    { receita: Dinheiro.zero(), pagamentos: 0, valorDosOrcamentosPagos: Dinheiro.zero() },
  )
