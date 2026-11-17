import { temPerm } from '@fir/domain'
import { TelaIndicadores } from '@/components/indicadores/tela-indicadores'
import { sessaoAtual } from '@/lib/sessao'

/**
 * `/indicadores` — a aba "OKRs e KPIs", a que abre por padrão (1.9 B).
 *
 * `indicadores.gerir` decide só a CONVENIÊNCIA dos botões de criar e editar;
 * o servidor recusa a escrita do mesmo jeito. O layout já conferiu
 * `indicadores`.
 */
export default async function IndicadoresPage() {
  const { eu, perfis, quem, minhaPessoaId } = await sessaoAtual()
  return (
    <TelaIndicadores
      podeGerir={temPerm(quem, perfis, 'indicadores.gerir')}
      minhaPessoaId={minhaPessoaId}
      fuso={eu.clinica.fuso}
    />
  )
}
