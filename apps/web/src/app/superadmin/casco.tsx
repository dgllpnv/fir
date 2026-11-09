'use client'

import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'
import { ehPortaDoPainel } from '@/lib/rota-do-painel'
import { ProvedorDoPainel, usePainel } from './contexto'
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
          <main className="wrap">
            <CorpoComSessao>{children}</CorpoComSessao>
          </main>
        </div>
      </div>
    </ProvedorDoPainel>
  )
}

/**
 * **A tela só aparece depois que a sessão se resolve.** Antes, a Visão geral
 * era desenhada vazia enquanto `GET /v1/superadmin/eu` respondia — e, com senha
 * provisória, aparecia por um instante antes do desvio para `trocar-senha`.
 * Um painel que pisca antes de mudar de tela parece quebrado, e é o primeiro
 * acesso de quem acabou de ganhar a conta.
 */
function CorpoComSessao({ children }: { children: ReactNode }) {
  const { sessao } = usePainel()
  if (sessao.tag === 'carregando' || sessao.tag === 'saindo') {
    return <p className="nota" role="status" aria-busy="true" />
  }
  return <>{children}</>
}
