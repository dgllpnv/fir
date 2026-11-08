'use client'

import type { UsuarioDeGestaoPublico } from '@fir/contracts'
import { useRouter } from 'next/navigation'
import { useCallback } from 'react'
import { VisaoGeral } from '@/components/carteira/visao-geral'
import { useCarteira } from './contexto'
import { ErroDaCarteira, NavDaCarteira, primeiraAreaPermitida } from './pecas'

/**
 * `/carteira` — a **Visão geral** (G8 3B; `vPainel`, protótipo L1278–1331).
 *
 * O corpo mora em `components/carteira/visao-geral.tsx` desde a D-23 item 6
 * (ADR 0024): o painel do superadmin abre a MESMA tela em `/superadmin`.
 * Aqui ficam só as peças da carteira: o menu dela, o erro com as saídas dela
 * e o desvio de quem não tem a tela para a primeira área que pode abrir
 * (protótipo L1266).
 */
export default function VisaoGeralDaCarteira() {
  const router = useRouter()
  const { sessao } = useCarteira()
  const usuario = sessao.tag === 'pronta' ? sessao.usuarioDeGestao : null
  const semPermissao = useCallback(
    (u: UsuarioDeGestaoPublico) => router.replace(primeiraAreaPermitida(u)),
    [router],
  )
  return (
    <VisaoGeral
      usuario={usuario}
      navegacao={<NavDaCarteira atual="/carteira" />}
      erro={(mensagem, recarregar) => <ErroDaCarteira mensagem={mensagem} recarregar={recarregar} />}
      semPermissao={semPermissao}
    />
  )
}
