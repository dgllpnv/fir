import {
  AGREGACOES,
  CHAVES_DO_CATALOGO,
  type ChaveDoCatalogo,
  DIRECOES,
  FREQUENCIAS_DE_KPI,
  PILARES_DE_KPI,
  TIPOS_DE_META_DE_KPI,
  UNIDADES_DE_KPI,
} from '@fir/domain'
import { z } from 'zod'
import { Uuid } from './comum'

/**
 * Indicadores & Insights — T1: os enums e os PARÂMETROS do catálogo.
 *
 * Os parâmetros moram aqui, e não em `packages/domain/src/indicadores/
 * catalogo.ts` como o ticket escreve, porque o domínio não importa Zod (regra
 * de dependência do `CLAUDE.md`). O catálogo declara o NOME de cada
 * parâmetro; o teste deste arquivo cobra que os dois batem.
 *
 * **O que ainda não está aqui, de propósito:** os schemas de SAÍDA com
 * `ValorNaTela` (`emDinheiro`). `teste/redacao-de-valores.test.ts` reprova
 * todo schema exportado com campo de `CAMPOS_MONETARIOS` sem a rota que o
 * entrega registrada, e `teste/rotas-protegidas.test.ts` reprova rota
 * registrada que não existe. As duas juntas dizem: o contrato de dinheiro
 * nasce com a rota, no T2.
 */

export const UnidadeDeKpiSchema = z.enum(UNIDADES_DE_KPI)
export const PilarDeKpiSchema = z.enum(PILARES_DE_KPI)
export const DirecaoSchema = z.enum(DIRECOES)
export const AgregacaoSchema = z.enum(AGREGACOES)
export const FrequenciaDeKpiSchema = z.enum(FREQUENCIAS_DE_KPI)
export const TipoDeMetaDeKpiSchema = z.enum(TIPOS_DE_META_DE_KPI)
export const ChaveDoCatalogoSchema = z.enum(CHAVES_DO_CATALOGO)

const Vazio = z.object({}).strict()

/**
 * Um schema `.strict()` por chave (appsec C6): chave extra é 422. O id que
 * vem aqui (`campanhaId`) ainda precisa ser conferido contra a clínica no
 * servidor — o schema só garante a forma.
 *
 * `origem` é o texto da origem do paciente, com o mesmo limite do cadastro
 * (`pacientes.ts`): o Painel agrupa por ele.
 */
export const PARAMETROS_DO_CATALOGO = {
  faturamento_conferido: Vazio,
  resultado_do_mes: Vazio,
  ticket_medio: Vazio,
  despesas_fixas_sobre_recebido: Vazio,
  saldo_a_receber: Vazio,
  caixas_sem_diferenca: Vazio,
  novos_pacientes: z.object({ origem: z.string().trim().min(1).max(60).optional() }).strict(),
  conversao_de_orcamentos: Vazio,
  valor_fechado_em_orcamentos: Vazio,
  comparecimento: Vazio,
  faltas_recontatadas: Vazio,
  pacientes_recaptados: Vazio,
  resultado_de_campanha: z.object({ campanhaId: Uuid }).strict(),
  tarefas_no_prazo: Vazio,
  rotinas_cumpridas: Vazio,
  perda_de_estoque: Vazio,
  itens_abaixo_do_minimo: Vazio,
  atingimento_metas_individuais: Vazio,
  saldo_banco_de_horas: Vazio,
  conversas_1a1_em_dia: Vazio,
} as const satisfies Record<ChaveDoCatalogo, z.ZodTypeAny>

/**
 * Valida os parâmetros de uma chave. `{}` é o padrão do banco
 * (`parametros NOT NULL DEFAULT '{}'`, números c.13), e é também o que a meta
 * da Visão do mês procura.
 */
export function lerParametrosDoKpi(chave: ChaveDoCatalogo, entrada: unknown) {
  return PARAMETROS_DO_CATALOGO[chave].safeParse(entrada ?? {})
}
