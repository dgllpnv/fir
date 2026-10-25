import { temPerm } from '@fir/domain'
import { SemAcesso } from '@/components/sem-acesso'
import { TelaCaixa } from '@/components/tela-caixa'
import { sessaoAtual } from '@/lib/sessao'

/**
 * `/caixa` — a conferência às cegas.
 *
 * `podeConfigurar` decide só se o seletor de responsável pelo caixa aparece;
 * quem manda é `@Exige('finmes')` em `PATCH /v1/configuracoes/financeiro`.
 */
export default async function Caixa() {
  const { eu, perfis } = await sessaoAtual()
  const quem = { admin: eu.usuario.admin, perfilId: eu.usuario.perfilId ?? '' }
  if (!temPerm(quem, perfis, 'caixa')) return <SemAcesso tela="Caixa do dia" />
  return <TelaCaixa hoje={eu.hoje} podeConfigurar={temPerm(quem, perfis, 'finmes')} />
}
