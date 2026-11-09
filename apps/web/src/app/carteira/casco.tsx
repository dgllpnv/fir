'use client'

import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'
import { ehPortaDaCarteira } from '@/lib/rota-da-carteira'
import { ProvedorDaCarteira, useCarteira } from './contexto'
import { FaixaDaCarteira } from './faixa'

/**
 * O casco da carteira: a faixa, e o corpo abaixo dela. Mesma forma de
 * `casco.tsx` do painel do superadmin.
 *
 * A porta (`/carteira/entrar`) não tem faixa — antes de entrar não há
 * Usuário de Gestão para nomear.
 */
export function Casco({ children }: { children: ReactNode }) {
  const caminho = usePathname()

  if (ehPortaDaCarteira(caminho)) {
    return <ProvedorDaCarteira>{children}</ProvedorDaCarteira>
  }

  return (
    <ProvedorDaCarteira>
      <div className="carteira">
        <FaixaDaCarteira />
        <div className="carteira-corpo">
          <main className="wrap">
            <CorpoComSessao>{children}</CorpoComSessao>
          </main>
        </div>
      </div>
    </ProvedorDaCarteira>
  )
}

/**
 * **A tela só aparece depois que a sessão se resolve.** A página é
 * pré-renderizada: sem isto, quem abre `/carteira` sem estar logado (o primeiro
 * acesso num computador novo) via o menu e os blocos vazios da Visão geral por
 * meio segundo antes do desvio para a entrada — e isso parece um sistema
 * quebrado. Mesma regra do `casco.tsx` do painel do superadmin.
 */
function CorpoComSessao({ children }: { children: ReactNode }) {
  const { sessao } = useCarteira()
  if (sessao.tag === 'carregando' || sessao.tag === 'saindo') {
    return <p className="nota" role="status" aria-busy="true" />
  }
  return <>{children}</>
}
