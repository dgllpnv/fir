import { temPerm } from '@fir/domain'
import { SemAcesso } from '@/components/sem-acesso'
import { TelaContas } from '@/components/tela-contas'
import { sessaoAtual } from '@/lib/sessao'

/**
 * `/contas` — contas a pagar.
 *
 * `podeGerir` decide se "Nova conta" e "Editar" aparecem. O ALCANCE — ver
 * todas ou só as minhas — é do servidor: a conta de outra pessoa é 404, e a
 * tela nunca chega a conhecê-la.
 */
export default async function Contas() {
  const { eu, perfis } = await sessaoAtual()
  const quem = { admin: eu.usuario.admin, perfilId: eu.usuario.perfilId ?? '' }
  if (!temPerm(quem, perfis, 'contas')) return <SemAcesso tela="Contas a pagar" />
  return (
    <TelaContas
      hoje={eu.hoje}
      mes={eu.hoje.slice(0, 7)}
      podeGerir={temPerm(quem, perfis, 'contas.gerir')}
      euId={eu.usuario.id}
    />
  )
}
