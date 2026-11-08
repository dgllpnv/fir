'use client'

import type { IndicadoresDoClienteSaida, PlanilhaDoClienteNaSaida } from '@fir/contracts'
import { useEffect, useState } from 'react'
import { IndicadoresDoCliente } from '@/components/carteira/indicadores-do-cliente'
import { PlanilhaDoCliente, PlanilhaSemLeitura } from '@/components/carteira/planilha-do-cliente'
import { Carregando, Toast } from '@/components/estados'
import { chamar, ErroDaApi } from '@/lib/api'
import { ErroDaCarteira } from '../../pecas'

/**
 * A ABA **INDICADORES** da ficha (`cIndicadores`, protótipo `index.html`
 * L1495-1498): a planilha quando ela já foi lida (V11, `cIndicadoresPlanilha`),
 * senão os indicadores manuais (V10, `cIndicadoresManual`) com a situação da
 * planilha embaixo — sem planilha configurada, ou aguardando a primeira
 * leitura.
 *
 * As duas leituras vão juntas. A dos indicadores manuais é a que decide o
 * erro da aba; a da planilha, se falhar, só tira o bloco dela e diz isso —
 * a aba não fica refém de uma integração externa.
 */
type Estado =
  | { tag: 'carregando' }
  | { tag: 'erro'; mensagem: string }
  | { tag: 'pronto'; indicadores: IndicadoresDoClienteSaida; planilha: PlanilhaDoClienteNaSaida | null }

const mensagemDe = (e: unknown): string =>
  e instanceof ErroDaApi ? e.message : 'Não consegui falar com o servidor. Confira a conexão.'

export default function AbaDeIndicadores({ clienteId }: { clienteId: string }) {
  const [estado, setEstado] = useState<Estado>({ tag: 'carregando' })
  const [tentativa, setTentativa] = useState(0)
  const [recado, setRecado] = useState<string | null>(null)
  const recarregar = () => setTentativa((n) => n + 1)

  useEffect(() => {
    let valeu = true
    const base = `v1/carteira/clientes/${encodeURIComponent(clienteId)}`
    void (async () => {
      try {
        const [indicadores, planilha] = await Promise.all([
          chamar<IndicadoresDoClienteSaida>(`${base}/indicadores`),
          chamar<PlanilhaDoClienteNaSaida>(`${base}/planilha?semanas=8`).catch(() => null),
        ])
        if (valeu) setEstado({ tag: 'pronto', indicadores, planilha })
      } catch (e) {
        if (valeu) setEstado({ tag: 'erro', mensagem: mensagemDe(e) })
      }
    })()
    return () => {
      valeu = false
    }
  }, [clienteId, tentativa])

  if (estado.tag === 'carregando') return <Carregando linhas={4} />
  if (estado.tag === 'erro') return <ErroDaCarteira mensagem={estado.mensagem} recarregar={recarregar} />

  const aoMudar = (texto: string) => {
    recarregar()
    setRecado(texto)
  }
  const { indicadores, planilha } = estado
  const lida = planilha !== null && planilha.planilha !== null && planilha.planilha.lidaEm !== null

  return (
    <div className="ficha-pilha">
      {lida ? (
        <PlanilhaDoCliente clienteId={clienteId} inicial={planilha} aoMudar={aoMudar} />
      ) : (
        <>
          <IndicadoresDoCliente clienteId={clienteId} dados={indicadores} aoMudar={aoMudar} />
          {planilha !== null ? (
            <PlanilhaSemLeitura clienteId={clienteId} dados={planilha} aoMudar={aoMudar} />
          ) : (
            <p className="ficha-vazio" role="status">
              Não consegui ler a situação da planilha agora.{' '}
              <button type="button" className="link" onClick={recarregar}>
                Recarregar
              </button>
            </p>
          )}
        </>
      )}
      <Toast recado={recado} aoFechar={() => setRecado(null)} />
    </div>
  )
}
