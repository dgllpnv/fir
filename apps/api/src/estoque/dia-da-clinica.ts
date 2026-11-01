import { diaCivil } from '@fir/domain'
import type { Relogio } from '../comum/relogio'

/**
 * O DIA DE NEGÓCIO do estoque: o relógio do **servidor**, no fuso da
 * **clínica** (regras 22 e 24).
 *
 * Existe como função nomeada — e não como `diaCivil(relogio.agora(), fuso)`
 * espalhado — porque o estoque a usa em quatro lugares: a contagem inicial do
 * cadastro, o teto de data de `movEstoque`, o dia da baixa automática e o da
 * compensação. O quarto é o que acabaria usando `new Date()`.
 *
 * O protótipo usa `today()`, que é o relógio do NAVEGADOR: a recepcionista com
 * o celular adiantado lança a entrada de amanhã, e o estoque passa a ter
 * movimento no futuro.
 */
export const diaDaClinica = (relogio: Relogio, fuso: string): string =>
  diaCivil(relogio.agora(), fuso)
