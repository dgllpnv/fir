'use client'

import { useEffect, useRef, useState } from 'react'
import { ICONE_TEMA } from '@/lib/icones'
import { ROTULO_DO_TEMA, TEMAS, type Tema, aplicarTema, temaGuardado } from '@/lib/tema'

/**
 * O tema (Claro · Escuro · Sistema) como botão-ícone com lista, junto de quem
 * entrou — no rodapé da lateral (computador) e na barra de topo (celular).
 *
 * Saiu do rodapé em três linhas porque a cliente pediu uma lateral só com
 * títulos, e o seletor era a linha de maior altura que não era navegação. O
 * que não muda: é preferência PESSOAL e por aparelho (não exige `config`),
 * persiste em `fir.tema`, e os três estados continuam existindo.
 *
 * Padrão disclosure, o mesmo dos grupos do menu: botão com `aria-expanded` e
 * `aria-controls`, lista de botões com `aria-pressed`. Esc fecha e devolve o
 * foco ao botão; toque e clique fora também fecham.
 *
 * O estado nasce vazio e é lido no efeito: o servidor não conhece o
 * `localStorage` do aparelho, e um palpite faria o React trocar o botão
 * marcado logo após hidratar.
 */
export function SeletorDeTema({ id, lugar }: { id: string; lugar: 'rodape' | 'topo' }) {
  const [tema, setTema] = useState<Tema | null>(null)
  const [aberto, setAberto] = useState(false)
  const raiz = useRef<HTMLDivElement>(null)
  const botao = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    setTema(temaGuardado())
  }, [])

  useEffect(() => {
    if (!aberto) return
    const fora = (e: PointerEvent) => {
      if (!raiz.current?.contains(e.target as Node)) setAberto(false)
    }
    const tecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setAberto(false)
        botao.current?.focus()
      }
    }
    document.addEventListener('pointerdown', fora)
    document.addEventListener('keydown', tecla)
    return () => {
      document.removeEventListener('pointerdown', fora)
      document.removeEventListener('keydown', tecla)
    }
  }, [aberto])

  return (
    <div
      className="tema-menu"
      data-lugar={lugar}
      ref={raiz}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setAberto(false)
      }}
    >
      <button
        type="button"
        className="tema-botao"
        ref={botao}
        aria-label={`Tema da tela${tema ? `: ${ROTULO_DO_TEMA[tema]}` : ''}`}
        aria-expanded={aberto}
        aria-controls={id}
        onClick={() => setAberto((v) => !v)}
      >
        {ICONE_TEMA}
      </button>
      {aberto ? (
        <div className="tema-lista" id={id} role="group" aria-label="Tema da tela">
          {TEMAS.map((t) => (
            <button
              key={t}
              type="button"
              aria-pressed={tema === t}
              onClick={() => {
                aplicarTema(t)
                setTema(t)
                setAberto(false)
                botao.current?.focus()
              }}
            >
              {ROTULO_DO_TEMA[t]}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
