import { z } from 'zod'
import { Uuid } from './comum'
import {
  AgregacaoSchema,
  ChaveDoCatalogoSchema,
  DirecaoSchema,
  FrequenciaDeKpiSchema,
  PilarDeKpiSchema,
  TipoDeMetaDeKpiSchema,
  UnidadeDeKpiSchema,
} from './indicadores'

/**
 * Indicadores & Insights — T2: os contratos das rotas de KPI e de meta.
 *
 * Todo valor de KPI viaja em `ValorNaTela` (I-34): `emDinheiro` em reais,
 * `emNumero` no resto — XOR, pelo único construtor `valorNaTela` do domínio.
 * `emDinheiro` está em `CAMPOS_MONETARIOS`, e a redação o apaga sem `valores`.
 * Nenhum campo em reais tem outro nome, e nenhuma string pronta carrega
 * dinheiro (appsec C8: a frase é montada na tela, com o formatador central).
 */

export const DiaDoKpi = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'use o formato aaaa-mm-dd')
/** Inteiro na MENOR unidade da unidade do KPI (centavos, centésimos, minutos). */
export const InteiroDoKpi = z.string().regex(/^-?\d{1,15}$/, 'um inteiro na menor unidade')

export const ValorNaTelaSchema = z
  .object({
    unidade: UnidadeDeKpiSchema,
    emDinheiro: z.string().regex(/^-?\d+$/).nullable(),
    emNumero: z.string().regex(/^-?\d+$/).nullable(),
    percentualDaMeta: z.number().int().nullable(),
    escala: z.number().nullable(),
  })
  .strict()

export const SituacaoDaMetaSchema = z.enum(['atingida', 'no_ritmo', 'atencao', 'abaixo', 'sem_dado'])

export const VariacaoSchema = z.discriminatedUnion('tipo', [
  z.object({ tipo: z.literal('pontos'), emCentesimos: z.string().regex(/^-?\d+$/) }).strict(),
  z.object({ tipo: z.literal('relativa'), percentual: z.number().int() }).strict(),
  z.object({ tipo: z.literal('novo') }).strict(),
])

export const MetaDeKpiNaSaida = z
  .object({
    id: Uuid,
    kpiId: Uuid,
    tipo: TipoDeMetaDeKpiSchema,
    inicio: DiaDoKpi,
    prazo: DiaDoKpi,
    alvo: ValorNaTelaSchema,
    partida: ValorNaTelaSchema,
    medidaPor: z.enum(['fir', 'medx']),
    responsavelId: Uuid.nullable(),
    /** A série da meta `recorrente` (I-24); `null` nas outras. Opcional para a web que monta o tipo à mão. */
    serieId: Uuid.nullable().optional(),
    /** O medido pela meta em `[início, corte]` (I-18), com `percentualDaMeta`. */
    atual: ValorNaTelaSchema,
    /** O ritmo esperado no corte; arredondado só aqui, na exibição (I-19). */
    ritmo: ValorNaTelaSchema,
    situacao: SituacaoDaMetaSchema,
    progresso: z.number().int().nullable(),
    projecao: ValorNaTelaSchema.nullable(),
    motivoSemProjecao: z.string().nullable(),
  })
  .strict()
export type MetaDeKpiNaSaida = z.infer<typeof MetaDeKpiNaSaida>

