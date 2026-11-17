'use client'

import type { IndicadoresDaSemana } from '@fir/contracts'
import { useDados } from '@/lib/dados'
import { larguraDaBarra } from '@/lib/financeiro'
import { Selo } from './cartao-do-kpi'
import { numeroDoCartao, ROTULO_DA_SITUACAO, textoDaMeta, TOM_DA_SITUACAO } from './na-tela'
import './indicadores.css'
import './fora-da-aba.css'

/**
 * **"Indicadores da semana", em Hoje** (backlog 1.9 H): logo abaixo do bloco
 * do dia, até 4 cartões pequenos das metas em vermelho ou amarelo e o link
 * "Ver todos". Cada cartão abre o detalhe do KPI.
 *
 * Só é montado para quem tem `indicadores` (a página decide, pela mesma
 * `temPerm` da API — e a rota recusa do mesmo jeito). Os itens chegam
 * escolhidos e ordenados pelo servidor (`abaixo` primeiro), sem composição
 * nem paciente (L-IN-4); sem `valores`, o `emDinheiro` veio apagado e o
 * número vira o percentual da meta.
 */
export function IndicadoresDaSemanaEmHoje() {
  const d = useDados<IndicadoresDaSemana>('v1/indicadores/da-semana')

  return (
    <section className="grupo hs" aria-labelledby="hs-titulo">
      <div className="hs-cabeca">
        <h3 id="hs-titulo">Indicadores da semana</h3>
        <a className="link hs-ver" href="/indicadores">
          Ver todos
        </a>
      </div>
      {d.carregando && d.dados === null ? (
        <div className="hs-reserva" aria-busy="true">
          <span className="sr-apenas">Carregando…</span>
        </div>
      ) : null}
      {d.erro === null ? null : (
        <p className="nota" role="alert">
          Não consegui carregar os indicadores.{' '}
          <button type="button" className="link" onClick={d.recarregar}>
            Tentar de novo
          </button>
        </p>
      )}
      {d.dados !== null && d.dados.itens.length === 0 ? (
        <p className="nota">Nenhuma meta abaixo do ritmo ou em atenção esta semana.</p>
      ) : null}
      {d.dados === null || d.dados.itens.length === 0 ? null : (
        <ul className="hs-grade">
          {d.dados.itens.map((m) => {
            const n = numeroDoCartao(m.metaDoKpi.atual)
            const de = textoDaMeta(m.metaDoKpi)
            const s = m.metaDoKpi.situacao
            return (
              <li key={m.metaDoKpi.id}>
                <a className="hs-cartao" href={`/indicadores/${m.kpi.id}`}>
                  <span className="hs-nome">
                    <span>{m.kpi.nome}</span>
                    <Selo tom={TOM_DA_SITUACAO[s]} texto={ROTULO_DA_SITUACAO[s]} />
                  </span>
                  <span className="hs-valor">
                    <strong>{n.texto}</strong>
                    {de === null ? null : <small>{de}</small>}
                  </span>
                  <span
                    className="ii-barra"
                    role="img"
                    aria-label={
                      m.metaDoKpi.atual.percentualDaMeta === null
                        ? 'Meta sem medição ainda'
                        : `${m.metaDoKpi.atual.percentualDaMeta}% da meta${m.metaDoKpi.ritmo.percentualDaMeta === null ? '' : `; o esperado para hoje é ${m.metaDoKpi.ritmo.percentualDaMeta}%`}`
                    }
                  >
                    <span style={{ width: larguraDaBarra(m.metaDoKpi.atual.percentualDaMeta) }} />
                    {m.metaDoKpi.ritmo.percentualDaMeta === null ? null : (
                      <i style={{ left: larguraDaBarra(m.metaDoKpi.ritmo.percentualDaMeta) }} />
                    )}
                  </span>
                  {m.okrId === null ? null : <span className="hs-origem">resultado-chave de OKR</span>}
                </a>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
