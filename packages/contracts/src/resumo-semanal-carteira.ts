import { z } from 'zod'
import { DiaCivil } from './comum'

/**
 * **Resumo semanal da carteira** (G8 3C, item S1; `vResumo`, protótipo
 * L2021-2025). Uma tela com um texto pronto e "Copiar texto".
 *
 * O texto vem MONTADO do servidor (`montarResumoSemanal`, `@fir/domain`), com a
 * redação de valores já aplicada: o `RedacaoInterceptor` decide por nome de
 * campo e não enxerga dinheiro dentro de uma string (gate appsec A-14). Por
 * isso nenhum campo monetário existe aqui, e `comValores` diz à tela se o
 * texto foi montado com ou sem eles — só para a nota "sem os valores".
 */
export const ResumoSemanalSaida = z.object({
  semana: z.object({ inicio: DiaCivil, ultimoDia: DiaCivil, fimExclusivo: DiaCivil }),
  fuso: z.string(),
  texto: z.string(),
  comValores: z.boolean(),
})
export type ResumoSemanalSaida = z.infer<typeof ResumoSemanalSaida>