export const KpiNaLista = z
  .object({
    id: Uuid,
    /** Os OKRs ATIVOS que usam este KPI (spec E.3): com algum, o KPI sai da faixa "Saúde da clínica". */
    okrIds: z.array(Uuid),
    origem: z.enum(['catalogo', 'manual']),
    chave: ChaveDoCatalogoSchema.nullable(),
    nome: z.string(),
    pilar: PilarDeKpiSchema,
    unidade: UnidadeDeKpiSchema,
    direcao: DirecaoSchema,
    agregacao: AgregacaoSchema,
    frequencia: FrequenciaDeKpiSchema,
    parametros: z.record(z.string(), z.string()),
    responsavelId: Uuid.nullable(),
    periodo: z.object({ de: DiaDoKpi, ate: DiaDoKpi }).strict(),
    /**
     * O valor do período. `atual`, e não `valor`: a redação apaga por NOME, e
     * `valor` (como `meta` e `aberto`) está em `CAMPOS_MONETARIOS` — apagaria
     * o objeto inteiro, contagens e percentuais junto.
     */
    atual: ValorNaTelaSchema,
    /** O mesmo recorte no período anterior (I-28). */
    anterior: ValorNaTelaSchema.nullable(),
    variacao: VariacaoSchema.nullable(),
    /** Dias que ainda não contam (caixa aberto). Só a contagem, nunca o valor (regra 6). */
    diasAguardando: z.number().int(),
    /** `fonte_fora_do_dominio` (números c.16): o valor vem `null` e o incidente foi registrado. */
    motivoSemValor: z.string().nullable(),
    metaVigente: MetaDeKpiNaSaida.nullable(),
    /**
     * KPI manual (1.9 C.1): o período corrente sem lançamento, com o dia de
     * lançar já chegado. `false` no KPI de catálogo. Opcional só para a web
     * que ainda monta o tipo à mão; o servidor sempre manda.
     */
    lancamentoPendente: z.boolean().optional(),
    /** O selo da fonte do KPI manual: o último lançamento, sem o valor. `null` sem lançamento ou no catálogo. */
    ultimoLancamento: z
      .object({ referencia: DiaDoKpi, lancadoEm: z.string().datetime(), autor: z.string().nullable() })
      .strict()
      .nullable()
      .optional(),
  })
  .strict()
export type KpiNaLista = z.infer<typeof KpiNaLista>

export const ListaDeKpis = z.object({ hoje: DiaDoKpi, itens: z.array(KpiNaLista) }).strict()
export type ListaDeKpis = z.infer<typeof ListaDeKpis>

export const DetalheDoKpi = KpiNaLista.extend({
  comoMedir: z.string(),
  diaDeLancamento: z.number().int().nullable(),
  fonte: z.string().nullable(),
  metas: z.array(MetaDeKpiNaSaida),
}).strict()
export type DetalheDoKpi = z.infer<typeof DetalheDoKpi>

export const PontoDaSerie = z
  .object({
    inicio: DiaDoKpi,
    fim: DiaDoKpi,
    parcial: z.boolean(),
    /** Dia aguardando fechamento: sem valor e sem escala (c.10). Não é `aberto`: ver `KpiNaLista.atual`. */
    diaAguardando: z.boolean(),
    numero: ValorNaTelaSchema,
  })
  .strict()

export const SerieDoKpi = z
  .object({
    kpiId: Uuid,
    agrupamento: z.enum(['mes', 'semana', 'dia']),
    /** `analise`/`posicao`/`media_mensal`: as barras NÃO somam o total do período. */
    barrasSomamOTotal: z.boolean(),
    pontos: z.array(PontoDaSerie),
  })
  .strict()
export type SerieDoKpi = z.infer<typeof SerieDoKpi>

/**
 * `agrupamento` opcional (I-29): o minigráfico do KPI semanal pede `semana` (8
 * semanas a partir de hoje, sem `de`), o mensal pede `mes` (6 meses). A chave só
 * de mês civil é sempre `mes`. `dia` só dentro de um mês.
 */
export const ConsultaDaSerie = z
  .object({ de: DiaDoKpi.optional(), ate: DiaDoKpi.optional(), agrupamento: z.enum(['mes', 'semana', 'dia']).optional() })
  .strict()

export const ConsultaDeKpis = z
  .object({
    de: DiaDoKpi.optional(),
    ate: DiaDoKpi.optional(),
    pilar: PilarDeKpiSchema.optional(),
    responsavel: Uuid.optional(),
  })
  .strict()

