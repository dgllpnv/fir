'use client'

import { type ReactNode, useEffect, useId, useRef, useState } from 'react'

export type OpcaoDoMenu = { readonly rotulo: string; readonly aoTocar: () => void; readonly perigo?: boolean }

/**
 * O menu que abre de um botão: "+ Novo" no topo e os três pontos do OKR.
 *
 * Abre e fecha no toque (não no passar do mouse: no balcão é o dedo), Esc
 * fecha e devolve o foco ao botão, e tocar fora fecha. As opções são botões
 * de 44 px — alvo de dedo.
 */
export function MenuSuspenso({
  rotulo,
  conteudoDoBotao,
  classeDoBotao,
  opcoes,
}: {
  /** O nome acessível do botão. */
  rotulo: string
  conteudoDoBotao: ReactNode
  classeDoBotao: string
  opcoes: readonly OpcaoDoMenu[]
}) {
  const [aberto, setAberto] = useState(false)
  const raiz = useRef<HTMLDivElement>(null)
  const botao = useRef<HTMLButtonElement>(null)
  const id = useId()

  useEffect(() => {
    if (!aberto) return
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setAberto(false)
        botao.current?.focus()
      }
    }
    const aoTocarFora = (e: PointerEvent) => {
      if (e.target instanceof Node && raiz.current !== null && !raiz.current.contains(e.target)) setAberto(false)
    }
    document.addEventListener('keydown', aoTeclar)
    document.addEventListener('pointerdown', aoTocarFora)
    raiz.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus()
    return () => {
      document.removeEventListener('keydown', aoTeclar)
      document.removeEventListener('pointerdown', aoTocarFora)
    }
  }, [aberto])

  return (
    <div ref={raiz} style={{ position: 'relative' }}>
      <button
        ref={botao}
        type="button"
        className={classeDoBotao}
        aria-label={rotulo}
        aria-haspopup="menu"
        aria-expanded={aberto}
        aria-controls={id}
        onClick={() => setAberto((v) => !v)}
      >
        {conteudoDoBotao}
      </button>
      {aberto ? (
        <div className="ii-menu" role="menu" id={id}>
          {opcoes.map((o) => (
            <button
              key={o.rotulo}
              type="button"
              role="menuitem"
              className={o.perigo === true ? 'perigo' : undefined}
              onClick={() => {
                setAberto(false)
                o.aoTocar()
              }}
            >
              {o.rotulo}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

export const ICONE_TRES_PONTOS = (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <circle cx="5" cy="12" r="1.8" />
    <circle cx="12" cy="12" r="1.8" />
    <circle cx="19" cy="12" r="1.8" />
  </svg>
)
