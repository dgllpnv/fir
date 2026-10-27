import { temPerm } from '@fir/domain'
import { SemAcesso } from '@/components/sem-acesso'
import { TelaProgramas } from '@/components/tela-programas'
import { sessaoAtual } from '@/lib/sessao'

/**
 * `/programas` — a agenda de sessões e os pacientes em programa.
 *
 * `receber` é passado como propriedade, e não consultado dentro do componente:
 * o painel de conclusão da sessão só pede dinheiro para quem pode lançá-lo, e
 * quem decide isso é `temPerm`, a MESMA função do servidor.
 *
 * Isto não é um `if` de permissão sobre dinheiro: o VALOR já chega redigido
 * (regra 17). O que esta propriedade esconde é o FORMULÁRIO — e esconder um
 * formulário que daria 403 é conveniência, não controle de acesso.
 */
export default async function Programas() {
  const { eu, perfis } = await sessaoAtual()
  const quem = { admin: eu.usuario.admin, perfilId: eu.usuario.perfilId ?? '' }
  if (!temPerm(quem, perfis, 'programas')) return <SemAcesso tela="Programas" />
  return <TelaProgramas podeReceber={temPerm(quem, perfis, 'receber')} />
}
