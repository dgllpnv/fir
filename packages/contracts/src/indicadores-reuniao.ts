import { z } from 'zod'
import { Uuid } from './comum'
import { DirecaoSchema, PilarDeKpiSchema, UnidadeDeKpiSchema } from './indicadores'
import { DiaDoKpi, MetaDeKpiNaSaida, SituacaoDaMetaSchema, ValorNaTelaSchema, VariacaoSchema } from './indicadores-api'

/**
 * Indicadores & Insights — T7: as rotas que saem da aba (spec I-45, I-46).
 *
 * `GET /v1/indicadores/da-semana` (o bloco de Hoje), `GET /v1/indicadores/
 * contador` (o número do menu) e `GET /v1/indicadores/reuniao` (o Modo
 * reunião, na TV da sala).
 *
 * **Esquemas fechados, e de propósito curtos** (LGPD L-IN-4): nenhuma
 * composição, nenhum `pacienteId`, nenhum nome de paciente. Da equipe, só o
 * `responsavelId` que a própria `MetaDeKpiNaSaida` já leva e o nome do
 * responsável pelo plano de ação. A tela vai para a TV; o que não está aqui
 * não chega lá.
 *
 * Todo número viaja em `ValorNaTela` (I-34): `emDinheiro` é apagado pela
 * redação sem `valores`, e nenhuma string carrega dinheiro (appsec C8). Os
 * nomes evitam `meta`, `valor` e `aberto`, que estão em `CAMPOS_MONETARIOS`.
 */

/** Uma meta em alerta: a do KPI de saúde ou a de um resultado-chave de OKR ativo. */
export const MetaEmAlerta = z
  .object({
    kpi: z.object({ id: Uuid, nome: z.string(), unidade: UnidadeDeKpiSchema }).strict(),
    /** O OKR ativo de onde a meta vem; `null` na meta de saúde do KPI. */
    okrId: Uuid.nullable(),
    metaDoKpi: MetaDeKpiNaSaida,
  })
  .strict()
export type MetaEmAlerta = z.infer<typeof MetaEmAlerta>

/** Até 4 metas vigentes hoje em `abaixo` ou `atencao`, `abaixo` primeiro. */
export const IndicadoresDaSemana = z.object({ hoje: DiaDoKpi, itens: z.array(MetaEmAlerta).max(4) }).strict()
export type IndicadoresDaSemana = z.infer<typeof IndicadoresDaSemana>

/** O número do menu: metas vivas (vigentes hoje) em `abaixo`. */
export const ContadorDeIndicadores = z.object({ abaixo: z.number().int().nonnegative() }).strict()
export type ContadorDeIndicadores = z.infer<typeof ContadorDeIndicadores>

/** O cartão do KPI na reunião: o número, a comparação e a meta. Sem responsável, composição nem lançamento. */
export const KpiNaReuniao = z
  .object({
    id: Uuid,
    nome: z.string(),
    pilar: PilarDeKpiSchema,
    unidade: UnidadeDeKpiSchema,
    direcao: DirecaoSchema,
    periodo: z.object({ de: DiaDoKpi, ate: DiaDoKpi }).strict(),
    atual: ValorNaTelaSchema,
    anterior: ValorNaTelaSchema.nullable(),
    variacao: VariacaoSchema.nullable(),
    diasAguardando: z.number().int(),
    metaVigente: MetaDeKpiNaSaida.nullable(),
  })
  .strict()
export type KpiNaReuniao = z.infer<typeof KpiNaReuniao>

export const ResultadoChaveNaReuniao = z
  .object({
    id: Uuid,
    kpi: z.object({ id: Uuid, nome: z.string(), unidade: UnidadeDeKpiSchema }).strict(),
    metaDoKr: MetaDeKpiNaSaida,
  })
  .strict()

/** Só OKR ATIVO. Sem `porque` (texto livre longo) nem responsável. */
export const OkrNaReuniao = z
  .object({
    id: Uuid,
    objetivo: z.string(),
    periodo: z.object({ inicio: DiaDoKpi, fim: DiaDoKpi }).strict(),
    progresso: z.number().int().nullable(),
    situacao: SituacaoDaMetaSchema,
    resultadosChave: z.array(ResultadoChaveNaReuniao),
  })
  .strict()

/**
 * O slide final (I-46): os planos de ação criados na semana corrente
 * (`[segunda, próxima segunda)` no fuso da clínica, pelo relógio do servidor).
 * O plano é tarefa INTERNA (sem paciente); o responsável sai pelo nome da
 * pessoa ou do grupo da equipe.
 */
export const PlanoDeAcaoNaReuniao = z
  .object({
    id: Uuid,
    descricao: z.string(),
    kpi: z.object({ id: Uuid, nome: z.string() }).strict(),
    prazo: DiaDoKpi,
    status: z.enum(['aberta', 'concluida', 'cancelada']),
    responsavel: z.string().nullable(),
  })
  .strict()

export const ReuniaoDeIndicadores = z
  .object({
    hoje: DiaDoKpi,
    /** `[de, ate]`, dias civis: a semana corrente, de segunda a domingo. */
    semana: z.object({ de: DiaDoKpi, ate: DiaDoKpi }).strict(),
    /** A capa: só contagens (appsec C8), nunca uma frase com número. */
    capa: z
      .object({
        clinica: z.string(),
        okrsAtivos: z.number().int(),
        metas: z.number().int(),
        abaixo: z.number().int(),
        atencao: z.number().int(),
        noRitmo: z.number().int(),
        atingidas: z.number().int(),
      })
      .strict(),
    okrs: z.array(OkrNaReuniao),
    /** A faixa "Saúde da clínica": os KPIs sem OKR ativo (spec E.3). */
    saude: z.array(KpiNaReuniao),
    planosDeAcao: z.array(PlanoDeAcaoNaReuniao),
  })
  .strict()
export type ReuniaoDeIndicadores = z.infer<typeof ReuniaoDeIndicadores>
