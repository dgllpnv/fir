'use client'

import { useCallback } from 'react'
import { createRoot } from 'react-dom/client'
import { Modal } from '@/components/modal'
import { chamar } from './api'
import { comConfirmacao, type ContextoDaPergunta, perguntasDosAvisos } from './confirmacao'

/**
 * O diálogo dos avisos de recebimento — **aberto por quem chama, sem estado na
 * tela**.
 *
 * Imperativo de propósito: são seis portas de dinheiro em sete telas, e um
 * `useState` + `<Dialogo>` em cada uma é a sétima tela que esquece de
 * desenhar o diálogo e devolve à recepcionista um "Conflito" vermelho. Aqui a
 * pergunta nasce e morre dentro da chamada; a tela só faz `await`.
 *
 * É o `Modal` da casa (foco preso, Esc cancela, clicar fora não fecha). O
 * primeiro botão — o que recebe o foco — é **Cancelar**: um Enter reflexo com
 * o telefone tocando não pode lançar o dinheiro de novo.
 */
export function perguntarNaTela(
  avisos: readonly string[],
  ctx: ContextoDaPergunta,
): Promise<boolean> {
  return new Promise((resolve) => {
    const no = document.createElement('div')
    document.body.appendChild(no)
    const raiz = createRoot(no)
    let respondido = false
    const responder = (sim: boolean) => {
      if (respondido) return
      respondido = true
      resolve(sim)
      // Desmonta FORA do tratador de evento que o React está despachando.
      setTimeout(() => {
        raiz.unmount()
        no.remove()
      }, 0)
    }
    raiz.render(
      <DialogoDeConfirmacao perguntas={perguntasDosAvisos(avisos, ctx)} aoResponder={responder} />,
    )
  })
}

function DialogoDeConfirmacao({
  perguntas,
  aoResponder,
}: {
  perguntas: readonly string[]
  aoResponder: (sim: boolean) => void
}) {
  const cancelar = useCallback(() => aoResponder(false), [aoResponder])
  return (
    <Modal titulo="Confirme antes de lançar" aoFechar={cancelar}>
      {perguntas.map((p) => (
        <p className="nota" key={p}>
          {p}
        </p>
      ))}
      <div className="botoes">
        <button type="button" className="btn ghost" onClick={cancelar}>
          Cancelar
        </button>
        <button type="button" className="btn" onClick={() => aoResponder(true)}>
          Lançar mesmo assim
        </button>
      </div>
    </Modal>
  )
}

/**
 * `POST` com a confirmação: o MESMO corpo, mais a chave de cada aviso que a
 * pessoa confirmou. É a porta que as telas de dinheiro usam.
 */
export function postarComConfirmacao<T>(
  caminho: string,
  corpo: Readonly<Record<string, unknown>>,
  ctx: ContextoDaPergunta,
): Promise<T> {
  return comConfirmacao(
    (confirmacoes) =>
      chamar<T>(caminho, { method: 'POST', body: JSON.stringify({ ...corpo, ...confirmacoes }) }),
    (avisos) => perguntarNaTela(avisos, ctx),
  )
}
