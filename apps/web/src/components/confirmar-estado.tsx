'use client'

import { type ReactNode, useState } from 'react'
import { ErroDaApi } from '@/lib/api'
import { Modal } from '@/components/modal'

/**
 * **CONFIRMAR "DESATIVAR" / "REATIVAR"** — o modal da casa, com a pergunta dita
 * em voz alta antes do toque.
 *
 * Desativar é um ESTADO, nunca uma exclusão (regra 20): nada é apagado e a
 * mesma tela devolve o item. Por isso a frase do corpo diz o que muda e o que
 * NÃO muda — a dona do produto leu "excluir" onde o sistema só tinha uma caixa
 * escondida dentro de "Editar".
 *
 * O caller entrega `aoConfirmar` (a chamada à API, que lança em erro) e esta
 * peça cuida do "enviando", da mensagem de erro em português do servidor e do
 * foco do modal. Sem `window.confirm`: ele não prende o foco nem tem tema.
 */
export function ConfirmarEstado({
  titulo,
  rotuloConfirmar,
  rotuloEnviando,
  aoConfirmar,
  aoFechar,
  children,
}: {
  titulo: string
  rotuloConfirmar: string
  rotuloEnviando: string
  aoConfirmar: () => Promise<void>
  aoFechar: () => void
  children: ReactNode
}) {
  const [erro, setErro] = useState('')
  const [enviando, setEnviando] = useState(false)

  async function confirmar() {
    setErro('')
    setEnviando(true)
    try {
      await aoConfirmar()
    } catch (x) {
      setErro(x instanceof ErroDaApi ? x.message : 'Sem conexão com o servidor.')
      setEnviando(false)
    }
  }

  return (
    <Modal titulo={titulo} aoFechar={aoFechar}>
      <div className="confirmar-estado">{children}</div>
      <p role="alert" aria-live="polite" className="erro-do-painel">
        {erro}
      </p>
      <div className="botoes">
        <button type="button" className="btn" onClick={() => void confirmar()} disabled={enviando}>
          {enviando ? rotuloEnviando : rotuloConfirmar}
        </button>
        <button type="button" className="btn ghost" onClick={aoFechar} disabled={enviando}>
          Cancelar
        </button>
      </div>
    </Modal>
  )
}

/** Plural simples: `1 clínica`, `3 clínicas`. */
export const contar = (n: number, um: string, varios: string): string =>
  `${n} ${n === 1 ? um : varios}`
