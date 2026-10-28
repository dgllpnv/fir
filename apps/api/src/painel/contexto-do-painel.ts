import type { OperadorPublico } from '@fir/contracts'
import type { OperadorId } from '../banco/ator'

/**
 * O que o `PainelGuard` anexa à requisição — o espelho de
 * `ContextoDaRequisicao`, e deliberadamente **sem clínica**.
 *
 * Não há `clinicaId` aqui porque o operador não pertence a clínica nenhuma.
 * A clínica em que ele opera vem da ROTA, e só depois de ser lida de
 * `clinicas` e conferida como ativa — é o terceiro chamador legítimo de
 * `clinicaIdDeFonteConfiavel` (ver `clinica-id.ts`).
 *
 * E não há `pode`: o superadmin tem acesso total (D-10). O que o contém não é
 * permissão, é **registro** — toda ação dele cai na trilha que a clínica
 * enxerga.
 */
export type ContextoDoPainel = {
  /** O ator marcado, pronto para `comoPainel`. O `as` não mora aqui. */
  readonly ator: OperadorId
  readonly operador: OperadorPublico
}

export type RequisicaoComPainel = { painel?: ContextoDoPainel }
