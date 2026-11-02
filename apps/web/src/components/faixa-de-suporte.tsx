'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { chamar } from '@/lib/api'
import { ICONE_SAIR } from '@/lib/icones'

/**
 * A FAIXA DA SESSÃO DE SUPORTE — o sinal, e ele é permanente (D-13).
 *
 * ## Por que ela existe
 *
 * Uma sessão de suporte **parece** a de uma administradora: menu completo,
 * dinheiro na tela, nome da clínica na lateral. Sem um sinal, quem a usa age
 * achando que é a clínica agindo — e a diferença não é de rótulo: o operador
 * pode estar com duas abas abertas em duas clínicas, e a trilha que ele
 * escreve não é dele, é **da clínica**.
 *
 * ## Por que ela é dourada e cheia, e por que ela é ESTA
 *
 * Ela veste **as mesmas classes da faixa do painel** (`superadmin.css`) —
 * nenhuma regra de CSS é copiada, nenhum componente é duplicado. O vocabulário
 * visual é deliberadamente o do painel, pelas três razões escritas no
 * cabeçalho daquele arquivo, e a terceira é a que importa aqui: **o produto
 * nunca preenche nada de dourado em largura cheia**. Quem já viu o painel
 * reconhece a faixa; quem nunca viu lê a palavra.
 *
 * O que ela diz é o inverso do que o painel diz. Lá a pergunta é *em qual
 * clínica eu estou agindo* (e a clínica é o dado variável). Aqui a clínica
 * está em volta, na lateral e no conteúdo — a pergunta é *quem está agindo*, e
 * a resposta é "o painel, não você".
 *
 * ## O que ela nunca faz
 *
 * **Nunca some.** `position: sticky` vem da folha do painel, e o topo do
 * produto cede o lugar (`.shell[data-suporte='sim'] .topbar`). Uma faixa que
 * rolasse para fora seria um sinal que vale nos primeiros três segundos.
 */
export function FaixaDeSuporte({ operador }: { operador: { nome: string; usuario: string } }) {
  const router = useRouter()
  const [saindo, setSaindo] = useState(false)
  const faixa = useRef<HTMLElement>(null)

  /**
   * A ALTURA DA FAIXA É MEDIDA, não adivinhada.
   *
   * O valor em `tokens.css` existe para o PRIMEIRO pintar; a partir daí quem
   * manda é a régua. A razão é um defeito medido: em 390 px a faixa embrulha
   * em **três** linhas (o rótulo, a afirmação, e quem está dentro) e mede
   * **128 px** — não os 72 px que o token supunha. Com o número fixo, a barra
   * de topo do produto grudava em `top: 72px`, ficava **atrás** do dourado, e
   * o botão "Menu" desaparecia ao rolar. Medido:
   *
   *   faixa  h 128 px        topbar top 72 px → escondida
   *   menu visível: NÃO
   *
   * Qualquer número fixo aqui é um palpite sobre quantas linhas o texto vai
   * ocupar — e ele muda com o nome do operador, com o tamanho de fonte do
   * sistema e com o idioma. `ResizeObserver` resolve a classe, não o caso.
   */
  useEffect(() => {
    const alvo = faixa.current
    if (alvo === null) return
    const raiz = document.documentElement
    const medir = () => {
      raiz.style.setProperty('--h-faixa-de-suporte', `${Math.ceil(alvo.offsetHeight)}px`)
    }
    medir()
    const observador = new ResizeObserver(medir)
    observador.observe(alvo)
    return () => {
      observador.disconnect()
      // Volta ao valor da folha: a faixa saiu, e um valor preso deslocaria a
      // barra de topo de uma sessão que não é de suporte.
      raiz.style.removeProperty('--h-faixa-de-suporte')
    }
  }, [])

  async function encerrar() {
    setSaindo(true)
    // `catch` vazio, como no resto da casa: se a chamada falhar, o cookie pode
    // ter morrido do outro lado assim mesmo, e prender a pessoa numa tela que
    // diz "não consegui sair" é pior que mandá-la para a porta — onde o
    // servidor decide de novo se ela está dentro ou fora.
    await chamar('v1/sair', { method: 'POST' }).catch(() => undefined)
    router.replace('/entrar')
    router.refresh()
  }

  return (
    <header className="superadmin-faixa" ref={faixa}>
      <div className="faixa-barra">
        {/* A ordem é a do painel, e a razão é a mesma: o LUGAR antes da marca.
            Quem bate o olho lê "sessão de suporte" primeiro. */}
        <div className="aqui">
          Sessão de suporte
          <small>Firmare · Painel interno</small>
        </div>

        <p className="onde">
          <span>Agindo pelo painel</span>
          {/* INVERSÃO do par dourado, a mesma do "clínica desativada" no
              painel: é assim que a casa diz "aqui agir é diferente", e não com
              um vermelho — `--bad-on-gold` reprova em AA de texto (4,25:1),
              medido em `contraste.test.ts`. */}
          <b className="faixa-alerta">não é uma pessoa desta clínica</b>
        </p>

        <div className="faixa-quem">
          <span title={operador.usuario}>{operador.nome}</span>
          <button
            type="button"
            className="botao-faixa"
            onClick={() => void encerrar()}
            disabled={saindo}
          >
            {ICONE_SAIR}
            {saindo ? 'Encerrando…' : 'Encerrar'}
          </button>
        </div>
      </div>
    </header>
  )
}
