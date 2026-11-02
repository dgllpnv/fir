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
 */
export default async function CampanhasPage() {
  const { eu, perfis, quem } = await sessaoAtual()
  if (!temPerm(quem, perfis, 'campanhas')) return <SemAcesso tela="Campanhas" />
  return <TelaCampanhas podeGerir={temPerm(quem, perfis, 'campanhas.gerir')} />
}
