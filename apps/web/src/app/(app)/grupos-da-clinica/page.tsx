import { temPerm } from '@fir/domain'
import { SemAcesso } from '@/components/sem-acesso'
import { TelaGruposDaClinica } from '@/components/tela-grupos-da-clinica'
import { sessaoAtual } from '@/lib/sessao'

/**
 * `/grupos-da-clinica` — quais grupos da carteira recebem os números
 * agregados desta clínica. `config`, o mesmo que `GET /v1/clinica/grupos`.
 */
export default async function GruposDaClinica() {
  const { eu, perfis, quem } = await sessaoAtual()
  if (!temPerm(quem, perfis, 'config')) return <SemAcesso tela="Grupos que recebem a clínica" />
  return <TelaGruposDaClinica fuso={eu.clinica.fuso} hoje={eu.hoje} />
}
