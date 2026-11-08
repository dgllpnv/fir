import type { PerfilDoUsuarioDeGestao } from '@fir/contracts'
import { type SetorDaCarteira, ehModuloDaCarteira } from '@fir/domain'

/**
 * G8 0.5 — as colunas do PERFIL do `Usuário de Gestão` (migration 0050) e a
 * tradução da linha para o contrato. Um lugar só para a sessão
 * (`contextoDoToken`, relida a CADA requisição, A-2) e para o painel do
 * superadmin: um segundo `SELECT` escrito à mão é como uma coluna nova chega
 * a um e não ao outro.
 */
export const COLUNAS_DO_PERFIL = ['valores', 'carteira', 'modulos', 'administrar', 'setor', 'funcao', 'telefone'] as const

export const colunasDoPerfil = (prefixo = ''): string => COLUNAS_DO_PERFIL.map((c) => `${prefixo}${c}`).join(', ')

export type LinhaDoPerfil = {
  valores: boolean
  carteira: 'minha' | 'todos'
  modulos: string[]
  administrar: boolean
  setor: SetorDaCarteira | null
  funcao: string | null
  telefone: string | null
}

/**
 * O CHECK da 0050 já recusa módulo desconhecido; o filtro aqui é a segunda
 * camada, e é negação: um nome que o domínio não conhece não vira tela.
 */
export const perfilDaLinha = (l: LinhaDoPerfil): PerfilDoUsuarioDeGestao => ({
  valores: l.valores,
  carteira: l.carteira,
  modulos: l.modulos.filter(ehModuloDaCarteira),
  administrar: l.administrar,
  setor: l.setor,
  funcao: l.funcao,
  telefone: l.telefone,
})

/**
 * O perfil que a 0050 dá a uma linha inserida SEM as colunas novas — o
 * comportamento de antes da 0.5 (ver o topo da migration). Para testes que
 * montam a sessão à mão espelhando um `INSERT` antigo: o objeto tem de dizer
 * o mesmo que a linha no banco.
 */
export const perfilPadraoDoBanco = (escopo: 'geral' | 'grupo'): PerfilDoUsuarioDeGestao => ({
  valores: false,
  carteira: 'todos',
  modulos: ['painel', 'rotina', 'clientes', 'firclinic', 'metas', 'campanhas', 'resumo', 'prospeccao', 'cadastros'],
  administrar: escopo === 'geral',
  setor: null,
  funcao: null,
  telefone: null,
})
