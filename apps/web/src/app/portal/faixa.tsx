'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { chamar } from '@/lib/api'
import { ICONE_SAIR } from '@/lib/icones'
import { usePortal } from './contexto'

/**
 * A FAIXA DO PORTAL — diz onde você está e O QUE você enxerga: o grupo
 * inteiro, ou um só `Cliente Firmare`. Mesmo princípio da faixa da carteira
 * (`carteira/faixa.tsx`), com a cor própria do portal (borda dourada mais
 * clara, ver `portal.css`) — é a quarta sessão do produto, e precisa ser
 * reconhecida como diferente das outras três à primeira vista.
 */
export function FaixaDoPortal() {
  const { sessao } = usePortal()
  const router = useRouter()
  const [saindo, setSaindo] = useState(false)

  async function sair() {
    setSaindo(true)
    await chamar('v1/portal/sair', { method: 'POST' }).catch(() => undefined)
    router.replace('/portal/entrar')
    router.refresh()
  }

  return (
    <header className="portal-faixa">
      <div className="portal-faixa-barra">
        <div className="portal-aqui">
          Portal do grupo
          <small>Firmare · Gestão de Rotina</small>
        </div>

        <p className="portal-onde">{escopoTexto(sessao)}</p>

        {sessao.tag === 'pronta' ? (
          <div className="portal-quem">
            <span title={sessao.usuarioDoPortal.usuario}>{sessao.usuarioDoPortal.nome}</span>
            <button type="button" className="btn ghost" onClick={() => void sair()} disabled={saindo}>
              {ICONE_SAIR}
              {saindo ? 'Saindo…' : 'Sair'}
            </button>
          </div>
        ) : null}
      </div>
    </header>
  )
}

function escopoTexto(sessao: ReturnType<typeof usePortal>['sessao']) {
  if (sessao.tag !== 'pronta') return null
  if (sessao.usuarioDoPortal.escopo === 'grupo') {
    return (
      <>
        <span>Visão</span>
        <b>o grupo inteiro</b>
      </>
    )
  }
  return (
    <>
      <span>Visão</span>
      <b>uma clínica</b>
    </>
  )
}
