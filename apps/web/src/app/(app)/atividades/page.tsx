import { temPerm } from '@fir/domain'
import { SemAcesso } from '@/components/sem-acesso'
import { TelaAtividades } from '@/components/tela-atividades'
import { sessaoAtual } from '@/lib/sessao'

/**
 * `/atividades` — o log do que a equipe fez nesta clínica.
 *
 * `config`, o mesmo que `GET /v1/atividades` exige: quem administra a clínica.
 */
export default async function Atividades() {
  const { eu, perfis, quem } = await sessaoAtual()
  if (!temPerm(quem, perfis, 'config')) return <SemAcesso tela="Atividades" />
  return <TelaAtividades fuso={eu.clinica.fuso} />
}
