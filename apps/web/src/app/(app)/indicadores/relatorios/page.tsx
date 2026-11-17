import { CHAVES_DE_RELATORIO, podeAbrirRelatorio } from '@fir/contracts'
import { type ChaveDePermissao, temPerm } from '@fir/domain'
import { pedidoDoLink } from '@/components/relatorios/na-tabela'
import { TelaRelatorios } from '@/components/relatorios/tela-relatorios'
import { sessaoAtual } from '@/lib/sessao'
import '@/components/relatorios/relatorios.css'

/**
 * `/indicadores/relatorios` — a aba "Relatórios" (1.9 G; T8, T9).
 *
 * O layout de `/indicadores` já conferiu `indicadores`; cada relatório confere
 * a sua permissão no servidor, e `GET /v1/relatorios` só lista o que a pessoa
 * pode abrir. Aqui a MESMA `podeAbrirRelatorio` decide o que a tela oferece,
 * e `campanhas.gerir` decide o botão "Criar campanha com esta lista" — as duas
 * só por conveniência: o servidor recusa do mesmo jeito.
 *
 * `hoje` é o dia de negócio da API (regra 24), para o período padrão dos
 * filtros. `?relatorio=&de=&ate=` é o link do detalhe do KPI (T6).
 */
export default async function RelatoriosPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const [{ eu, perfis, quem, suporte }, consulta] = await Promise.all([sessaoAtual(), searchParams])
  const pode = (k: ChaveDePermissao): boolean => temPerm(quem, perfis, k)
  return (
    <TelaRelatorios
      hoje={eu.hoje}
      podeJornada={pode('jornada')}
      sessaoDeSuporte={suporte !== null}
      abertos={CHAVES_DE_RELATORIO.filter((k) => podeAbrirRelatorio(k, pode))}
      podeCampanhas={pode('campanhas.gerir')}
      semValores={!pode('valores')}
      pedidoDoLink={pedidoDoLink(consulta)}
    />
  )
}
