import { temPerm } from '@fir/domain'
import { SemAcesso } from '@/components/sem-acesso'
import { TelaUsuarios } from '@/components/tela-usuarios'
import { sessaoAtual } from '@/lib/sessao'

/**
 * `/usuarios` — quem entra na clínica e com qual perfil.
 *
 * `config`, que é o que `PessoasController` exige na CLASSE: listar, criar,
 * editar, redefinir senha e salvar perfis, todas. `pessoas.gerir` é a OUTRA
 * tela — Equipe, com ficha, contrato, férias e salário (épico 7). Juntar as
 * duas poria salário e permissão na mesma tela, com públicos diferentes.
 */
export default async function Usuarios() {
  const { eu, perfis, quem } = await sessaoAtual()
  if (!temPerm(quem, perfis, 'config')) return <SemAcesso tela="Usuários e acessos" />
  return <TelaUsuarios />
}
