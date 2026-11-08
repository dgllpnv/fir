import { temPerm } from '@fir/domain'
import { SemAcesso } from '@/components/sem-acesso'
import { TelaContas } from '@/components/tela-contas'
import { lerFiltroDeContas } from '@/lib/filtro-de-contas'
import { sessaoAtual } from '@/lib/sessao'

/**
 * `/contas` — contas a pagar.
 *
 * `podeGerir` decide se "Nova conta" e "Editar" aparecem. O ALCANCE — ver
 * todas ou só as minhas — é do servidor: a conta de outra pessoa é 404, e a
 * tela nunca chega a conhecê-la.
 *
 * **Situação, mês e forma vêm da URL, lidos AQUI** (ADR 0020): é o endereço
 * que o toque numa forma da Visão do mês abre. `searchParams` de página de
 * servidor, e nunca `useSearchParams` na tela — sem `Suspense` ele quebra o
 * `next build`, e foi exatamente o que derrubou o deploy de 2026-11-04.
 */
export default async function Contas({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { eu, perfis, quem, minhaPessoaId } = await sessaoAtual()
  if (!temPerm(quem, perfis, 'contas')) return <SemAcesso tela="Contas a pagar" />
  const filtro = lerFiltroDeContas(await searchParams)
  return (
    <TelaContas
      hoje={eu.hoje}
      mes={eu.hoje.slice(0, 7)}
      filtro={filtro}
      podeGerir={temPerm(quem, perfis, 'contas.gerir')}
      euId={minhaPessoaId}
    />
  )
}
