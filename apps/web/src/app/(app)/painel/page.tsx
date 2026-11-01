import { temPerm } from '@fir/domain'
import { SemAcesso } from '@/components/sem-acesso'
import { TelaPainel } from '@/components/tela-painel'
import { sessaoAtual } from '@/lib/sessao'

/**
 * `/painel` — **Gestão › Painel geral** (MANUAL cap. 10), a tela da CLÍNICA.
 *
 * `painel`, e **`painel` depende de `valores`** na matriz (regra 16): quem
 * abre esta tela vê dinheiro, e a dependência mora na tabela, não num `if`
 * aqui.
 *
 * **Nada a ver com `/superadmin`.** `CONTEXT.md` abre proibindo chamar o
 * painel do superadmin de `painel`: a allowlist de IP do Traefik casa o
 * segmento `superadmin`, e uma rota de produto lá dentro ficaria bloqueada
 * para a clínica inteira.
 */
export default async function PainelPage() {
  const { eu, perfis } = await sessaoAtual()
  const quem = { admin: eu.usuario.admin, perfilId: eu.usuario.perfilId ?? '' }
  if (!temPerm(quem, perfis, 'painel')) return <SemAcesso tela="Painel geral" />
  return <TelaPainel />
}
