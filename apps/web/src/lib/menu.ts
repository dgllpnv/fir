import { type ChaveDePermissao, type Perfil, temPerm } from '@fir/domain'

export type ItemDeMenu = {
  readonly href: string
  readonly rotulo: string
  readonly grupo: 'Dia a dia' | 'Comercial' | 'Financeiro' | 'Processos' | 'Pessoas' | 'Gestão'
  /** `null` = sempre liberado. Ver CLAUDE.md §2, regra 16. */
  readonly perm: ChaveDePermissao | null
}

/** Hoje, as próprias tarefas, Nova tarefa, Minhas metas, Ajuda e Manual são de todos. */
export const MENU: readonly ItemDeMenu[] = [
  { href: '/hoje', rotulo: 'Hoje', grupo: 'Dia a dia', perm: null },
  { href: '/tarefas', rotulo: 'Tarefas', grupo: 'Dia a dia', perm: null },
  { href: '/nova', rotulo: 'Nova tarefa', grupo: 'Dia a dia', perm: null },
  { href: '/jornada', rotulo: 'Jornada do paciente', grupo: 'Comercial', perm: 'jornada' },
  { href: '/pacientes', rotulo: 'Pacientes', grupo: 'Comercial', perm: 'pacientes' },
  { href: '/programas', rotulo: 'Programas', grupo: 'Comercial', perm: 'programas' },
  { href: '/campanhas', rotulo: 'Campanhas', grupo: 'Comercial', perm: 'campanhas' },
  { href: '/recebimentos', rotulo: 'Recebimentos', grupo: 'Financeiro', perm: 'receber' },
  { href: '/caixa', rotulo: 'Caixa do dia', grupo: 'Financeiro', perm: 'caixa' },
  { href: '/contas', rotulo: 'Contas a pagar', grupo: 'Financeiro', perm: 'contas' },
  { href: '/cobrancas', rotulo: 'Cobranças', grupo: 'Financeiro', perm: 'cobrancas' },
  { href: '/visao-do-mes', rotulo: 'Visão do mês', grupo: 'Financeiro', perm: 'finmes' },
  { href: '/estoque', rotulo: 'Estoque', grupo: 'Processos', perm: 'estoque' },
  { href: '/equipe', rotulo: 'Equipe', grupo: 'Pessoas', perm: 'pessoas.gerir' },
  { href: '/minhas-metas', rotulo: 'Minhas metas', grupo: 'Pessoas', perm: null },
  { href: '/painel', rotulo: 'Painel geral', grupo: 'Gestão', perm: 'painel' },
  { href: '/configuracoes', rotulo: 'Configurações', grupo: 'Gestão', perm: 'config' },
]

/** Tela sem permissão **some do menu**. Quem alcança por URL vê "Sem acesso". */
export function itensDoMenu(
  usuario: { admin: boolean; perfilId: string | null },
  perfis: readonly Perfil[],
): ItemDeMenu[] {
  const u = { admin: usuario.admin, perfilId: usuario.perfilId ?? '' }
  return MENU.filter((i) => i.perm === null || temPerm(u, perfis, i.perm))
}
