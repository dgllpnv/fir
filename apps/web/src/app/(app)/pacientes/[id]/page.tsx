import { temPerm } from '@fir/domain'
import { FichaDoPaciente } from '@/components/ficha-do-paciente'
import { SemAcesso } from '@/components/sem-acesso'
import { sessaoAtual } from '@/lib/sessao'

/**
 * `/pacientes/:id` — a ficha.
 *
 * Rota própria, e não uma expansão dentro da lista: abrir a ficha grava um
 * ACESSO na trilha (`@DadoSensivel('pacientes')` na API, regra 18), e a
 * pergunta da LGPD é *"quem olhou o cadastro da minha paciente"*. Um acesso,
 * uma linha — e um endereço que a pessoa pode guardar.
 */
export default async function Ficha({ params }: { params: Promise<{ id: string }> }) {
  const { eu, perfis } = await sessaoAtual()
  const usuario = { admin: eu.usuario.admin, perfilId: eu.usuario.perfilId ?? '' }

  if (!temPerm(usuario, perfis, 'pacientes')) return <SemAcesso tela="Pacientes" />

  const { id } = await params
  return <FichaDoPaciente id={id} podeGerir={temPerm(usuario, perfis, 'pacientes.gerir')} />
}
