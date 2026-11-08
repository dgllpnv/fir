'use client'

import type { IndicacoesSaida, LinhaDoRankingSaida } from '@fir/contracts'
import { useEffect, useState } from 'react'
import { chamar } from '@/lib/api'

/**
 * **V4 — "INDICOU N MÉDICOS"** na visão geral da ficha (`resumoIndicacoes`,
 * protótipo `index.html` L2549-2553, chamado no painel Cadastro em L1424).
 *
 * "Indicou 2 médicos · 1 virou cliente · 1 benefício pendente". Os três
 * números são os da linha deste cliente em "Quem mais indica"
 * (`GET /v1/carteira/indicacoes`, ticket 1E) — contados no servidor, com a
 * mesma regra do ranking (leads arquivados fora, "minha carteira" filtrada
 * lá). A tela só ACHA a linha do cliente; não conta nada.
 *
 * Como no protótipo, quem não indicou ninguém não vê linha nenhuma. Sem o
 * módulo de prospecção a rota responde 403, e a linha também não aparece —
 * não é um erro da ficha, é uma tela que a pessoa não tem.
 */
export function IndicacoesDoCliente({ clienteId }: { clienteId: string }) {
  const [linha, setLinha] = useState<LinhaDoRankingSaida | null>(null)

  useEffect(() => {
    let valeu = true
    chamar<IndicacoesSaida>('v1/carteira/indicacoes')
      .then((r) => {
        if (valeu) setLinha(r.ranking.find((x) => x.clienteCarteiraId === clienteId) ?? null)
      })
      .catch(() => {
        if (valeu) setLinha(null)
      })
    return () => {
      valeu = false
    }
  }, [clienteId])

  if (linha === null || linha.total === 0) return null
  const g = linha.viraramClientes
  const p = linha.beneficiosPendentes
  return (
    <p className="ind-indicou">
      <span className="ind-chip-ouro num">
        Indicou {linha.total} {linha.total > 1 ? 'médicos' : 'médico'}
      </span>
      <span className="ficha-mudo num">
        {g} {g === 1 ? 'virou cliente' : 'viraram clientes'}
        {p > 0 ? (
          <>
            {' · '}
            <span className="ind-atrasado">
              {p} {p === 1 ? 'benefício pendente' : 'benefícios pendentes'}
            </span>
          </>
        ) : null}
      </span>
    </p>
  )
}
