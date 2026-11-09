'use client'

import type { IndicacoesSaida, ListaDeBeneficiosSaida, ListaDeClientesDaCarteiraSaida } from '@fir/contracts'
import { useEffect, useState } from 'react'
import { PainelDeBeneficios } from '@/components/carteira/beneficios-painel'
import { RankingDeQuemIndica } from '@/components/carteira/indicacoes-ranking'
import { CabecalhoDaProspeccao } from '@/components/carteira/lead-pecas'
import { Carregando, Toast } from '@/components/estados'
import { chamar, ErroDaApi } from '@/lib/api'
import { useCarteira } from '../../contexto'
import { ErroDaCarteira } from '../../pecas'

/**
 * **PROSPECÇÃO · QUEM INDICA** — `vIndicadores` do protótipo (L2533-2548):
 * os benefícios a conceder (com a regra atual), o ranking de quem mais indica
 * e os benefícios já concedidos. Tudo calculado no servidor.
 */
type Estado =
  | { tag: 'carregando' }
  | { tag: 'erro'; mensagem: string }
  | {
      tag: 'pronto'
      indicacoes: IndicacoesSaida
      beneficios: ListaDeBeneficiosSaida
      clientes: { id: string; nome: string }[]
    }

export default function QuemIndica() {
  const { sessao } = useCarteira()
  const [estado, setEstado] = useState<Estado>({ tag: 'carregando' })
  const [tentativa, setTentativa] = useState(0)
  const [recado, setRecado] = useState<string | null>(null)
  const recarregar = () => setTentativa((n) => n + 1)

  useEffect(() => {
    if (sessao.tag !== 'pronta') return
    let valeu = true
    void (async () => {
      try {
        const [indicacoes, beneficios, clientes] = await Promise.all([
          chamar<IndicacoesSaida>('v1/carteira/indicacoes'),
          chamar<ListaDeBeneficiosSaida>('v1/carteira/beneficios'),
          chamar<ListaDeClientesDaCarteiraSaida>('v1/carteira/clientes').catch(() => ({ clientes: [] })),
        ])
        if (valeu) {
          setEstado({
            tag: 'pronto',
            indicacoes,
            beneficios,
            clientes: clientes.clientes.map((c) => ({ id: c.id, nome: c.nome })),
          })
        }
      } catch (e) {
        if (valeu) {
          setEstado({ tag: 'erro', mensagem: e instanceof ErroDaApi ? e.message : 'Não foi possível carregar as indicações.' })
        }
      }
    })()
    return () => {
      valeu = false
    }
  }, [sessao.tag, tentativa])

  const pendentes =
    estado.tag === 'pronto' ? estado.beneficios.beneficios.filter((b) => b.situacao !== 'concedido').length : undefined

  return (
    <section className="lead-tela">
      <CabecalhoDaProspeccao aba="indicacoes" {...(pendentes === undefined ? {} : { beneficiosPendentes: pendentes })} />

      {sessao.tag !== 'pronta' || estado.tag === 'carregando' ? (
        <Carregando linhas={5} />
      ) : estado.tag === 'erro' ? (
        <ErroDaCarteira mensagem={estado.mensagem} recarregar={recarregar} />
      ) : (
        <>
          <PainelDeBeneficios
            beneficios={estado.beneficios.beneficios}
            regraPercentualCentesimos={estado.beneficios.regraPercentualCentesimos}
            clientes={estado.clientes}
            aoMudar={(r) => {
              setRecado(r)
              recarregar()
            }}
          />
          <section className="lead-painel" aria-labelledby="lead-quem-indica">
            <div className="lead-painel-cabeca">
              <h2 id="lead-quem-indica">Quem mais indica</h2>
              <p className="nota num">
                {estado.indicacoes.ranking.length}{' '}
                {estado.indicacoes.ranking.length === 1 ? 'pessoa ou cliente já indicou' : 'pessoas e clientes já indicaram'}
              </p>
            </div>
            <RankingDeQuemIndica ranking={estado.indicacoes.ranking} />
          </section>
        </>
      )}
      <Toast recado={recado} aoFechar={() => setRecado(null)} />
    </section>
  )
}
