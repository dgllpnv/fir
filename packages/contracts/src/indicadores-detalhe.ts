import { z } from 'zod'
import { Uuid } from './comum'
import { UnidadeDeKpiSchema } from './indicadores'
import { DiaDoKpi, ValorNaTelaSchema } from './indicadores-api'
import { COMENTARIO_DO_LANCAMENTO_MAXIMO, ValorDoLancamento } from './indicadores-lancamentos'

/**
 * Indicadores & Insights — T6: o "De onde vem o número" do detalhe do KPI
 * (backlog 1.9 E; spec I-32, LGPD L-IN-3).
 *
 * **KPI automático → a composição do período**, agrupada (ex.: faturamento por
 * forma de pagamento e por tipo de atendimento), e o destino do link "Ver
 * recebimentos", que abre o RELATÓRIO já filtrado. A linha a linha — com
 * paciente — mora no relatório, com as travas dele (classe, `@DadoSensivel`,
 * exportação registrada). A composição nunca traz paciente, id de paciente nem
 * nome: só grupos com rótulo da clínica (forma, tipo, origem).
 *
 * **KPI manual → os lançamentos** (`GET …/kpis/:id/lancamentos`).
 */

export const ConsultaDaComposicao = z.object({ de: DiaDoKpi.optional(), ate: DiaDoKpi.optional() }).strict()

/** Teto de grupos por bloco; o que passar disso sai com `truncado`. */
export const MAXIMO_DE_GRUPOS_DA_COMPOSICAO = 50

export const GrupoDaComposicao = z
  .object({
    rotulo: z.string(),
    /** Quantas linhas da fonte formam o grupo (recebimentos, pacientes). */
    quantidade: z.number().int(),
    /** O número do grupo. Em reais, `emDinheiro` sai `null` sem `valores`; `escala` é relativa ao bloco. */
    numero: ValorNaTelaSchema,
  })
  .strict()

export const BlocoDaComposicao = z
  .object({
    por: z.enum(['forma', 'tipo', 'origem']),
    grupos: z.array(GrupoDaComposicao).max(MAXIMO_DE_GRUPOS_DA_COMPOSICAO),
    truncado: z.boolean(),
  })
  .strict()

export const ComposicaoDoKpi = z
  .object({
    kpiId: Uuid,
    periodo: z.object({ de: DiaDoKpi, ate: DiaDoKpi }).strict(),
    /**
     * `false` quando esta chave ainda não tem composição (a tela mostra só o
     * link do relatório, se houver) ou o faturamento é medido pelo MedX.
     */
    disponivel: z.boolean(),
    motivoIndisponivel: z.enum(['sem_composicao', 'medido_pelo_medx']).nullable(),
    /** A soma dos grupos de cada bloco — o MESMO número do cartão no período. */
    total: ValorNaTelaSchema.nullable(),
    /** Dias que ainda não contam (regra 6): só a contagem; o dinheiro deles fica fora dos grupos. */
    diasAguardando: z.number().int(),
    blocos: z.array(BlocoDaComposicao),
    /** O destino de "Ver recebimentos": o relatório e o período, já filtrados. */
    relatorio: z.object({ chave: z.string(), de: DiaDoKpi, ate: DiaDoKpi }).strict().nullable(),
  })
  .strict()
export type ComposicaoDoKpi = z.infer<typeof ComposicaoDoKpi>

/** Os lançamentos de um KPI manual, do mais recente para o mais antigo. */
export const ConsultaDeLancamentos = z
  .object({
    limite: z.coerce.number().int().min(1).max(100).default(24),
    deslocamento: z.coerce.number().int().min(0).max(10_000).default(0),
  })
  .strict()

export const LancamentoNaLista = z
  .object({
    referencia: DiaDoKpi,
    /** `lancado`, e não `valor` (está em `CAMPOS_MONETARIOS`): `emDinheiro` é o que a redação apaga. */
    lancado: ValorDoLancamento,
    comentario: z.string().max(COMENTARIO_DO_LANCAMENTO_MAXIMO),
    /** O nome de quem lançou (pessoa da equipe). */
    autor: z.string().nullable(),
    lancadoEm: z.string().datetime(),
  })
  .strict()

export const ListaDeLancamentos = z
  .object({
    kpiId: Uuid,
    unidade: UnidadeDeKpiSchema,
    itens: z.array(LancamentoNaLista),
    /** Há mais lançamentos depois desta página. */
    temMais: z.boolean(),
  })
  .strict()
export type ListaDeLancamentos = z.infer<typeof ListaDeLancamentos>
