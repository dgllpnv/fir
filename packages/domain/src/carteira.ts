/**
 * A carteira comercial da Firmare (ADRs 0011, 0012, 0013). G1a: só a lógica
 * de domínio pura, sem I/O — o espelho em banco é a migration 0025.
 *
 * `UsuarioDeGestao` não é uma `Pessoa` nem um `Operador`: é o terceiro ator,
 * dono de um `Escopo`. O banco já cobra a invariante (`usuarios_gestao_escopo_grupo`,
 * migration 0025); esta função cobra a MESMA invariante no lado do domínio,
 * para que um objeto inválido nunca chegue a existir em memória — defeito
 * encontrado no construtor, não na constraint.
 */

export type Escopo = 'geral' | 'grupo'

export type UsuarioDeGestao = {
  readonly id: string
  readonly escopo: Escopo
  readonly grupoId: string | null
  readonly ativo: boolean
}

/**
 * Constrói um `UsuarioDeGestao` válido, ou lança.
 *
 * Mesma regra que `usuarios_gestao_escopo_grupo`: `escopo = 'grupo'` exige
 * `grupoId`; `escopo = 'geral'` exige a ausência dele. Nunca os dois, nunca
 * nenhum dos dois — não há "superadmin com grupo preferido" nem "usuário de
 * grupo sem grupo".
 */
export function criarUsuarioDeGestao(args: {
  id: string
  escopo: Escopo
  grupoId: string | null
  ativo: boolean
}): UsuarioDeGestao {
  const temGrupo = args.grupoId !== null
  if (args.escopo === 'grupo' && !temGrupo) {
    throw new Error('usuário de gestão com escopo=grupo precisa de grupoId')
  }
  if (args.escopo === 'geral' && temGrupo) {
    throw new Error('usuário de gestão com escopo=geral não pode ter grupoId')
  }
  return { id: args.id, escopo: args.escopo, grupoId: args.grupoId, ativo: args.ativo }
}

/**
 * P-12: pode este usuário de gestão ler dado do grupo informado?
 *
 * `geral` vê qualquer grupo (é o superadmin operando a carteira). `grupo` vê
 * só o próprio. Um usuário inativo nunca vê nada — é o mecanismo de
 * revogação checado a cada chamada (migration 0025, comentário de
 * `usuarios_gestao.ativo`), não só no login.
 */
export function podeVerGrupo(usuario: UsuarioDeGestao, grupoId: string): boolean {
  if (!usuario.ativo) return false
  if (usuario.escopo === 'geral') return true
  return usuario.grupoId === grupoId
}
