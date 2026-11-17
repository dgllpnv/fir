import { MAXIMO_DE_KRS, MINIMO_DE_KRS } from '@fir/domain'
import { z } from 'zod'
import { Uuid } from './comum'
import { ChaveDoCatalogoSchema, UnidadeDeKpiSchema } from './indicadores'
import { DiaDoKpi, InteiroDoKpi, MetaDeKpiNaSaida, SituacaoDaMetaSchema } from './indicadores-api'

/**
 * Indicadores & Insights — T4: os contratos dos OKRs (spec E; CONTEXT.md
 * `OKR` e `Resultado-chave`).
 *
 * Todo número do KR viaja na meta dele (`MetaDeKpiNaSaida`, com
 * `ValorNaTela`): `emDinheiro` é redigido pelo interceptor sem `valores`, e o
 * progresso e a situação ficam. Nenhuma string carrega dinheiro (appsec C8).
 */

/**
 * O aviso fixo de `objetivo` e `porque` (LGPD R-e): texto livre que a equipe
 * digita — nunca vai para log nem para mensagem de erro.
 */
export const AVISO_DO_TEXTO_DO_OKR = 'Não escreva nome de paciente nem dado de saúde.'

export const LIMITES_DO_OKR = { objetivo: { max: 160 }, porque: { max: 500 } } as const

const Objetivo = z.string().trim().min(1, 'escreva o objetivo').max(LIMITES_DO_OKR.objetivo.max)
const Porque = z.string().max(LIMITES_DO_OKR.porque.max)

/** Trimestre por padrão (sem `periodo`, o trimestre de hoje); datas livres sob pedido. */
export const PeriodoDoOkrPedido = z.discriminatedUnion('tipo', [
  z.object({ tipo: z.literal('trimestre'), inicio: DiaDoKpi.optional() }).strict(),
  z.object({ tipo: z.literal('datas'), inicio: DiaDoKpi, fim: DiaDoKpi }).strict(),
])

/**
 * Um KR no corpo. Com `id`, é um KR que já existe (o KPI não muda); sem, é
 * novo. `alvo`/`partida` na menor unidade do KPI. No KR de campanha o alvo é
 * a meta da campanha, travado: mandar outro é 422.
 */
export const ResultadoChavePedido = z
  .object({
    id: Uuid.optional(),
    kpiId: Uuid,
    alvo: InteiroDoKpi.optional(),
    partida: InteiroDoKpi.optional(),
  })
  .strict()
export type ResultadoChavePedido = z.infer<typeof ResultadoChavePedido>

const ListaDeKrs = z.array(ResultadoChavePedido).min(MINIMO_DE_KRS).max(MAXIMO_DE_KRS)

export const CriarOkr = z
  .object({
    objetivo: Objetivo,
    porque: Porque.default(''),
    periodo: PeriodoDoOkrPedido.optional(),
    responsavelId: Uuid.nullable().optional(),
    resultadosChave: ListaDeKrs,
  })
  .strict()
export type CriarOkr = z.infer<typeof CriarOkr>

/** Sem `resultadosChave`, os KRs ficam como estão. Com, a lista é a nova: o KR que sai é arquivado. */
export const EditarOkr = z
  .object({
    objetivo: Objetivo.optional(),
    porque: Porque.optional(),
    periodo: PeriodoDoOkrPedido.optional(),
    responsavelId: Uuid.nullable().optional(),
    resultadosChave: ListaDeKrs.optional(),
  })
  .strict()
export type EditarOkr = z.infer<typeof EditarOkr>

/**
 * Duplicar: o próximo período por padrão (o trimestre seguinte; datas livres
 * andam a mesma duração). A partida é RECALCULADA no servidor (spec E.1);
 * `alvos` troca o alvo de um KR de origem, pelo id dele.
 */
export const DuplicarOkr = z
  .object({
    periodo: PeriodoDoOkrPedido.optional(),
    alvos: z.array(z.object({ resultadoChaveId: Uuid, alvo: InteiroDoKpi }).strict()).max(MAXIMO_DE_KRS).optional(),
  })
  .strict()
export type DuplicarOkr = z.infer<typeof DuplicarOkr>

export const ResultadoChaveNaSaida = z
  .object({
    id: Uuid,
    ordem: z.number().int(),
    kpi: z
      .object({ id: Uuid, nome: z.string(), chave: ChaveDoCatalogoSchema.nullable(), unidade: UnidadeDeKpiSchema })
      .strict(),
    /** O alvo é a meta da campanha e não se edita (I-27). */
    alvoTravado: z.boolean(),
    /** `metaDoKr`, e não `meta`: `meta` está em `CAMPOS_MONETARIOS`, e a redação apagaria o objeto inteiro — progresso e situação junto. */
    metaDoKr: MetaDeKpiNaSaida,
  })
  .strict()
export type ResultadoChaveNaSaida = z.infer<typeof ResultadoChaveNaSaida>

export const OkrNaSaida = z
  .object({
    id: Uuid,
    objetivo: z.string(),
    porque: z.string(),
    periodo: z.object({ tipo: z.enum(['trimestre', 'datas']), inicio: DiaDoKpi, fim: DiaDoKpi }).strict(),
    responsavelId: Uuid.nullable(),
    estado: z.enum(['ativo', 'encerrado']),
    encerradoEm: z.string().nullable(),
    /** Média meio-para-cima dos progressos INTEIROS EXIBIDOS (números c.12). */
    progresso: z.number().int().nullable(),
    /** A pior entre os KRs exibidos. */
    situacao: SituacaoDaMetaSchema,
    /** Mais de 4 KRs: a tela avisa (spec E.2). */
    avisoDeKrs: z.boolean(),
    /** Só os KRs cujo KPI a pessoa pode ver (appsec C5): o progresso é a média DESTES. */
    resultadosChave: z.array(ResultadoChaveNaSaida),
  })
  .strict()
export type OkrNaSaida = z.infer<typeof OkrNaSaida>

export const ListaDeOkrs = z.object({ hoje: DiaDoKpi, itens: z.array(OkrNaSaida) }).strict()
export type ListaDeOkrs = z.infer<typeof ListaDeOkrs>
