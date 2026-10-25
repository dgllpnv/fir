import { temPerm } from '@fir/domain'
import { SemAcesso } from '@/components/sem-acesso'
import { TelaRecebimentos } from '@/components/tela-recebimentos'
import { sessaoAtual } from '@/lib/sessao'

/**
 * `/recebimentos` — a única porta para dinheiro avulso.
 *
 * Página de SERVIDOR. `hoje` vem de `/v1/eu`, que o layout já resolveu: é o
 * dia de negócio da API, no fuso da clínica (regra 24). O navegador não
 * decide que dia a clínica está lançando.
 */
export default async function Recebimentos() {
  const { eu, perfis } = await sessaoAtual()
  const quem = { admin: eu.usuario.admin, perfilId: eu.usuario.perfilId ?? '' }
  if (!temPerm(quem, perfis, 'receber')) return <SemAcesso tela="Recebimentos" />
  return <TelaRecebimentos hoje={eu.hoje} mes={eu.hoje.slice(0, 7)} />
}
