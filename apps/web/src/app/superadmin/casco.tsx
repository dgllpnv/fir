'use client'

import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'
import { ehPortaDoPainel } from '@/lib/rota-do-painel'
import { ProvedorDoPainel } from './contexto'
import { FaixaDoPainel } from './faixa'

/**
 * O casco do painel: a faixa, e o corpo abaixo dela.
 *
 * **As portas não têm faixa** (`/superadmin/entrar` e
 * `/superadmin/trocar-senha`). Não é economia de pixel: antes de entrar não há
 * operador nem clínica para nomear, e uma faixa que dissesse "nenhuma clínica
 * aberta" na tela de senha ensinaria a ignorá-la — e a faixa só vale enquanto
 * for lida. Cada porta carrega o selo `PAINEL INTERNO` no próprio corpo, com
 * o espaço que uma tela de porta tem para dar, e a mesma caixa centrada da
 * tela de entrada do produto (`.entrada`, de `shell.css`).
 *
 * O provedor envolve as duas formas: ele é quem resolve a sessão e a clínica
 * **uma vez**, e quem desvia para a porta quando não há sessão.
 */
export function Casco({ children }: { children: ReactNode }) {
  const caminho = usePathname()

  if (ehPortaDoPainel(caminho)) {
    return <ProvedorDoPainel>{children}</ProvedorDoPainel>
  }

  return (
    <ProvedorDoPainel>
      <div className="superadmin">
        <FaixaDoPainel />
        <div className="superadmin-corpo">
          <main className="wrap">{children}</main>
        </div>
      </div>
    </ProvedorDoPainel>
  )
}
