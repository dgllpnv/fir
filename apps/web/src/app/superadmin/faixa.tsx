'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { chamar } from '@/lib/api'
import { ICONE_SAIR } from '@/lib/icones'
import { usePainel } from './contexto'

/**
 * A FAIXA DO PAINEL — o sinal, e ele é permanente.
 *
 * Ela responde duas perguntas, nesta ordem, em toda tela de operação e sem
 * rolar: **onde você está** e **em qual clínica você age**.
 *
 * ## Por que uma faixa, e por que dourada cheia
 *
 * O painel era feio de propósito para não se confundir com o sistema da
 * clínica. Feiura não é controle: ela diz "isto está pela metade", não "você
 * está no painel, agindo na Dra Suzana Lima". O sinal certo é desenho — e o
 * desenho que o produto **nunca** usa é dourado preenchido em largura cheia
 * (lá o dourado cheio é um item de menu e um chip). Ver o cabeçalho de
 * `packages/ui/src/superadmin.css` para as três razões, inclusive a que decide
 * entre temas: `--gold` e `--on-gold` têm o mesmo valor no claro e no escuro,
 * então a faixa é a mesma nos dois e o sinal não enfraquece em nenhum.
 *
 * ## O que ela nunca faz
 *
 * **Nunca nomeia uma clínica que não foi resolvida.** Enquanto a lista não
 * chega, ou se o id do endereço não está nela, a faixa diz
 * "clínica não identificada" em vermelho — e a tela de pessoas, vendo o mesmo
 * estado, esconde o formulário. Uma faixa que mostrasse a clínica anterior
 * seria pior que faixa nenhuma: ela daria confiança a uma afirmação falsa.
 */
export function FaixaDoPainel() {
  const { sessao, clinicaAberta } = usePainel()
  const router = useRouter()
  const [saindo, setSaindo] = useState(false)

  async function sair() {
    setSaindo(true)
    // `catch` vazio, como no produto: se a chamada falhar, o cookie pode ter
    // morrido do outro lado assim mesmo, e prender o operador numa tela que
    // diz "não consegui sair" é pior que mandá-lo para a porta — onde o
    // servidor decide de novo se ele está dentro ou fora.
    await chamar('v1/superadmin/sair', { method: 'POST' }).catch(() => undefined)
    router.replace('/superadmin/entrar')
    router.refresh()
  }

  return (
    <header className="superadmin-faixa">
      <div className="faixa-barra">
        {/* A ordem é deliberada: o LUGAR antes da marca. Quem abriu por engano
            lê "painel interno" primeiro, não "Firmare". */}
        <div className="aqui">
          Painel interno
          <small>Firmare · Gestão de Rotina</small>
        </div>

        <p className="onde">{ondeEstou(clinicaAberta)}</p>

        {sessao.tag === 'pronta' ? (
          <div className="faixa-quem">
            <span title={sessao.operador.usuario}>{sessao.operador.usuario}</span>
            <button
              type="button"
              className="botao-faixa"
              onClick={() => void sair()}
              disabled={saindo}
            >
              {ICONE_SAIR}
              {saindo ? 'Saindo…' : 'Sair'}
            </button>
          </div>
        ) : null}
      </div>
    </header>
  )
}

/**
 * A frase da clínica, nas quatro situações — e **cada uma diz a verdade do
 * estado**, inclusive a que admite não saber.
 */
function ondeEstou(c: ReturnType<typeof usePainel>['clinicaAberta']) {
  if (c === 'nenhuma') {
    return (
      <>
        <span>Nenhuma clínica aberta</span>
        <b className="nome">você está na lista do painel</b>
      </>
    )
  }
  if (c === 'desconhecida') {
    return (
      <>
        <span>Agindo na clínica</span>
        <b className="faixa-alerta">não identificada</b>
      </>
    )
  }
  return (
    <>
      <span>Agindo na clínica</span>
      <b>
        {c.codigo} <span className="nome">·</span> <span className="nome">{c.nome}</span>
      </b>
      {c.ativa ? null : <span className="faixa-alerta">desativada</span>}
    </>
  )
}
