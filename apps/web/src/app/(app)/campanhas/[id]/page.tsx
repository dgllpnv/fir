import { temPerm } from '@fir/domain'
import { notFound } from 'next/navigation'
import { SemAcesso } from '@/components/sem-acesso'
import { TelaCampanha } from '@/components/tela-campanha'
import { sessaoAtual } from '@/lib/sessao'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * `/campanhas/[id]` — o detalhe da campanha, com as tarefas dela.
 *
 * Mesma chave de `/campanhas`: **`campanhas`**. Sem ela, "Sem acesso a esta
 * tela" — e o servidor recusa de novo em cada rota (regra 16); a tela é
 * conveniência. As tarefas da campanha NÃO dependem de `tarefas.equipe`
 * (ADR 2026-11-13).
 *
 * `?mes=` leva de volta à lista de onde a pessoa veio.
 */
export default async function CampanhaPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { id } = await params
  const q = await searchParams
  const { minhaPessoaId, perfis, quem } = await sessaoAtual()
  if (!temPerm(quem, perfis, 'campanhas')) return <SemAcesso tela="Campanhas" />
  if (!UUID.test(id)) notFound()
  const mes = typeof q['mes'] === 'string' && /^\d{4}-\d{2}$/.test(q['mes']) ? q['mes'] : undefined

  return (
    <TelaCampanha
      id={id}
      mesDaLista={mes}
      eu={minhaPessoaId}
      podeGerir={temPerm(quem, perfis, 'campanhas.gerir')}
      podeEquipe={temPerm(quem, perfis, 'tarefas.equipe')}
      podeReceber={temPerm(quem, perfis, 'receber')}
      podeValores={temPerm(quem, perfis, 'valores')}
      podePacientes={temPerm(quem, perfis, 'pacientes')}
    />
  )
}
