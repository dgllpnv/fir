import { somarDias, somarMeses } from '../relogio'
import { erro, erroDe, ok, type Result } from '../resultado'
import type { FrequenciaDeKpi } from './catalogo'
import { ehReferencia, prazoDoLancamento, referenciaDoPeriodo, referenciaPendente } from './periodos'
import { dentroDoDominio, NumeroDoKpi, type UnidadeDeKpi } from './unidades'

/**
 * O LANÇAMENTO DE KPI MANUAL e as tarefas que o pedem (spec I-30, I-31).
 *
 * Puro: nenhuma data sai do relógio aqui. `hoje` é o dia civil da clínica,
 * calculado no servidor (regra 24), e o cursor vem do banco.
 */

/**
 * O prefixo do marcador da tarefa "Lançar [KPI]". **Só o servidor o escreve**
 * (appsec C27): `POST /v1/tarefas` recusa um corpo que o traga, porque a
 * tarefa com este marcador é a que o `PUT …/lancamentos/:referencia` conclui.
 */
export const PREFIXO_DO_MARCADOR_DE_LANCAMENTO = 'lancamento-kpi:'

export const marcadorDeLancamento = (kpiId: string): string => `${PREFIXO_DO_MARCADOR_DE_LANCAMENTO}${kpiId}`

/** Caixa e espaço na frente não disfarçam o marcador: a comparação é a mais larga. */
export const ehMarcadorDeLancamento = (m: unknown): boolean =>
  typeof m === 'string' && m.trimStart().toLowerCase().startsWith(PREFIXO_DO_MARCADOR_DE_LANCAMENTO)

/** Até onde o job enxerga para a frente: hoje + 35 dias (I-30). */
export const HORIZONTE_DAS_TAREFAS_DE_LANCAMENTO = 35

export type TarefaDeLancamento = { readonly referencia: string; readonly prazo: string }

/**
 * As tarefas de lançamento que faltam gerar, e o cursor novo.
 *
 * O cursor (`kpis.tarefas_geradas_ate`) é o PRAZO DA ÚLTIMA TAREFA GERADA.
 * **Para a frente, nunca para trás** (I-30): só entra referência cujo prazo é
 * POSTERIOR ao cursor e cabe no horizonte (hoje + 35). O cursor só cresce, e
 * só muda quando nasce tarefa — a trilha de `kpis` não ganha uma linha por dia.
 * É isso que faz a tarefa excluída não voltar: o prazo dela já ficou para trás
 * do cursor, e o job não olha para lá.
 *
 * Sem cursor (primeira rodada), começa pelo período CORRENTE — mesmo que o
 * prazo dele já tenha passado: o valor do período ainda não foi lançado, e a
 * tarefa atrasada é como a responsável fica sabendo.
 */
export function lancamentosAGerar(
  kpi: { readonly frequencia: FrequenciaDeKpi; readonly diaDeLancamento: number },
  geradasAte: string | null,
  hoje: string,
): { readonly tarefas: readonly TarefaDeLancamento[]; readonly geradasAte: string | null } {
  const horizonte = somarDias(hoje, HORIZONTE_DAS_TAREFAS_DE_LANCAMENTO)
  const proxima = (r: string): string => (kpi.frequencia === 'semanal' ? somarDias(r, 7) : somarMeses(r, 1))
  const tarefas: TarefaDeLancamento[] = []
  for (let r = referenciaDoPeriodo(kpi.frequencia, geradasAte ?? hoje); r <= horizonte; r = proxima(r)) {
    const p = prazoDoLancamento(kpi.frequencia, r, kpi.diaDeLancamento)
    // O dia de lançamento é conferido no cadastro (CHECK do banco); um inválido
    // não gera nada e não mexe no cursor.
    if (p.tipo === 'erro') return { tarefas: [], geradasAte }
    if ((geradasAte === null || p.valor > geradasAte) && p.valor <= horizonte) {
      tarefas.push({ referencia: r, prazo: p.valor })
    }
  }
  return { tarefas, geradasAte: tarefas.at(-1)?.prazo ?? geradasAte }
}

/**
 * O lançamento é aceitável? (I-31)
 *
 * - a referência é a segunda (semanal) ou o dia 1º (mensal);
 * - a referência não é futura: no máximo a do período corrente;
 * - o valor cabe no domínio da unidade (`ESCALA_DA_UNIDADE`).
 *
 * As mensagens nunca repetem o valor digitado (appsec C29): erro vai para a
 * tela e às vezes para o log.
 */
export function validarLancamento(
  kpi: { readonly frequencia: FrequenciaDeKpi; readonly unidade: UnidadeDeKpi },
  referencia: string,
  valorNaMenorUnidade: bigint,
  hoje: string,
): Result<NumeroDoKpi> {
  if (!ehReferencia(kpi.frequencia, referencia)) {
    return erro(erroDe('ReferenciaInvalida', 'A referência é a segunda-feira da semana ou o dia 1º do mês.'))
  }
  if (referencia > referenciaPendente(kpi.frequencia, hoje)) {
    return erro(erroDe('ReferenciaFutura', 'Não dá para lançar um período que ainda não começou.'))
  }
  const n = NumeroDoKpi.de(kpi.unidade, valorNaMenorUnidade)
  if (!dentroDoDominio(n)) {
    return erro(erroDe('ValorForaDoDominio', 'Valor fora do permitido para a unidade deste indicador.'))
  }
  return ok(n)
}
