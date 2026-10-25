import { temPerm } from '@fir/domain'
import { TelaPacientes } from '@/components/tela-pacientes'
import { sessaoAtual } from '@/lib/sessao'
import { SemAcesso } from '@/components/sem-acesso'

/**
 * `/pacientes` — a lista, os quatro atalhos e a entrada para a ficha.
 *
 * Página de SERVIDOR. O menu já esconde esta tela de quem não tem `pacientes`,
 * mas menu não é controle de acesso: basta digitar o endereço, ou receber o
 * link de uma colega. O servidor recusaria `GET /v1/pacientes` de qualquer
 * jeito; aqui a recusa chega como uma frase em vez de uma lista vazia.
 */
export default async function Pacientes() {
  const { eu, perfis } = await sessaoAtual()
  const usuario = { admin: eu.usuario.admin, perfilId: eu.usuario.perfilId ?? '' }

  if (!temPerm(usuario, perfis, 'pacientes')) return <SemAcesso tela="Pacientes" />

  return (
    <TelaPacientes
      podeGerir={temPerm(usuario, perfis, 'pacientes.gerir')}
      podeValores={temPerm(usuario, perfis, 'valores')}
    />
  )
}
