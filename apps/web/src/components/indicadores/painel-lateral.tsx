'use client'

import { type FormEvent, type ReactNode, useEffect, useId, useRef } from 'react'
import { precisaPrender, proximoFoco, SELETOR_FOCAVEL } from '@/lib/foco'

/**
 * **O painel dos formulários D** (1.9 D): à direita no computador, tela cheia
 * no celular. Rodapé fixo com "Cancelar" à esquerda de "Salvar".
 *
 * As mesmas garantias do `Modal` da casa: `role="dialog"` rotulado, o foco
 * entra e fica preso, Esc fecha e devolve o foco a quem abriu. O véu não
 * fecha ao toque — o balcão interrompe, e um formulário pela metade não se
 * perde por um toque errado.
 *
 * É um `<form>`: Enter num campo salva, como em todo formulário da casa.
 */
export function PainelLateral({
  titulo,
  aoFechar,
  aoSalvar,
  salvando,
  rotuloSalvar = 'Salvar',
  semRodape = false,
  inativo = false,
  children,
}: {
  titulo: string
  aoFechar: () => void
  aoSalvar: () => void
  salvando: boolean
  rotuloSalvar?: string
  /** O primeiro passo do D.1 (a escolha) ainda não tem o que salvar. */
  semRodape?: boolean
  /**
   * Outro painel abriu por cima (o "criar KPI" do D.2): este fica montado,
   * com o que já foi digitado, mas escondido e sem ouvir o teclado — senão o
   * Esc fecharia os dois.
   */
  inativo?: boolean
  children: ReactNode
}) {
  const caixa = useRef<HTMLFormElement>(null)
  const idDoTitulo = useId()
  // O fechar mais recente, sem re-disparar o efeito: o pai re-renderiza a cada
  // tecla, e o efeito que devolve o foco ao primeiro campo não pode rodar de novo.
  const fechar = useRef(aoFechar)
  useEffect(() => {
    fechar.current = aoFechar
  })

  useEffect(() => {
    const alvo = caixa.current
    if (alvo === null || inativo) return
    const quemAbriu = document.activeElement
    const focaveis = (): HTMLElement[] =>
      [...alvo.querySelectorAll<HTMLElement>(SELETOR_FOCAVEL)].filter(
        (e) => e.offsetParent !== null || e === document.activeElement,
      )
    // O primeiro campo do corpo, e não o "Fechar" do cabeçalho: quem abriu um
    // formulário vai digitar.
    const corpo = alvo.querySelector<HTMLElement>('.ii-painel-corpo')
    const primeiro = corpo === null ? null : [...corpo.querySelectorAll<HTMLElement>(SELETOR_FOCAVEL)][0]
    ;(primeiro ?? focaveis()[0])?.focus()

    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        fechar.current()
        return
      }
      if (e.key !== 'Tab') return
      const lista = focaveis()
      if (!precisaPrender(lista, document.activeElement, e.shiftKey)) return
      const destino = proximoFoco(lista, document.activeElement, e.shiftKey)
      if (destino === null) return
      e.preventDefault()
      destino.focus()
    }
    document.addEventListener('keydown', aoTeclar)
    return () => {
      document.removeEventListener('keydown', aoTeclar)
      if (quemAbriu instanceof HTMLElement && quemAbriu.isConnected) quemAbriu.focus()
    }
  }, [inativo])

  const enviar = (e: FormEvent) => {
    e.preventDefault()
    if (!salvando) aoSalvar()
  }

  return (
    <div className="ii-veu" hidden={inativo}>
      <form
        className="ii-painel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={idDoTitulo}
        ref={caixa}
        onSubmit={enviar}
        noValidate
      >
        <div className="ii-painel-cabeca">
          <h2 id={idDoTitulo}>{titulo}</h2>
          <button type="button" className="ii-fechar" aria-label="Fechar" onClick={aoFechar}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>
        <div className="ii-painel-corpo">{children}</div>
        {semRodape ? (
          <div />
        ) : (
          <div className="ii-painel-rodape">
            <button type="button" className="link" onClick={aoFechar}>
              Cancelar
            </button>
            <button type="submit" className="btn" disabled={salvando}>
              {salvando ? 'Salvando…' : rotuloSalvar}
            </button>
          </div>
        )}
      </form>
    </div>
  )
}

/** O erro logo abaixo do campo, em vermelho — nunca só num aviso flutuante (1.9 D). */
export function ErroDoCampo({ id, mensagem }: { id: string; mensagem: string | null | undefined }) {
  if (mensagem === null || mensagem === undefined) return null
  return (
    <span className="erro" id={id} role="alert">
      {mensagem}
    </span>
  )
}
