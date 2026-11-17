import {
  Dinheiro,
  janela,
  TIPOS_DE_CONTATO,
  TIPOS_DE_RECEITA,
  TIPOS_PAGAVEIS,
  TIPOS_QUE_ATENDEM,
  TIPO_PAGAMENTO_DE_ORCAMENTO,
} from '@fir/domain'
import type pg from 'pg'
import type { ClinicaId } from '../banco/clinica-id'
import { DINHEIRO_QUE_ENTROU } from '../financeiro/dinheiro-que-entrou'
import { type DiasQueContam, diasQueContamNasTelas, trechosContinuos } from '../financeiro/faturamento-conferido'

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

/**
 * **OS TOTAIS DO PAINEL SÓ NOS DIAS QUE CONTAM** (ADR
 * chaves-em-reais-e-os-dias-de-caixa): `totaisDePacientes` medido em cada
 * trecho contínuo dos dias de `diasQueContamNasTelas`, e somado. É a fonte dos
 * KPIs `ticket_medio` e `valor_fechado_em_orcamentos` e do resumo do
 * relatório 13 (números c.3) — uma composição só.
 */
export async function totaisDosDiasQueContam(
  c: pg.PoolClient,
  clinicaId: ClinicaId,
  periodo: { readonly de: string; readonly ate: string },
  fuso: string,
  hoje: string,
): Promise<{ readonly totais: TotaisAditivos; readonly dias: DiasQueContam }> {
  const dias = await diasQueContamNasTelas(c, clinicaId, periodo.de, periodo.ate, fuso, hoje)
  const partes: TotaisDePacientes[] = []
  for (const t of trechosContinuos(dias.corte.dias)) partes.push(await totaisDePacientes(c, clinicaId, janela(t.de, t.ate, fuso)))
  return { totais: somarTotais(partes), dias }
}

/** Um "Pagamento de orçamento" concluído: a parcela de `orc_valor` que ele soma. */
export type PagamentoDeOrcamento = {
  readonly tarefaId: string
  readonly pacienteId: string
  readonly concluidaEm: string
  readonly valor: Dinheiro
}

/**
 * **O `orc_valor` TAREFA A TAREFA** — o MESMO `FROM`/`WHERE` de
 * `totaisDePacientes` com o `FILTER (WHERE t.tipo = Pagamento de orçamento)`
 * virado em `WHERE`, agrupado por tarefa. Σ das linhas = `valorDosOrcamentosPagos`
 * da mesma janela, por construção (protótipo, `orc_valor`). Relatório 13.
 */
export async function pagamentosDeOrcamentoDaJanela(
  c: pg.PoolClient,
  clinicaId: ClinicaId,
  j: { de: Date; ate: Date },
): Promise<PagamentoDeOrcamento[]> {
  const r = await c.query<{ id: string; paciente_id: string; concluida_em: Date; valor: string }>(
    `SELECT t.id::text AS id, t.paciente_id::text AS paciente_id, t.concluida_em,
            coalesce(sum(r.valor), 0)::text AS valor
       FROM tarefas t
       LEFT JOIN recebimentos r
              ON r.tarefa_id = t.id AND r.estornado_em IS NULL AND ${DINHEIRO_QUE_ENTROU}
      WHERE t.clinica_id = $1
        AND t.excluida_em IS NULL
        AND t.status = 'concluida'
        AND t.paciente_id IS NOT NULL
        AND t.concluida_em >= $2 AND t.concluida_em < $3
        AND t.tipo = $4
      GROUP BY t.id, t.paciente_id, t.concluida_em`,
    [clinicaId, j.de, j.ate, TIPO_PAGAMENTO_DE_ORCAMENTO],
  )
  return r.rows.map((l) => ({
    tarefaId: l.id,
    pacienteId: l.paciente_id,
    concluidaEm: l.concluida_em.toISOString(),
    valor: Dinheiro.deCentavos(BigInt(l.valor)),
  }))
}

/** `pagamentosDeOrcamentoDaJanela` só nos dias que contam — os trechos de `totaisDosDiasQueContam`. */
export async function pagamentosDeOrcamentoDosDiasQueContam(
  c: pg.PoolClient,
  clinicaId: ClinicaId,
  periodo: { readonly de: string; readonly ate: string },
  fuso: string,
  hoje: string,
): Promise<PagamentoDeOrcamento[]> {
  const dias = await diasQueContamNasTelas(c, clinicaId, periodo.de, periodo.ate, fuso, hoje)
  const fora: PagamentoDeOrcamento[] = []
  for (const t of trechosContinuos(dias.corte.dias)) fora.push(...(await pagamentosDeOrcamentoDaJanela(c, clinicaId, janela(t.de, t.ate, fuso))))
  return fora
}
