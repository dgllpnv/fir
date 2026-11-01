import { temPerm } from '@fir/domain'
import { SemAcesso } from '@/components/sem-acesso'
import { TelaUnidades } from '@/components/tela-unidades'
import { sessaoAtual } from '@/lib/sessao'

/**
 * `/unidades` — os locais de atendimento da clínica.
 *
 * `config`, que é o que `UnidadesController` exige em cada ESCRITA. A LEITURA
 * (`GET /v1/unidades`) é de todos de propósito — escolher a unidade de um
 * atendimento é parte de atender —, mas a tela que CADASTRA é configuração.
 */
export default async function Unidades() {
  const { eu, perfis } = await sessaoAtual()
  const quem = { admin: eu.usuario.admin, perfilId: eu.usuario.perfilId ?? '' }
  if (!temPerm(quem, perfis, 'config')) return <SemAcesso tela="Unidades" />
  return <TelaUnidades />
}
