'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { chamar } from '@/lib/api'
import { ICONE_SAIR } from '@/lib/icones'
import { useCarteira } from './contexto'

/**
 * A FAIXA DA CARTEIRA — diz onde você está e O QUE você enxerga: todos os
 * grupos, ou um só. Mesmo princípio da faixa do painel (`faixa.tsx` do
 * superadmin), discreta por design: a carteira não cria clínica nem
 * administradora em lugar nenhum, então o alarme dourado cheio do painel não
 * se aplica aqui.
 */
export function FaixaDaCarteira() {
  const { sessao } = useCarteira()
  const router = useRouter()
  const [saindo, setSaindo] = useState(false)

  async function sair() {
    setSaindo(true)
    await chamar('v1/carteira/sair', { method: 'POST' }).catch(() => undefined)
    router.replace('/carteira/entrar')
    router.refresh()
  }

  return (
    <header className="carteira-faixa">
      <div className="carteira-faixa-barra">
        <div className="carteira-aqui">
          Carteira comercial
          <small>Firmare · Gestão de Rotina</small>
        </div>

        <p className="carteira-onde">{escopoTexto(sessao)}</p>

        {sessao.tag === 'pronta' ? (
          <div className="carteira-quem">
            <span title={sessao.usuarioDeGestao.usuario}>{sessao.usuarioDeGestao.usuario}</span>
            {/* A troca VOLUNTÁRIA. A obrigatória (provisória) não passa por
                aqui: o provedor desvia antes de a faixa existir. */}
            <a className="btn ghost" href="/carteira/trocar-senha">
              Trocar senha
            </a>
            <button
              type="button"
              className="btn ghost"
              onClick={() => void sair()}
              disabled={saindo}
            >
              {ICONE_SAIR}
              {saindo ? 'Saindo…' : 'Sair'}
            </button>
          </div>
        ) : null}
      </div>
    </header>
  )
}

function escopoTexto(sessao: ReturnType<typeof useCarteira>['sessao']) {
  if (sessao.tag !== 'pronta') return null
  if (sessao.usuarioDeGestao.escopo === 'geral') {
    return (
      <>
        <span>Visão</span>
        <b>todos os grupos</b>
      </>
    )
  }
  return (
    <>
      <span>Visão</span>
      <b>um grupo</b>
    </>
  )
}
