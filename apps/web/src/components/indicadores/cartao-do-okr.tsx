'use client'

import type { KpiNaLista, OkrNaSaida, SerieDoKpi } from '@fir/contracts'
import { larguraDaBarra } from '@/lib/financeiro'
import { CartaoDoKpi, Selo } from './cartao-do-kpi'
import { ICONE_TRES_PONTOS, MenuSuspenso } from './menu-suspenso'
import { diaCompleto, numeroDoCartao, ROTULO_DA_SITUACAO, TOM_DA_SITUACAO } from './na-tela'

/**
 * **O cartão do OKR** (1.9 C, faixa 1).
 *
 * Objetivo à esquerda; à direita o progresso grande e o selo. A barra dourada,
 * "Responsável · até", os KPIs ligados (um por linha, dois no computador) e o
 * rodapé com "Editar OKR" e os três pontos. O progresso e a situação vêm do
 * servidor — média dos progressos EXIBIDOS, pior situação (números c.12).
 */
export function CartaoDoOkr({
  okr,
  kpis,
  series,
  responsavel,
  podeGerir,
  acoesDoKpi,
  lancarDoKpi,
  fuso,
  aoEditar,
  aoEncerrar,
  aoDuplicar,
  aoExcluir,
}: {
  okr: OkrNaSaida
  kpis: ReadonlyMap<string, KpiNaLista>
  series: ReadonlyMap<string, SerieDoKpi>
  responsavel: string | null
  podeGerir: boolean
  acoesDoKpi: (k: KpiNaLista) => readonly { rotulo: string; aoTocar: () => void }[]
  /** "Lançar agora" da faixa de pendente, ou `null` para quem não lança o KPI. */
  lancarDoKpi: (k: KpiNaLista) => (() => void) | null
  fuso: string
  aoEditar: () => void
  aoEncerrar: () => void
  aoDuplicar: () => void
  aoExcluir: () => void
}) {
  const situacao = okr.situacao
  const encerrado = okr.estado === 'encerrado'
  return (
    <article className="ii-okr" aria-label={okr.objetivo}>
      <div className="ii-okr-cabeca">
        <h4>{okr.objetivo}</h4>
        <div className="ii-okr-numero">
          <strong>{okr.progresso === null ? '—' : `${okr.progresso}%`}</strong>
          <Selo tom={TOM_DA_SITUACAO[situacao]} texto={encerrado ? 'Encerrado' : ROTULO_DA_SITUACAO[situacao]} />
        </div>
      </div>

      <div
        className="ii-barra"
        role="img"
        aria-label={okr.progresso === null ? 'Progresso ainda sem medição' : `Progresso de ${okr.progresso}%`}
      >
        <span style={{ width: larguraDaBarra(okr.progresso) }} />
      </div>
      <div className="ii-okr-meta">
        {responsavel === null ? 'Sem responsável' : `Responsável: ${responsavel}`} · até {diaCompleto(okr.periodo.fim)}
      </div>

      {okr.resultadosChave.length === 0 ? (
        <p className="nota">Nenhum resultado-chave que o seu perfil possa ver.</p>
      ) : (
        <div className="ii-okr-krs">
          {okr.resultadosChave.map((kr) => {
            const k = kpis.get(kr.kpi.id)
            if (k === undefined) {
              // O KPI saiu da lista pelo filtro de pilar ou responsável: o KR
              // continua no OKR, com o número da meta dele.
              const n = numeroDoCartao(kr.metaDoKr.atual)
              return (
                <div key={kr.id} className="ii-kpi">
                  <div className="ii-kpi-cabeca">
                    <span className="ii-kpi-nome">{kr.kpi.nome}</span>
                    <Selo tom={TOM_DA_SITUACAO[kr.metaDoKr.situacao]} texto={ROTULO_DA_SITUACAO[kr.metaDoKr.situacao]} />
                  </div>
                  <div className="ii-kpi-valor">
                    <strong className={n.soPercentual ? 'ii-so-percentual' : undefined}>{n.texto}</strong>
                  </div>
                </div>
              )
            }
            return (
              <CartaoDoKpi
                key={kr.id}
                kpi={k}
                meta={kr.metaDoKr}
                atual={kr.metaDoKr.atual}
                serie={series.get(k.id) ?? null}
                acoes={acoesDoKpi(k)}
                fuso={fuso}
                aoLancarAgora={lancarDoKpi(k)}
              />
            )
          })}
        </div>
      )}

      {podeGerir ? (
        <div className="ii-okr-rodape">
          {/* OKR encerrado não se edita (409 no servidor): duplica-se para o próximo período. */}
          {encerrado ? null : (
            <button type="button" className="link" onClick={aoEditar}>
              Editar OKR
            </button>
          )}
          <MenuSuspenso
            rotulo={`Mais ações do OKR ${okr.objetivo}`}
            classeDoBotao="ii-tres-pontos"
            conteudoDoBotao={ICONE_TRES_PONTOS}
            opcoes={[
              ...(encerrado ? [] : [{ rotulo: 'Encerrar OKR', aoTocar: aoEncerrar }]),
              { rotulo: 'Duplicar para o próximo trimestre', aoTocar: aoDuplicar },
              { rotulo: 'Excluir', aoTocar: aoExcluir, perigo: true },
            ]}
          />
        </div>
      ) : null}
    </article>
  )
}
