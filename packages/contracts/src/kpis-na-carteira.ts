import { z } from 'zod'
import { Uuid } from './comum'
import { ChaveDoCatalogoSchema, PilarDeKpiSchema, UnidadeDeKpiSchema } from './indicadores'
import { DiaDoKpi, SituacaoDaMetaSchema } from './indicadores-api'

/**
 * T10 — `GET /v1/carteira/clientes/:id/indicadores-da-clinica`: os KPIs da
 * clínica, como a carteira os recebe (spec I-47, emenda da ADR 0013).
 *
 * O valor viaja como em `ValorNaTela`: `emDinheiro` em reais, `emNumero` no
 * resto, texto do inteiro na menor unidade. `emDinheiro` está em
 * `CAMPOS_MONETARIOS`, e o `RedacaoInterceptor`, no espaço `carteira`, o apaga
 * de quem não tem `valores` (`temPermCarteira`). Nenhum `if` na rota.
 *
 * No pilar Pessoas e no resultado de campanha, `atual` e `alvo` vêm sempre
 * vazios: só `situacao` e `percentualDaMeta` atravessam (LGPD L-IN-18; ADR
 * 0013 §4). Os três KPIs de RH nunca aparecem (appsec C5).
 */
export const ValorDaClinicaNaCarteira = z
  .object({
    emDinheiro: z.string().regex(/^-?\d+$/).nullable(),
    emNumero: z.string().regex(/^-?\d+$/).nullable(),
  })
  .strict()
export type ValorDaClinicaNaCarteira = z.infer<typeof ValorDaClinicaNaCarteira>

export const KpiDaClinicaNaCarteira = z
  .object({
    kpiRef: Uuid,
    chave: ChaveDoCatalogoSchema.nullable(),
    /** No KPI manual, texto livre da clínica. */
    nome: z.string(),
    pilar: PilarDeKpiSchema,
    unidade: UnidadeDeKpiSchema,
    atual: ValorDaClinicaNaCarteira,
    /** `null` sem meta vigente. */
    alvo: ValorDaClinicaNaCarteira.nullable(),
    prazo: DiaDoKpi.nullable(),
    situacao: SituacaoDaMetaSchema.nullable(),
    percentualDaMeta: z.number().int().nullable(),
    /**
     * Sem meta vigente: o início da próxima meta já definida ("Meta a partir
     * de dez/2026", como o cartão de `KpiNaLista`). Só a data, nunca o alvo.
     * `null` com meta vigente, ou sem próxima.
     */
    inicioDaProximaMeta: DiaDoKpi.nullable(),
  })
  .strict()
export type KpiDaClinicaNaCarteira = z.infer<typeof KpiDaClinicaNaCarteira>

export const IndicadoresDaClinicaNaCarteiraSaida = z
  .object({
    clienteCarteiraId: Uuid,
    /** O cliente tem clínica na FIR Clinic. Sem ela, não há KPI a mostrar. */
    comClinica: z.boolean(),
    /** O dia (no fuso da clínica) da última fotografia; `null` antes da primeira. */
    dia: DiaDoKpi.nullable(),
    kpis: z.array(KpiDaClinicaNaCarteira),
  })
  .strict()
export type IndicadoresDaClinicaNaCarteiraSaida = z.infer<typeof IndicadoresDaClinicaNaCarteiraSaida>
