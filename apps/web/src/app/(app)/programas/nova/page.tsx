import { temPerm } from '@fir/domain'
import { SemAcesso } from '@/components/sem-acesso'
import { TelaNovaAdesao } from '@/components/tela-nova-adesao'
import { sessaoAtual } from '@/lib/sessao'

/**
 * `/programas/nova` — montar o programa da paciente.
 *
 * `programas` basta para montar; `receber` é o que libera o bloco de pagamento
 * (a rota cobra `receber` **no corpo**, quando ele traz dinheiro). A enfermagem
 * monta o programa e o pagamento vai pela tela Recebimentos — é a mesma
 * decisão D-7 do épico 3, e é por isso que esta página não exige `receber`.
 */
export default async function NovaAdesao() {
  const { eu, perfis } = await sessaoAtual()
  const quem = { admin: eu.usuario.admin, perfilId: eu.usuario.perfilId ?? '' }
  if (!temPerm(quem, perfis, 'programas')) return <SemAcesso tela="Programas" />
  return (
    <TelaNovaAdesao
      podeReceber={temPerm(quem, perfis, 'receber')}
      podeValores={temPerm(quem, perfis, 'valores')}
    />
  )
}