export const ItemDoCatalogo = z
  .object({
    chave: ChaveDoCatalogoSchema,
    nome: z.string(),
    pilar: PilarDeKpiSchema,
    unidade: z.union([UnidadeDeKpiSchema, z.literal('da_metrica')]),
    direcao: DirecaoSchema,
    agregacao: AgregacaoSchema,
    frequencias: z.array(FrequenciaDeKpiSchema),
    parametros: z.array(z.enum(['origem', 'campanhaId'])),
    fonte: z.string(),
    somenteMesCivil: z.boolean(),
    /** Já criado nesta clínica, sem parâmetros: o id do vivo. */
    kpiId: Uuid.nullable(),
  })
  .strict()
export const CatalogoDeKpisNaSaida = z.object({ itens: z.array(ItemDoCatalogo) }).strict()
export type CatalogoDeKpisNaSaida = z.infer<typeof CatalogoDeKpisNaSaida>

export const CriarKpi = z.discriminatedUnion('origem', [
  z
    .object({
      origem: z.literal('catalogo'),
      chave: ChaveDoCatalogoSchema,
      parametros: z.record(z.string(), z.unknown()).optional(),
      frequencia: FrequenciaDeKpiSchema.optional(),
      responsavelId: Uuid.nullable().optional(),
    })
    .strict(),
  z
    .object({
      origem: z.literal('manual'),
      nome: z.string().trim().min(1).max(80),
      pilar: PilarDeKpiSchema,
      unidade: UnidadeDeKpiSchema,
      direcao: DirecaoSchema,
      frequencia: FrequenciaDeKpiSchema,
      diaDeLancamento: z.number().int().min(1).max(31),
      comoMedir: z.string().max(140).default(''),
      responsavelId: Uuid.nullable().optional(),
    })
    .strict(),
])
export type CriarKpi = z.infer<typeof CriarKpi>

export const EditarKpi = z
  .object({
    nome: z.string().trim().min(1).max(80).optional(),
    comoMedir: z.string().max(140).optional(),
    responsavelId: Uuid.nullable().optional(),
    /**
     * Só KPI manual (T3). Mudar para `reais` exige `valores` (appsec C3); com
     * lançamento ou meta já gravados, a troca é 409 — o valor está na coluna
     * da unidade antiga.
     */
    unidade: UnidadeDeKpiSchema.optional(),
  })
  .strict()
export type EditarKpi = z.infer<typeof EditarKpi>

export const CriarMetaDeKpi = z
  .object({
    kpiId: Uuid,
    /** `recorrente` (I-24): um mês civil inteiro, o primeiro da série; os seguintes nascem sozinhos. */
    tipo: z.enum(['mes', 'ate_data', 'recorrente']),
    inicio: DiaDoKpi,
    prazo: DiaDoKpi,
    alvo: InteiroDoKpi,
    partida: InteiroDoKpi.optional(),
    responsavelId: Uuid.nullable().optional(),
  })
  .strict()
export type CriarMetaDeKpi = z.infer<typeof CriarMetaDeKpi>

export const EditarMetaDeKpi = z
  .object({
    alvo: InteiroDoKpi.optional(),
    partida: InteiroDoKpi.optional(),
    prazo: DiaDoKpi.optional(),
    responsavelId: Uuid.nullable().optional(),
  })
  .strict()
export type EditarMetaDeKpi = z.infer<typeof EditarMetaDeKpi>

export const ConsultaDaPrevia = z
  .object({ kpiId: Uuid, inicio: DiaDoKpi, prazo: DiaDoKpi, alvo: InteiroDoKpi, partida: InteiroDoKpi.optional() })
  .strict()

/** Prévia D.3 (I-23): números estruturados, SEM frase pronta (appsec C8). */
export const PreviaDaMeta = z
  .object({
    prazo: DiaDoKpi,
    diasUteis: z.number().int(),
    ritmoPorDiaUtil: ValorNaTelaSchema,
    atualPorDiaUtil: ValorNaTelaSchema,
  })
  .strict()
export type PreviaDaMeta = z.infer<typeof PreviaDaMeta>
