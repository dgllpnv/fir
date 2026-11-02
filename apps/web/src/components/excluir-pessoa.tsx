'use client'

import { comoChamar } from '@fir/domain'
import { useState } from 'react'
import { ErroDaApi, chamar } from '@/lib/api'
import { Modal } from './modal'

/**
 * **A confirmação de EXCLUIR uma pessoa — e ela DIZ O QUE ACONTECE.**
 *
 * Um "tem certeza?" vazio não informa nada: quem já decidiu aperta, e quem não
 * entendeu continua sem entender. O que a pessoa precisa saber, antes, são as
 * duas metades do soft delete, e elas puxam em direções opostas:
 *
 *  - **o que ela perde**: o acesso, na hora, com as sessões abertas caindo;
 *  - **o que FICA**: o histórico. Tarefa, recebimento, movimento de estoque e
 *    trilha continuam com o nome dela. É a razão de "excluir" aqui não ser
 *    `DELETE` (regra 20) — apagar mudaria o passado da clínica.
 *
 * Quem não sabe da segunda metade hesita por medo de "perder os dados", e aí o
 * caminho real passa a ser deixar quinze inativas na lista.
 *
 * ## Um modal, e não dois toques num botão
 *
 * O padrão de dois toques existe nesta tela para **redefinir senha**, que é
 * reversível (gera outra). Excluir é o único lugar que tira alguém da equipe,
 * e o modal faz três coisas que o segundo toque não faz: prende o foco, diz o
 * que acontece sem competir com a lista atrás, e **não fecha ao clique fora**.
 *
 * ## Uma caixa, dois lugares
 *
 * `caminho` é a única diferença entre a clínica (`v1/pessoas/:id`) e o painel
 * (`v1/superadmin/clinicas/:c/pessoas/:id`). Duas caixas seriam dois textos, e
 * o segundo é o que esqueceria de dizer que o histórico fica.
 */
export function ExcluirPessoa({
  nome,
  usuario,
  caminho,
  aoFechar,
  aoExcluir,
}: {
  nome: string
  usuario: string
  /** A rota `DELETE`, sem barra inicial. A única diferença entre os dois lugares. */
  caminho: string
  aoFechar: () => void
  aoExcluir: () => void
}) {
  const [erro, setErro] = useState('')
  const [ocupado, setOcupado] = useState(false)

  async function excluir() {
    setErro('')
    setOcupado(true)
    try {
      await chamar(caminho, { method: 'DELETE' })
      aoExcluir()
    } catch (e) {
      /**
       * A MENSAGEM DO SERVIDOR INTEIRA, e isto é o pedido explícito: *se a
       * recusa vier do domínio, mostre a razão*.
       *
       * O 422 dele já traz a saída ("dê acesso de administrador a outra pessoa
       * antes de excluir esta"), e reescrevê-la aqui criaria a segunda versão
       * da regra — a que divergiria no dia em que a primeira mudasse.
       */
      setErro(e instanceof ErroDaApi ? e.message : 'Não consegui excluir.')
    } finally {
      setOcupado(false)
    }
  }

  return (
    <Modal titulo={`Excluir ${comoChamar(nome)} da equipe?`} aoFechar={aoFechar}>
      <p className="nota">
        <b>{nome}</b> (<span className="num">{usuario}</span>) sai da lista e{' '}
        <b>perde o acesso imediatamente</b> — as sessões abertas dela caem no instante em que você
        confirmar.
      </p>
      <p className="nota">
        <b>O histórico dela continua.</b> As tarefas, os recebimentos, as movimentações de estoque e
        a trilha de auditoria seguem com o nome dela — nada do passado da clínica muda. Ela só não
        aparece mais em lista nenhuma, e não entra.
      </p>
      <p className="nota">
        Se ela só vai se afastar por um tempo, <b>desative</b> em vez de excluir: quem está inativa
        continua na lista, e voltar é um toque.
      </p>

      <p className="nota aviso-do-modal erro" role="alert" aria-live="polite">
        {erro}
      </p>

      <div className="botoes">
        <button type="button" className="btn" onClick={() => void excluir()} disabled={ocupado}>
          {ocupado ? 'Excluindo…' : `Excluir ${comoChamar(nome)}`}
        </button>
        <button type="button" className="btn ghost" onClick={aoFechar} disabled={ocupado}>
          Não excluir
        </button>
      </div>
    </Modal>
  )
}
