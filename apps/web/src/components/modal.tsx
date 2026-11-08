'use client'

import { useEffect, useId, useRef, type ReactNode } from 'react'
import { precisaPrender, proximoFoco, SELETOR_FOCAVEL } from '@/lib/foco'

/**
 * **O MODAL DA CASA — um só, e ele é acessível de verdade.**
 *
 * Existe por uma razão de produto, não de arquitetura: há informação que
 * **aparece uma única vez** e não se recupera — a senha provisória. No topo da
 * tela ela compete com o resto da página, sai de vista ao rolar, e a pessoa
 * fecha sem copiar; o caminho então é redefinir de novo, gastando outra. Um
 * modal **obriga a fechar de propósito**, que é o comportamento certo para
 * aquilo que não volta.
 *
 * ## As cinco coisas que ele faz, e por que cada uma
 *
 *  1. **`role="dialog"` + `aria-modal` + rótulo.** Sem o rótulo, o leitor de
 *     tela anuncia "diálogo" e nada mais; sem `aria-modal`, ele continua
 *     lendo a página de trás como se ela estivesse disponível.
 *  2. **O foco entra.** No primeiro elemento focável, não no contêiner: o
 *     anel de foco precisa cair sobre algo que a pessoa possa acionar. É a
 *     mesma escolha da gaveta do `Shell`.
 *  3. **O foco fica preso** (`lib/foco.ts`, com teste próprio). Um modal que
 *     não prende o foco é um modal só para quem usa mouse: com Tab, o foco
 *     sai pela borda e vai para o conteúdo atrás do véu — que a pessoa não vê
 *     e pode acionar sem perceber.
 *  4. **Esc fecha**, e o foco **volta para o elemento que o abriu**. Sem a
 *     volta, o Tab seguinte recomeça do topo da página, e quem navega por
 *     teclado perde o lugar.
 *  5. **Clicar fora NÃO fecha**, e isto é deliberado — é a razão de o modal
 *     existir. O balcão interrompe: um toque errado no véu, com a senha
 *     provisória na tela, custa uma redefinição. Fechar é um ato, e tem botão.
 *
 * ## O que ele NÃO faz
 *
 * Não trava a rolagem do corpo. Em 390 px o conteúdo do modal pode passar da
 * altura da tela (a senha provisória passa), e o que precisa rolar é **ele**,
 * não a página — `overflow-y` na caixa, e nenhum `position: fixed` no `body`,
 * que é o truque que faz a página pular para o topo ao fechar.
 */
export function Modal({
  titulo,
  aoFechar,
  children,
  classe,
}: {
  /** O rótulo acessível **e** o título visível. Um texto, não dois. */
  titulo: string
  aoFechar: () => void
  children: ReactNode
  /** Classe a mais na caixa: um modificador de tamanho (o modal largo do painel). */
  classe?: string
}) {
  const caixa = useRef<HTMLDivElement>(null)
  const idDoTitulo = useId()

  useEffect(() => {
    const alvo = caixa.current
    if (alvo === null) return

    /**
     * QUEM ABRIU, para devolver o foco a ele.
     *
     * Lido no mount: é o elemento que estava focado no instante em que a ação
     * aconteceu, isto é, o botão que a pessoa apertou. Guardar uma `ref`
     * passada de fora seria a mesma coisa com mais cerimônia — e cada chamador
     * teria de lembrar de passá-la.
     */
    const quemAbriu = document.activeElement
    const focaveis = (): HTMLElement[] =>
      [...alvo.querySelectorAll<HTMLElement>(SELETOR_FOCAVEL)].filter(
        (e) => e.offsetParent !== null || e === document.activeElement,
      )

    focaveis()[0]?.focus()

    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        aoFechar()
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
      // `instanceof HTMLElement` e não um `as`: o elemento pode ter saído do
      // documento enquanto o modal estava aberto, e aí não há a que voltar.
      if (quemAbriu instanceof HTMLElement && quemAbriu.isConnected) quemAbriu.focus()
    }
  }, [aoFechar])

  return (
    /*
      O véu NÃO tem `onClick` e NÃO é um `<button>`: ver o item 5 do cabeçalho.
      Um véu acionável promete um fechamento que não existe, e um véu que
      anuncia "botão" o promete também a quem usa leitor de tela.

      E **nada de `aria-hidden` aqui**: ele é o ANCESTRAL do diálogo, e
      `aria-hidden` num ancestral esconde o filho — o modal inteiro
      desapareceria da árvore de acessibilidade, que é o oposto do que
      `aria-modal` existe para fazer. É um `<div>` sem papel nenhum, e é isso
      que ele é: pintura.
    */
    <div className="veu-de-modal">
      <div
        className={classe === undefined ? 'modal' : `modal ${classe}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={idDoTitulo}
        ref={caixa}
      >
        <h2 className="modal-titulo" id={idDoTitulo}>
          {titulo}
        </h2>
        {children}
      </div>
    </div>
  )
}
