import { temPerm } from '@fir/domain'
import { SemAcesso } from '@/components/sem-acesso'
import { TelaProcedimentos } from '@/components/tela-procedimentos'
import { sessaoAtual } from '@/lib/sessao'

/**
 * `/procedimentos` — o catálogo da clínica.
 *
 * `config`, e não `programas.gerir`: é a permissão que o `CatalogoController`
 * exige em cada ESCRITA. O catálogo é configuração da clínica, não operação do
 * dia — quem monta programas usa o catálogo; quem o edita muda o que toda nova
 * adesão vai sugerir.
 */
export default async function Procedimentos() {
  const { eu, perfis } = await sessaoAtual()
  const quem = { admin: eu.usuario.admin, perfilId: eu.usuario.perfilId ?? '' }
  if (!temPerm(quem, perfis, 'config')) return <SemAcesso tela="Procedimentos" />
  return <TelaProcedimentos />
}
