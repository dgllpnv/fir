'use client'

import { type ReactNode, useEffect, useId, useState } from 'react'

/**
 * O ícone de dica (`docs/design.md` §4): explicação longa não vira parágrafo
 * na tela, vira um "i" ao lado do título que abre o texto.
 *
 * **Toque, não passar o mouse.** A recepção usa o celular; `:hover` não existe
 * no dedo. O botão abre e fecha, Esc fecha, e o texto aparece NO FLUXO, logo
 * abaixo do título — não num balão posicionado por cima, que em 390 px sai
 * pela lateral e cria a rolagem horizontal que nenhuma tela pode ter.
 *
 * Número nunca mora aqui: ninguém abre uma dica para ler um valor.
 */
export function Dica({
  rotulo,
  titulo,
  children,
}: {
  /** O nome acessível do botão, ex.: "Como funciona a agenda do sistema". */
  rotulo: string
  /** O que fica ao lado do ícone — normalmente o `<h2>` da tela. */
  titulo: ReactNode
  children: ReactNode
}) {
  const [aberta, setAberta] = useState(false)
  const id = useId()

  useEffect(() => {
    if (!aberta) return
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAberta(false)
    }
    document.addEventListener('keydown', aoTeclar)
    return () => document.removeEventListener('keydown', aoTeclar)
  }, [aberta])

  return (
    <div className="dica">
      <div className="dica-cabeca">
        {titulo}
        <button
          type="button"
          className="dica-botao"
          aria-label={rotulo}
          title={rotulo}
          aria-expanded={aberta}
          aria-controls={id}
          onClick={() => setAberta((v) => !v)}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 11v6" />
            <circle cx="12" cy="7.6" r="1.1" fill="currentColor" stroke="none" />
          </svg>
        </button>
      </div>
      {aberta ? (
        <div className="dica-texto" id={id} role="note">
          {children}
          <button type="button" className="link" onClick={() => setAberta(false)}>
            Fechar
          </button>
        </div>
      ) : null}
    </div>
  )
}
