'use client'

import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { pedirTelaCheia } from './reuniao-na-tela'

const CAMINHO_DA_REUNIAO = '/indicadores/reuniao'

/**
 * **"Modo reunião" abre em tela cheia, venha de qual aba vier** (1.9 F; spec
 * I-43). Um ponto só, no layout de `/indicadores`: qualquer link para a
 * reunião dentro da seção — o da aba OKRs e KPIs, o da aba Relatórios, o que
 * vier depois — pede a tela cheia no próprio clique.
 *
 * Nasceu de um defeito medido: a aba Relatórios tinha um `<a>` comum, sem o
 * pedido, e a reunião aberta por ela não entrava em tela cheia — ao contrário
 * da aberta por OKRs e KPIs. Escrever o pedido em cada botão é o caminho pelo
 * qual o terceiro botão esquece de novo.
 *
 * O navegador só concede a tela cheia num gesto, e um `<a>` comum recarregaria
 * a página e a perderia: o link comum é levado pelo `router` (navegação do
 * cliente, que a preserva). O `Link` do Next já navega assim — dele, só o
 * pedido. Clique com Ctrl/Cmd/Shift/Alt ou com o botão do meio abre outra aba,
 * e passa intocado (`pedirTelaCheia` devolve `false`).
 */
export function TelaCheiaDaReuniao() {
  const router = useRouter()
  useEffect(() => {
    // Na fase de borbulha, depois do React: assim o `defaultPrevented` diz se o `Link` já navegou.
    const aoClicar = (e: MouseEvent) => {
      const alvo = e.target
      if (!(alvo instanceof Element)) return
      const link = alvo.closest('a[href]')
      if (!(link instanceof HTMLAnchorElement) || link.getAttribute('href') !== CAMINHO_DA_REUNIAO) return
      const outraAba = e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey
      if (outraAba) return
      pedirTelaCheia(e, document.documentElement, document.fullscreenElement)
      if (!e.defaultPrevented) {
        e.preventDefault()
        router.push(CAMINHO_DA_REUNIAO)
      }
    }
    document.addEventListener('click', aoClicar)
    return () => document.removeEventListener('click', aoClicar)
  }, [router])
  return null
}
