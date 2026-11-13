import { temPerm } from '@fir/domain'
import { SemAcesso } from '@/components/sem-acesso'
import { TelaCampanhas } from '@/components/tela-campanhas'
import { sessaoAtual } from '@/lib/sessao'

/**
 * `/campanhas` — **duas chaves, e é o que a matriz dela diz**.
 *
 * `campanhas` para VER (*"ver as campanhas e executar as ações"*) e
 * `campanhas.gerir` para *"criar, importar e excluir"*. A Recepção e o
 * Comercial têm a primeira; só a Supervisão tem a segunda.
 *
 * `podeGerir` decide se os botões de escrita existem — e o servidor recusa de
 * novo em cada rota (regra 16). A tela é conveniência; quem protege é a API.
 *
 * `?mes=aaaa-mm` e `?tipo=` trazem a lista de volta ao mesmo recorte quando a
 * pessoa vem do detalhe (`searchParams` aqui, e não `useSearchParams` na
 * tela: sem `Suspense` ele quebra o `next build`).
 */
export default async function CampanhasPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { perfis, quem } = await sessaoAtual()
  if (!temPerm(quem, perfis, 'campanhas')) return <SemAcesso tela="Campanhas" />
  const q = await searchParams
  const mes = typeof q['mes'] === 'string' && /^\d{4}-\d{2}$/.test(q['mes']) ? q['mes'] : undefined
  const tipo = typeof q['tipo'] === 'string' && q['tipo'] !== '' ? q['tipo'] : undefined
  return (
    <TelaCampanhas
      podeGerir={temPerm(quem, perfis, 'campanhas.gerir')}
      {...(mes === undefined ? {} : { mesInicial: mes })}
      {...(tipo === undefined ? {} : { tipoInicial: tipo })}
    />
  )
}
