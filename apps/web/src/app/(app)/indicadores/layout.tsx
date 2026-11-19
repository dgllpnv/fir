import { temPerm } from '@fir/domain'
import type { ReactNode } from 'react'
import { TelaCheiaDaReuniao } from '@/components/indicadores/tela-cheia-da-reuniao'
import { SemAcesso } from '@/components/sem-acesso'
import { sessaoAtual } from '@/lib/sessao'
import '@/components/indicadores/indicadores.css'

/**
 * `/indicadores/*` — **Gestão › Indicadores & Insights** (I-43). O layout é
 * comum às abas e às páginas internas (detalhe, Modo reunião, relatórios), e
 * é ele que diz "Sem acesso a esta tela" a quem chegou pela URL sem
 * `indicadores` — o menu já escondeu o item, mas menu não é controle de
 * acesso. O servidor recusa toda rota `GET /v1/indicadores*` do mesmo jeito.
 */
export default async function IndicadoresLayout({ children }: { children: ReactNode }) {
  const { perfis, quem } = await sessaoAtual()
  if (!temPerm(quem, perfis, 'indicadores')) return <SemAcesso tela="Indicadores & Insights" />
  return (
    <>
      {/* "Modo reunião" em tela cheia de qualquer aba: um ponto só (1.9 F). */}
      <TelaCheiaDaReuniao />
      {children}
    </>
  )
}
