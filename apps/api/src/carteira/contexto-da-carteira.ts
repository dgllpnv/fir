import type { UsuarioDeGestaoPublico } from '@fir/contracts'

/**
 * O que o `CarteiraGuard` anexa à requisição — espelho de `ContextoDoPainel`.
 *
 * Sem `ator` tipado (`UsuarioDeGestaoId`) em `banco/ator.ts`: desde G5 (ADR
 * 0016) o Usuário de Gestão ESCREVE — `leads_comerciais`, `rotinas_internas`,
 * `tarefas_internas`, `checkins_internos`, todas com trigger de auditoria —
 * mas nenhuma dessas tabelas pertence a uma `Clinica`
 * (`nasTabelasDaCarteiraComoUsuarioDeGestao` grava o ator como
 * `usuario_gestao:<id>` direto, sem passar por `AtorDoPainel`). O dia em que
 * ele escrever em tabela COM `clinica_id` é o dia de introduzir esse tipo
 * ali — não antes.
 */
export type ContextoDaCarteira = {
  readonly usuarioDeGestao: UsuarioDeGestaoPublico
}

export type RequisicaoComCarteira = { carteira?: ContextoDaCarteira }
