import { temPerm } from '@fir/domain'
import { TelaNovaTarefa } from '@/components/tela-nova-tarefa'
import { sessaoAtual } from '@/lib/sessao'

/**
 * `/nova` — criar tarefa em dois toques.
 *
 * Página de SERVIDOR: ela resolve a sessão e decide `podePacientes` com
 * `temPerm` (regra 16). Sem essa permissão o modo "Vinculada a paciente" não
 * aparece — não porque a tela controle acesso, mas porque
 * `GET /v1/pacientes` recusaria a busca e o caminho terminaria num 403. É a
 * mesma regra do menu: tela sem permissão some, em vez de prometer e falhar.
 *
 * Os três parâmetros de URL vêm dos atalhos: "Criar tarefa" do aniversariante
 * em Hoje e "Nova tarefa para…" na ficha da paciente.
 */
export default async function Nova({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { eu, perfis } = await sessaoAtual()
  const podePacientes = temPerm(
    { admin: eu.usuario.admin, perfilId: eu.usuario.perfilId ?? '' },
    perfis,
    'pacientes',
  )
  const p = await searchParams
  const texto = (chave: string): string | undefined => {
    const v = p[chave]
    return typeof v === 'string' && v !== '' ? v : undefined
  }

  return (
    <TelaNovaTarefa
      eu={eu.usuario.id}
      podePacientes={podePacientes}
      inicial={{
        ...(texto('pacienteId') === undefined ? {} : { pacienteId: texto('pacienteId')! }),
        ...(texto('tipo') === undefined ? {} : { tipo: texto('tipo')! }),
        ...(texto('descricao') === undefined ? {} : { descricao: texto('descricao')! }),
      }}
    />
  )
}
