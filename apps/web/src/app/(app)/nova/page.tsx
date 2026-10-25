import { TelaNovaTarefa } from '@/components/tela-nova-tarefa'
import { sessaoAtual } from '@/lib/sessao'

/**
 * `/nova` — criar tarefa em dois toques.
 *
 * Página de SERVIDOR: resolve a sessão e passa adiante.
 *
 * **Não decide mais por permissão** — decisão D-7. Antes, quem não tinha
 * `pacientes` não via o modo "Vinculada a paciente", porque a busca terminaria
 * num 403. Hoje a busca tem rota própria, estreita, que não exige a permissão:
 * quem atende o balcão vincula a tarefa à paciente certa sem ganhar acesso ao
 * financeiro dela. Criar tarefa solta e vincular depois gerava retrabalho e
 * tarefa órfã — que é exatamente o que suja o funil.
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
  const p = await searchParams
  const texto = (chave: string): string | undefined => {
    const v = p[chave]
    return typeof v === 'string' && v !== '' ? v : undefined
  }

  return (
    <TelaNovaTarefa
      eu={eu.usuario.id}
      inicial={{
        ...(texto('pacienteId') === undefined ? {} : { pacienteId: texto('pacienteId')! }),
        ...(texto('tipo') === undefined ? {} : { tipo: texto('tipo')! }),
        ...(texto('descricao') === undefined ? {} : { descricao: texto('descricao')! }),
      }}
    />
  )
}
