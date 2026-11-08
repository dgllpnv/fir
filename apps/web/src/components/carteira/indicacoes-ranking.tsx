'use client'

import type { LinhaDoRankingSaida } from '@fir/contracts'
import Link from 'next/link'

/**
 * "Quem mais indica" (`vIndicadores`, L2544-2546): posição, quem indicou
 * (cliente da carteira ou pessoa), indicações, em andamento, viraram
 * clientes, a taxa e os benefícios.
 *
 * A taxa chama-se "viraram cliente (%)" e NÃO "conversão": é `ganhos/total`,
 * com as indicações em andamento no denominador — a outra conversão, a das
 * encerradas, mora em Oportunidades (gate de números, ajuste 15). Chega
 * pronta do servidor.
 *
 * 390 px: cada linha vira um bloco com os números em grade, sem tabela larga.
 */
export function RankingDeQuemIndica({ ranking }: { ranking: readonly LinhaDoRankingSaida[] }) {
  if (ranking.length === 0) return <p className="nota">Nenhuma indicação registrada.</p>
  return (
    <ol className="lead-ranking">
      {ranking.map((x, i) => {
        const beneficios =
          x.beneficiosConcedidos + x.beneficiosPendentes + x.beneficiosGuardados === 0
            ? '—'
            : [
                x.beneficiosConcedidos > 0 ? `${x.beneficiosConcedidos} concedido${x.beneficiosConcedidos > 1 ? 's' : ''}` : null,
                x.beneficiosPendentes > 0 ? `${x.beneficiosPendentes} pendente${x.beneficiosPendentes > 1 ? 's' : ''}` : null,
                x.beneficiosGuardados > 0 ? `${x.beneficiosGuardados} guardado${x.beneficiosGuardados > 1 ? 's' : ''}` : null,
              ]
                .filter(Boolean)
                .join(', ')
        return (
          <li key={x.chave} className="lead-ranking-linha">
            <span className={i < 3 && x.viraramClientes > 0 ? 'lead-posicao lead-posicao-ouro num' : 'lead-posicao num'}>
              {i + 1}
            </span>
            <span className="lead-ranking-quem">
              {x.clienteCarteiraId !== null ? (
                <Link className="link" href={`/carteira/clientes/${x.clienteCarteiraId}`}>
                  {x.nome}
                </Link>
              ) : (
                <b>{x.nome}</b>
              )}
              <span className="muted">
                {x.clienteCarteiraId !== null ? 'Cliente da carteira' : 'Parceiro ou pessoa'} ·{' '}
                {x.leads.map((l, j) => (
                  <span key={l.id}>
                    {j > 0 ? ', ' : ''}
                    <Link className="link" href={`/carteira/leads/${l.id}`}>
                      {l.nome}
                    </Link>
                  </span>
                ))}
              </span>
            </span>
            <dl className="lead-ranking-numeros num">
              <div>
                <dt>Indicações</dt>
                <dd>{x.total}</dd>
              </div>
              <div>
                <dt>Em andamento</dt>
                <dd>{x.emAndamento}</dd>
              </div>
              <div>
                <dt>Viraram clientes</dt>
                <dd>
                  <b>{x.viraramClientes}</b>
                </dd>
              </div>
              <div>
                <dt>Viraram cliente (%)</dt>
                <dd>{x.indicacoesQueViraramCliente === null ? '—' : `${x.indicacoesQueViraramCliente}%`}</dd>
              </div>
              <div className="lead-ranking-beneficios">
                <dt>Benefícios</dt>
                <dd className={x.beneficiosPendentes > 0 ? 'lead-pendente' : undefined}>{beneficios}</dd>
              </div>
            </dl>
          </li>
        )
      })}
    </ol>
  )
}
