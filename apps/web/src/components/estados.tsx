'use client'

import type { ReactNode } from 'react'

/**
 * Carregando, erro e vazio — os três estados que `docs/design.md` exige em
 * todo ticket de tela.
 *
 * O esqueleto reserva a MESMA altura do conteúdo: quando os dados chegam,
 * nada pula embaixo do dedo que já estava indo no botão.
 */
export function Carregando({ linhas = 3, fino = false }: { linhas?: number; fino?: boolean }) {
  return (
    <div className="esqueleto" aria-busy="true" aria-live="polite">
      <span className="sr-apenas">Carregando…</span>
      {Array.from({ length: linhas }, (_, i) => (
        <span key={i} className={fino ? 'fino' : undefined} aria-hidden="true" />
      ))}
    </div>
  )
}

/**
 * O erro diz o que aconteceu e DÁ SAÍDA: recarregar, e voltar para Hoje.
 *
 * Uma tela de erro sem saída deixa a recepção com o telefone na mão e o
 * aplicativo parado — e o caminho que ela encontra sozinha é fechar tudo.
 */
export function Erro({ mensagem, recarregar }: { mensagem: string; recarregar: () => void }) {
  return (
    <div className="erro-de-tela" role="alert">
      <p>{mensagem}</p>
      <div className="botoes">
        <button type="button" className="btn" onClick={recarregar}>
          Tentar de novo
        </button>
        <a className="btn ghost" href="/hoje">
          Ir para Hoje
        </a>
      </div>
    </div>
  )
}

/** O vazio é a primeira tela que toda clínica nova vê. Ele diz o que fazer. */
export function Vazio({ children }: { children: ReactNode }) {
  return <div className="vazio">{children}</div>
}
