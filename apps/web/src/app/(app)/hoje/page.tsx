import { temPerm } from '@fir/domain'
import { TelaHoje } from '@/components/tela-hoje'
import { sessaoAtual } from '@/lib/sessao'

/**
 * `/hoje` — a tela que a clínica deixa aberta o dia inteiro.
 *
 * A página é SERVIDOR: ela resolve a sessão e decide `podeEquipe` com
 * `temPerm` — a mesma função que o servidor da API usa (regra 16). O que
 * desce para o cliente é o booleano já resolvido, nunca a lista de perfis.
 *
 * Isto é conveniência de tela, não controle de acesso: `GET /v1/hoje` recusa
 * `escopo=equipe` sem a permissão, e é ele quem manda.
 */
export default async function Hoje() {
  const { eu, perfis } = await sessaoAtual()
  const quem = { admin: eu.usuario.admin, perfilId: eu.usuario.perfilId ?? '' }
  const podeEquipe = temPerm(quem, perfis, 'tarefas.equipe')
  // `fechar` cria dinheiro, e o servidor exige `receber` além de `jornada`
  // (decisão D-7). Aqui só se decide se o BOTÃO aparece.
  const podeReceber = temPerm(quem, perfis, 'receber')
  return <TelaHoje eu={eu.usuario.id} podeEquipe={podeEquipe} podeReceber={podeReceber} />
}
