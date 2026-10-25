import { temPerm } from '@fir/domain'
import { SemAcesso } from '@/components/sem-acesso'
import { TelaCobrancas } from '@/components/tela-cobrancas'
import { sessaoAtual } from '@/lib/sessao'

/** `/cobrancas` — a fila de ligação, ordenada pelo servidor. */
export default async function Cobrancas() {
  const { eu, perfis } = await sessaoAtual()
  const quem = { admin: eu.usuario.admin, perfilId: eu.usuario.perfilId ?? '' }
  if (!temPerm(quem, perfis, 'cobrancas')) return <SemAcesso tela="Cobranças" />
  return <TelaCobrancas />
}
