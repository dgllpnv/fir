import { PERMS, temPerm } from '@fir/domain'
import { notFound } from 'next/navigation'
import { DetalheDoKpiNaTela } from '@/components/indicadores/detalhe-do-kpi'
import { sessaoAtual } from '@/lib/sessao'
import '@/components/indicadores/detalhe-do-kpi.css'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * `/indicadores/[id]` — o detalhe do KPI (1.9 E).
 *
 * O layout já conferiu `indicadores`. As chaves da sessão vão resolvidas aqui,
 * por `temPerm` (a MESMA função do servidor), para a tela decidir só a
 * conveniência: os botões de gestão e o bloco "De onde vem o número", que
 * exige a permissão da composição (LGPD L-IN-3). O servidor recusa do mesmo
 * jeito em cada rota.
 */
export default async function DetalheDoKpiPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!UUID.test(id)) notFound()
  const { perfis, quem, minhaPessoaId } = await sessaoAtual()
  const permissoes = PERMS.map((p) => p[1]).filter((chave) => temPerm(quem, perfis, chave))
  return (
    <DetalheDoKpiNaTela
      id={id}
      podeGerir={temPerm(quem, perfis, 'indicadores.gerir')}
      minhaPessoaId={minhaPessoaId}
      permissoes={permissoes}
    />
  )
}
