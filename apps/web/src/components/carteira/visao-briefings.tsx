'use client'

import type { ListaDeClientesDaCarteiraSaida } from '@fir/contracts'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { chamar } from '@/lib/api'

/**
 * **BRIEFINGS A FAZER** (`painelBriefings`, protótipo L1898–1902): os
 * clientes em onboarding, cada um com o botão que abre o briefing.
 *
 * O briefing GRAVADO ainda não existe (espera o jurídico, gate LGPD A57–A59),
 * então todo cliente em onboarding aparece como "não iniciado" e o botão leva
 * ao roteiro em Método › Roteiros — o mesmo destino da ficha hoje.
 *
 * A fonte é `GET /v1/carteira/clientes` (o status), cruzada com os clientes
 * ativos da Visão geral para valer o mesmo escopo da tela (A-3, "só a minha
 * carteira"). Filtrar não é calcular: nenhuma contagem sai daqui.
 *
 * Como no protótipo, sem cliente em onboarding o bloco não aparece.
 */
export function BriefingsAFazer({
  ativos,
  podeAbrirRoteiro,
}: {
  /** Os ids dos clientes ativos da Visão geral (o escopo da tela). */
  ativos: readonly string[]
  podeAbrirRoteiro: boolean
}) {
  const [lista, setLista] = useState<readonly { id: string; nome: string }[] | null>(null)
  const chave = ativos.join(',')

  useEffect(() => {
    let valeu = true
    const doEscopo = new Set(chave.split(','))
    chamar<ListaDeClientesDaCarteiraSaida>('v1/carteira/clientes')
      .then((r) => {
        if (!valeu) return
        setLista(r.clientes.filter((c) => c.status === 'onboarding' && doEscopo.has(c.id)).map((c) => ({ id: c.id, nome: c.nome })))
      })
      // Sem a lista o bloco só não aparece: o resto da Visão geral continua.
      .catch(() => {
        if (valeu) setLista([])
      })
    return () => {
      valeu = false
    }
  }, [chave])

  if (lista === null || lista.length === 0) return null
  return (
    <div className="visao-painel">
      <div className="visao-painel-cabeca">
        <h2>Briefings a fazer</h2>
        <span className="visao-mudo">Clientes em onboarding sem briefing concluído</span>
      </div>
      <ul className="visao-linhas">
        {lista.map((c) => (
          <li key={c.id} className="visao-linha">
            <span className="visao-linha-titulo">
              {c.nome} <span className="visao-mudo">· não iniciado</span>
            </span>
            {podeAbrirRoteiro ? (
              <Link className="btn visao-mini" href="/carteira/metodo/roteiros">
                Iniciar briefing
              </Link>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  )
}
