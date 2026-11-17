import { z } from 'zod'
import { Uuid } from './comum'
import { UnidadeDeKpiSchema } from './indicadores'

/**
 * Indicadores & Insights — T3: o lançamento de KPI manual (spec I-30, I-31).
 *
 * `PUT /v1/indicadores/kpis/:id/lancamentos/:referencia` é a EXCEÇÃO NOMEADA
 * da matriz de acesso (appsec C4): a responsável lança sem ter `indicadores`.
 * Por isso a resposta é FECHADA (appsec C2): só o lançamento — nenhuma meta,
 * série, situação, composição nem `percentualDaMeta`. O que a janela D.4
 * precisa para abrir chega pela tarefa (`TarefaNaLista.lancamentoDeKpi`).
 */

/**
 * O aviso fixo dos textos livres do KPI (LGPD R-e), no molde de
 * `AVISO_DA_DESCRICAO_DE_ENTRADA`: `comentario` (280) e `como_medir` (140).
 * Nenhum dos dois vai para log nem para mensagem de erro (appsec C29).
 */
export const AVISO_DE_TEXTO_LIVRE_DO_KPI = 'Não escreva nome de paciente nem dado de saúde.'
export const COMENTARIO_DO_LANCAMENTO_MAXIMO = 280

const DiaDoLancamento = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'use o formato aaaa-mm-dd')

export const ReferenciaDoLancamento = DiaDoLancamento

export const LancarKpi = z
  .object({
    /** Inteiro na MENOR unidade da unidade do KPI (centavos, centésimos, minutos). */
    valor: z.string().regex(/^\d{1,15}$/, 'um inteiro na menor unidade'),
    comentario: z.string().trim().max(COMENTARIO_DO_LANCAMENTO_MAXIMO).default(''),
  })
  .strict()
export type LancarKpi = z.infer<typeof LancarKpi>

/**
 * O valor de um lançamento: o par XOR de `ValorNaTela` (`emDinheiro` em
 * reais, `emNumero` no resto), SEM `percentualDaMeta` e sem `escala` — a
 * resposta do lançamento não carrega meta nenhuma (appsec C2). `emDinheiro`
 * está em `CAMPOS_MONETARIOS`: sem `valores`, a redação o apaga.
 */
export const ValorDoLancamento = z
  .object({
    emDinheiro: z.string().regex(/^-?\d+$/).nullable(),
    emNumero: z.string().regex(/^-?\d+$/).nullable(),
  })
  .strict()

export const LancamentoDeKpiNaSaida = z
  .object({
    kpiId: Uuid,
    referencia: DiaDoLancamento,
    unidade: UnidadeDeKpiSchema,
    /**
     * O valor gravado. `lancado`, e não `valor`: a redação apaga por NOME, e
     * `valor` está em `CAMPOS_MONETARIOS` — apagaria o objeto inteiro, e a
     * contagem de quem não tem `valores` sumiria junto com o real.
     */
    lancado: ValorDoLancamento,
    /** O valor que estava lá antes desta correção, ou `null` no primeiro lançamento. */
    anterior: ValorDoLancamento.nullable(),
    comentario: z.string(),
    lancadoEm: z.string(),
    /** A tarefa da referência que este lançamento concluiu, se havia uma aberta. */
    tarefaConcluidaId: Uuid.nullable(),
  })
  .strict()
export type LancamentoDeKpiNaSaida = z.infer<typeof LancamentoDeKpiNaSaida>

/**
 * O que a tarefa "Lançar [KPI]" leva para abrir a janela D.4 (appsec C2):
 * nome, unidade, "como medir", referência e prazo. Nada de meta, série ou valor.
 */
export const LancamentoDeKpiNaTarefa = z
  .object({
    kpiId: Uuid,
    nome: z.string(),
    unidade: UnidadeDeKpiSchema,
    comoMedir: z.string(),
    referencia: DiaDoLancamento,
    prazo: DiaDoLancamento,
  })
  .strict()
export type LancamentoDeKpiNaTarefa = z.infer<typeof LancamentoDeKpiNaTarefa>

/** O KPI de um plano de ação ou de um lançamento (appsec C27): só id e nome. */
export const KpiDaTarefa = z.object({ id: Uuid, nome: z.string() }).strict()
export type KpiDaTarefa = z.infer<typeof KpiDaTarefa>
