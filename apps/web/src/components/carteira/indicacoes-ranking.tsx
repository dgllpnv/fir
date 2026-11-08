'use client'

import type { LinhaDoRankingSaida } from '@fir/contracts'
import Link from 'next/link'

/**
 * "Quem mais indica" (`vIndicadores`, L2544-2546), em TABELA como no
 * protótipo: #, quem indicou (cliente da carteira ou pessoa, com os leads
 * indicados), indicações, em andamento, viraram clientes, a taxa e os
 * benefícios.
 *
 * A taxa chama-se "viraram cliente (%)" e NÃO "conversão": é `ganhos/total`,
 * com as indicações em andamento no denominador — a outra conversão, a das
 * encerradas, mora em Oportunidades (gate de números, ajuste 15). Chega
 * pronta do servidor.
 *
 * 390 px: cada linha vira um bloco com os números em grade — nada rola na
 * horizontal.
 */
export function RankingDeQuemIndica({ ranking }: { ranking: readonly LinhaDoRankingSaida[] }) {
  return (
    <div className="prosp-ranking-caixa">
      <table className="prosp-tabela prosp-ranking">
        <thead>
          <tr>
            <th scope="col">#</th>
            <th scope="col">Quem indicou</th>
            <th scope="col" className="prosp-num">
              Indicações
            </th>
            <th scope="col" className="prosp-num">
              Em andamento
            </th>
            <th scope="col" className="prosp-num">
              Viraram clientes
            </th>
            <th scope="col" className="prosp-num">
              Viraram cliente (%)
            </th>
            <th scope="col" className="prosp-num">
              Benefícios
            </th>
          </tr>
        </thead>
        <tbody>
          {ranking.length === 0 ? (
            <tr>
              <td colSpan={7} className="prosp-vazio">
                Nenhuma indicação registrada.
              </td>
            </tr>
          ) : (
            ranking.map((x, i) => (
              <tr key={x.chave}>
                <td>
                  <span className={i < 3 && x.viraramClientes > 0 ? 'prosp-posicao prosp-posicao-ouro num' : 'prosp-posicao num'}>
                    {i + 1}
                  </span>
                </td>
                <td className="prosp-medico">
                  {x.clienteCarteiraId !== null ? (
                    <Link className="prosp-nome prosp-nome-link" href={`/carteira/clientes/${x.clienteCarteiraId}`}>
                      {x.nome}
                    </Link>
                  ) : (
                    <span className="prosp-nome">{x.nome}</span>
                  )}
                  <span className="prosp-pequeno">
                    {x.clienteCarteiraId !== null ? 'Cliente da carteira' : 'Parceiro ou pessoa'} ·{' '}
                    {x.leads.map((l, j) => (
                      <span key={l.id}>
                        {j > 0 ? ', ' : ''}
                        <Link className="prosp-link-discreto" href={`/carteira/leads/${l.id}`}>
                          {l.nome}
                        </Link>
                      </span>
                    ))}
                  </span>
                </td>
                <td data-rotulo="Indicações" className="prosp-num num">
                  {x.total}
                </td>
                <td data-rotulo="Em andamento" className="prosp-num num">
                  {x.emAndamento}
                </td>
                <td data-rotulo="Viraram clientes" className="prosp-num num">
                  <b>{x.viraramClientes}</b>
                </td>
                <td data-rotulo="Viraram cliente (%)" className="prosp-num num">
                  {x.indicacoesQueViraramCliente === null ? '—' : `${x.indicacoesQueViraramCliente}%`}
                </td>
                <td data-rotulo="Benefícios" className="prosp-num num">
                  <Beneficios linha={x} />
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}

/** "0 concedido, 1 pendente" (L2546), com o pendente em vermelho; guardado é nosso (D-22 item 11). */
function Beneficios({ linha: x }: { linha: LinhaDoRankingSaida }) {
  if (x.beneficiosConcedidos + x.beneficiosPendentes + x.beneficiosGuardados === 0) return <>—</>
  const plural = (n: number, s: string) => `${n} ${s}${n > 1 ? 's' : ''}`
  return (
    <>
      {plural(x.beneficiosConcedidos, 'concedido')}
      {x.beneficiosPendentes > 0 ? (
        <>
          , <span className="prosp-atrasado">{plural(x.beneficiosPendentes, 'pendente')}</span>
        </>
      ) : null}
      {x.beneficiosGuardados > 0 ? <>, {plural(x.beneficiosGuardados, 'guardado')}</> : null}
    </>
  )
}
