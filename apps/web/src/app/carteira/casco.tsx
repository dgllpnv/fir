'use client'

import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'
import { ehPortaDaCarteira } from '@/lib/rota-da-carteira'
import { ProvedorDaCarteira } from './contexto'
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
          <main className="wrap">{children}</main>
        </div>
      </div>
    </ProvedorDaCarteira>
  )
}
