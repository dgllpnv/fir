import { temPerm } from '@fir/domain'
import { TelaTarefas } from '@/components/tela-tarefas'
import { sessaoAtual } from '@/lib/sessao'

/**
 * `/tarefas` — tudo o que Hoje não mostra: o que passou, o que vem, o que já
 * foi fechado.
 *
 * Página de SERVIDOR, como `/hoje`: ela resolve a sessão e decide `podeEquipe`
 * com `temPerm` — a mesma função que a API usa (regra 16). O que desce para o
 * cliente é o booleano resolvido, nunca a lista de perfis.
 *
 * Conveniência de tela, não controle de acesso: `GET /v1/tarefas` recusa
 * `escopo=equipe` sem a permissão, e é ele quem manda.
 */
export default async function Tarefas() {
  const { eu, perfis } = await sessaoAtual()
  const quem = { admin: eu.usuario.admin, perfilId: eu.usuario.perfilId ?? '' }
  const podeEquipe = temPerm(quem, perfis, 'tarefas.equipe')
  const podeReceber = temPerm(quem, perfis, 'receber')
  return <TelaTarefas eu={eu.usuario.id} podeEquipe={podeEquipe} podeReceber={podeReceber} />
}
