import { temPerm } from '@fir/domain'
import { SemAcesso } from '@/components/sem-acesso'
import { TelaVisaoDoMes } from '@/components/tela-visao-do-mes'
import { sessaoAtual } from '@/lib/sessao'

/**
 * `/visao-do-mes` — a tela que decide.
 *
 * `finmes` depende de `valores`, e `temPerm` resolve a dependência: marcar
 * `finmes` sem `valores` não abre esta tela nem a rota.
 */
export default async function VisaoDoMes() {
  const { eu, perfis } = await sessaoAtual()
  const quem = { admin: eu.usuario.admin, perfilId: eu.usuario.perfilId ?? '' }
  if (!temPerm(quem, perfis, 'finmes')) return <SemAcesso tela="Visão do mês" />
  return <TelaVisaoDoMes mesCorrente={eu.hoje.slice(0, 7)} />
}
