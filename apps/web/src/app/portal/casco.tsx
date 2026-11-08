'use client'

import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'
import { ehPortaDoPortal } from '@/lib/rota-do-portal'
import { ProvedorDoPortal } from './contexto'
import { FaixaDoPortal } from './faixa'

/**
 * O casco do portal: a faixa, e o corpo abaixo dela. Mesma forma de
 * `carteira/casco.tsx`.
 *
 * A porta (`/portal/entrar`) não tem faixa — antes de entrar não há
 * `Usuário do portal` para nomear.
 */
export function Casco({ children }: { children: ReactNode }) {
  const caminho = usePathname()

  // A prévia "ver como a cliente" (O9) é da sessão da CARTEIRA: sem o
  // provedor do portal, que mandaria quem não tem cookie de portal à porta.
  if (caminho.startsWith('/portal/previa/')) return <>{children}</>

  if (ehPortaDoPortal(caminho)) {
    return <ProvedorDoPortal>{children}</ProvedorDoPortal>
  }

  return (
    <ProvedorDoPortal>
      <div className="portal">
        <FaixaDoPortal />
        <div className="portal-corpo">
          <main className="wrap">{children}</main>
        </div>
      </div>
    </ProvedorDoPortal>
  )
}
