import { somarDias, TIPOS_QUE_ATENDEM } from '@fir/domain'
import type pg from 'pg'
import type { ClinicaId } from '../banco/clinica-id'
import { DINHEIRO_QUE_ENTROU } from '../financeiro/dinheiro-que-entrou'
import { diasQueContamNasTelas } from '../financeiro/faturamento-conferido'

/**
 * **"PACIENTE NOVO" — escrito uma vez**, para a tabela "Novos pacientes" do
 * Painel e para o KPI `novos_pacientes` (spec I-7: mover, nunca copiar).
 *
 * Cadastro em `[$2, $3)` e paciente ativo, na clínica `$1`. Pressupõe
 * `pacientes` como `pa`.
 */
export const PACIENTE_NOVO_NA_JANELA = `pa.clinica_id = $1 AND pa.ativo AND pa.criado_em >= $2 AND pa.criado_em < $3`

/** O rótulo da origem: a linha do Painel e o filtro `origem` do KPI. */
export const ORIGEM_DO_PACIENTE = `CASE WHEN pa.origem = '' THEN 'Não informada' ELSE pa.origem END`

/**
 * "Já atendida": uma tarefa de atendimento concluída — a coluna "já atendidos"
 * do Painel e o "convertido" do relatório 6. `$4` são os tipos que atendem.
 */
export const JA_ATENDIDO = `EXISTS (SELECT 1 FROM tarefas t
                               WHERE t.paciente_id = pa.id AND t.excluida_em IS NULL
                                 AND t.status = 'concluida' AND t.tipo = ANY($4::text[]))`

/**
 * O LTV da paciente nova (`LATERAL`, coluna `valor`): o que ela já pagou na
 * vida, sem o corte de caixa — a coluna "LTV" do Painel e a "receita" do
 * relatório 6. Promessa não é pagamento: `DINHEIRO_QUE_ENTROU` (D-9).
 */
export const LTV_DO_NOVO = `
           SELECT coalesce(sum(r.valor), 0) AS valor
             FROM recebimentos r
            WHERE r.paciente_id = pa.id AND r.estornado_em IS NULL
              AND ${DINHEIRO_QUE_ENTROU}`

/** Uma paciente nova da janela, com o que a linha do Painel conta dela. */
export type PacienteNovo = {
  readonly pacienteId: string
  readonly nome: string
  readonly telefone: string
  readonly origem: string
  readonly campanhaId: string | null
  readonly campanha: string | null
  readonly jaAtendida: boolean
  readonly ltv: bigint
}

/**
 * **AS PACIENTES NOVAS, UMA POR UMA** — o relatório 6. É o MESMO recorte da
 * tabela "Novos pacientes" do Painel (`PACIENTE_NOVO_NA_JANELA`, o rótulo
 * `ORIGEM_DO_PACIENTE`, `JA_ATENDIDO` e `LTV_DO_NOVO`): agrupadas por origem,
 * estas linhas dão `novos` e `jaAtendidos` do Painel. A campanha é a de
 * origem do cadastro (`pacientes.campanha_id`), nunca reescrita.
 */
export async function pacientesNovosDaJanela(
  c: pg.PoolClient,
  clinicaId: ClinicaId,
  j: { readonly de: Date; readonly ate: Date },
  campanhaId: string | null,
): Promise<PacienteNovo[]> {
  const r = await c.query<{
    id: string
    nome: string
    telefone: string
    origem: string
    campanha_id: string | null
    campanha: string | null
    atendida: boolean
    ltv: string
  }>(
    `SELECT pa.id, pa.nome, pa.telefone, ${ORIGEM_DO_PACIENTE} AS origem,
            pa.campanha_id, cp.nome AS campanha,
            ${JA_ATENDIDO} AS atendida,
            ltv.valor::text AS ltv
       FROM pacientes pa
       CROSS JOIN LATERAL (${LTV_DO_NOVO}) ltv
       LEFT JOIN campanhas cp ON cp.id = pa.campanha_id AND cp.clinica_id = pa.clinica_id
      WHERE ${PACIENTE_NOVO_NA_JANELA}
        AND ($5::uuid IS NULL OR pa.campanha_id = $5::uuid)
      ORDER BY pa.nome, pa.id`,
    [clinicaId, j.de, j.ate, [...TIPOS_QUE_ATENDEM], campanhaId],
  )
  return r.rows.map((l) => ({
    pacienteId: l.id,
    nome: l.nome,
    telefone: l.telefone,
    origem: l.origem,
    campanhaId: l.campanha_id,
    campanha: l.campanha,
    jaAtendida: l.atendida,
    ltv: BigInt(l.ltv),
  }))
}

/**
 * **OS DIAS QUE AINDA NÃO CONTAM** para o LTV de uma tela: os do mês corrente
 * fora de `diasQueContamNasTelas` (sem caixa fechado, e hoje aberto). O LTV é
 * a vida da paciente, mas a parte dele de um dia aberto é o esperado da gaveta
 * (regra 6): quem tira, tira estes. Mês passado conta sempre (emenda da c.10).
 */
export async function diasQueAindaNaoContam(c: pg.PoolClient, clinicaId: ClinicaId, fuso: string, hoje: string): Promise<string[]> {
  const inicioDoMes = `${hoje.slice(0, 7)}-01`
  const contam = new Set((await diasQueContamNasTelas(c, clinicaId, inicioDoMes, hoje, fuso, hoje)).corte.dias)
  const fora: string[] = []
  for (let d = inicioDoMes; d <= hoje; d = somarDias(d, 1)) if (!contam.has(d)) fora.push(d)
  return fora
}

/**
 * A parte de `LTV_DO_NOVO` que caiu nos dias `$dias` (`text[]`, no fuso
 * `$fuso`) — o mesmo filtro, mais o dia. O Painel (por origem) e o relatório
 * 6 (por paciente) a subtraem do LTV.
 */
export const ltvNosDias = (dias: string, fuso: string): string => `
           SELECT coalesce(sum(r.valor), 0) AS valor
             FROM recebimentos r
            WHERE r.paciente_id = pa.id AND r.estornado_em IS NULL
              AND ${DINHEIRO_QUE_ENTROU}
              AND ((r.recebido_em AT TIME ZONE ${fuso})::date)::text = ANY(${dias}::text[])`

/**
 * O que estas pacientes pagaram NOS DIAS dados (`aaaa-mm-dd`, no fuso da
 * clínica), pelo mesmo filtro de `LTV_DO_NOVO`. O relatório 6 tira isto da
 * receita por paciente: são os dias do mês corrente que ainda não contam (sem
 * caixa fechado, e hoje) — uma linha por paciente entregaria o esperado da
 * gaveta (regra 6, c.10; validação do T9, D4).
 */
export async function pagoNosDias(
  c: pg.PoolClient,
  clinicaId: ClinicaId,
  fuso: string,
  pacienteIds: readonly string[],
  dias: readonly string[],
): Promise<Map<string, bigint>> {
  const fora = new Map<string, bigint>()
  if (pacienteIds.length === 0 || dias.length === 0) return fora
  const r = await c.query<{ id: string; valor: string }>(
    `SELECT pa.id::text AS id, ltv.valor::text AS valor
       FROM pacientes pa
       CROSS JOIN LATERAL (${ltvNosDias('$4', '$3')}) ltv
      WHERE pa.clinica_id = $1 AND pa.id = ANY($2::uuid[])`,
    [clinicaId, [...pacienteIds], fuso, [...dias]],
  )
  for (const l of r.rows) fora.set(l.id, BigInt(l.valor))
  return fora
}
