import { temPerm } from '@fir/domain'
import { FichaDoProgramaNaTela } from '@/components/ficha-do-programa'
import { SemAcesso } from '@/components/sem-acesso'
import { sessaoAtual } from '@/lib/sessao'

/**
 * `/programas/:id` — a ficha do programa, uma seção por item.
 *
 * `programas.gerir` decide se **Encerrar** e **Excluir** aparecem. O servidor
 * recusa de qualquer jeito (`@Exige('programas.gerir')`), e é ele a autoridade;
 * esconder aqui evita que a enfermagem toque num botão que vai dar 403.
 */
export default async function Programa({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { eu, perfis } = await sessaoAtual()
  const quem = { admin: eu.usuario.admin, perfilId: eu.usuario.perfilId ?? '' }
  if (!temPerm(quem, perfis, 'programas')) return <SemAcesso tela="Programas" />
  return (
    <FichaDoProgramaNaTela
      id={id}
      podeReceber={temPerm(quem, perfis, 'receber')}
      podeGerir={temPerm(quem, perfis, 'programas.gerir')}
    />
  )
}
