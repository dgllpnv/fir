import type { UsuarioDoPortalPublico } from '@fir/contracts'

/**
 * O que o `PortalGuard` anexa à requisição — espelho de `ContextoDaCarteira`.
 *
 * Sem `ator` tipado (`UsuarioPortalId`) aqui: o `ator` de verdade é montado
 * em `leitura-do-portal.service.ts` só na hora de gravar o acesso
 * (`usuarioPortalIdDeFonteConfiavel`), porque é o ÚNICO lugar que assina
 * algo (a trilha de LEITURA — o portal nunca escreve em tabela de negócio,
 * ADR 0018 §4).
 */
export type ContextoDoPortal = {
  readonly usuarioDoPortal: UsuarioDoPortalPublico
}

export type RequisicaoComPortal = { portal?: ContextoDoPortal }
