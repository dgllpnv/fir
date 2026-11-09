'use client'

import { usePathname } from 'next/navigation'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { ICONE_MENU } from '@/lib/icones'
import { ehPortaDaCarteira } from '@/lib/rota-da-carteira'
import { ProvedorDaCarteira, useCarteira } from './contexto'
import { LateralDaCarteira } from './lateral'

/**
 * O casco da carteira: a LATERAL à esquerda e o conteúdo ao lado — a forma
 * do protótipo do Firmare Gestão (`.app`, index.html L45, L481–489) e da
 * ferramenta da clínica (`components/shell.tsx`).
 *
 * No computador (≥ 900 px) a lateral é coluna fixa de 232 px; abaixo disso
 * vira GAVETA, aberta pelo botão "Menu" da barra de topo — o mesmo desenho e
 * o mesmo comportamento da clínica (Esc fecha, o foco entra e volta, a gaveta
 * fechada não fica na ordem de tabulação). As classes são `carteira-*`: as
 * da clínica (`.side`, `.topbar`…) trariam junto regras que não são daqui.
 *
 * A porta (`/carteira/entrar`) não tem casco — antes de entrar não há
 * Usuário de Gestão para nomear.
 */
export function Casco({ children }: { children: ReactNode }) {
  const caminho = usePathname()

  if (ehPortaDaCarteira(caminho)) {
    return <ProvedorDaCarteira>{children}</ProvedorDaCarteira>
  }

  return (
    <ProvedorDaCarteira>
      <CascoComLateral>{children}</CascoComLateral>
    </ProvedorDaCarteira>
  )
}

function CascoComLateral({ children }: { children: ReactNode }) {
  const caminho = usePathname()
  const { sessao } = useCarteira()
  const [aberta, setAberta] = useState(false)
  const botaoMenu = useRef<HTMLButtonElement>(null)
  const gaveta = useRef<HTMLElement>(null)

  // Trocar de tela fecha a gaveta. Sem isto, no celular a pessoa toca o item e
  // continua olhando para o menu, sem saber se algo aconteceu.
  useEffect(() => setAberta(false), [caminho])

  // Abrir leva o foco para o PRIMEIRO item: quem abre pelo teclado não fica
  // com o foco no botão "Menu", atrás do véu.
  useEffect(() => {
    if (aberta) gaveta.current?.querySelector<HTMLAnchorElement>('.carteira-menu-item')?.focus()
  }, [aberta])

  // Esc fecha, e o foco volta para o botão que abriu.
  useEffect(() => {
    if (!aberta) return
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setAberta(false)
        botaoMenu.current?.focus()
      }
    }
    document.addEventListener('keydown', aoTeclar)
    return () => document.removeEventListener('keydown', aoTeclar)
  }, [aberta])

  const usuario = sessao.tag === 'pronta' ? sessao.usuarioDeGestao.usuario : ''

  return (
    <div className="carteira">
      <LateralDaCarteira aberta={aberta} gaveta={gaveta} />

      {aberta ? (
        <button type="button" className="carteira-veu" aria-label="Fechar o menu" onClick={() => setAberta(false)} />
      ) : null}

      <div className="carteira-corpo">
        <header className="carteira-topo">
          <div className="carteira-topo-barra">
            <button
              type="button"
              className="carteira-botao-menu"
              ref={botaoMenu}
              aria-controls="carteira-menu-lateral"
              aria-expanded={aberta}
              onClick={() => setAberta(true)}
            >
              {ICONE_MENU}
              Menu
            </button>
            <div className="carteira-marca carteira-marca-topo">
              <b>Firmare</b>
              <span>Gestão</span>
            </div>
            <div className="carteira-topo-quem">{usuario}</div>
          </div>
        </header>
        <main className="carteira-principal">
          <CorpoComSessao>{children}</CorpoComSessao>
        </main>
      </div>
    </div>
  )
}

/**
 * **A tela só aparece depois que a sessão se resolve.** A página é
 * pré-renderizada: sem isto, quem abre `/carteira` sem estar logado (o primeiro
 * acesso num computador novo) via o menu e os blocos vazios da Visão geral por
 * meio segundo antes do desvio para a entrada — e isso parece um sistema
 * quebrado. A lateral segue a MESMA regra (`lateral.tsx`): só a marca até lá.
 */
function CorpoComSessao({ children }: { children: ReactNode }) {
  const { sessao } = useCarteira()
  if (sessao.tag === 'carregando' || sessao.tag === 'saindo') {
    return <p className="nota" role="status" aria-busy="true" />
  }
  return <>{children}</>
}
