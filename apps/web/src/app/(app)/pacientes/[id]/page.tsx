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
 *
 * `?tarefa={id}` é a tarefa que o link veio mostrar (o mini-cartão da
 * Jornada): lida aqui, no servidor, e não com `useSearchParams` no cliente —
 * que exigiria `Suspense` e quebra o `next build` sem ele.
 */
export default async function Ficha({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { perfis, quem, minhaPessoaId } = await sessaoAtual()
  const usuario = quem

  if (!temPerm(usuario, perfis, 'pacientes')) return <SemAcesso tela="Pacientes" />

  const { id } = await params
  const { tarefa } = await searchParams
  return (
    <FichaDoPaciente
      id={id}
      podeGerir={temPerm(usuario, perfis, 'pacientes.gerir')}
      eu={minhaPessoaId}
      podeEquipe={temPerm(usuario, perfis, 'tarefas.equipe')}
      podeReceber={temPerm(usuario, perfis, 'receber')}
      podeValores={temPerm(usuario, perfis, 'valores')}
      podePacientes={temPerm(usuario, perfis, 'pacientes')}
      podeJornada={temPerm(usuario, perfis, 'jornada')}
      tarefaEmFoco={typeof tarefa === 'string' && tarefa !== '' ? tarefa : null}
    />
  )
}
