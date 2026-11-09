'use client'

import type { ResumoSemanalSaida } from '@fir/contracts'
import { useEffect, useState } from 'react'
import { Carregando, Toast } from '@/components/estados'
import { chamar, ErroDaApi } from '@/lib/api'
import { useCarteira } from '../contexto'
import { ErroDaCarteira } from '../pecas'

/**
 * **RESUMO SEMANAL** (`vResumo`, protótipo L2021-2025; G8 3C, S1).
 *
 * "Gerado pela ferramenta · Resumo semanal · Pronto para colar no WhatsApp da
 * equipe ou enviar para a liderança", e o botão "Copiar texto". O texto vem
 * PRONTO do servidor, já sem valores para quem não tem `valores` — a tela
 * não monta, não calcula e não esconde nada (CLAUDE.md §5, regra 17).
 *
 * Interno da Firmare: só `escopo = 'geral'` com o módulo `resumo` (A-5). Quem
 * não pode recebe 403 do servidor e vê "Sem acesso a esta tela".
 */

type Estado =
  | { tag: 'carregando' }
  | { tag: 'sem-acesso' }
  | { tag: 'erro'; mensagem: string }
  | { tag: 'pronto'; resumo: ResumoSemanalSaida }

export default function ResumoSemanal() {
  const { sessao } = useCarteira()
  const pronta = sessao.tag === 'pronta'
  const [estado, setEstado] = useState<Estado>({ tag: 'carregando' })
  const [tentativa, setTentativa] = useState(0)
  const [recado, setRecado] = useState<string | null>(null)

  useEffect(() => {
    if (!pronta) return
    let valeu = true
    chamar<ResumoSemanalSaida>('v1/carteira/resumo/semanal')
      .then((resumo) => {
        if (valeu) setEstado({ tag: 'pronto', resumo })
      })
      .catch((e: unknown) => {
        if (!valeu) return
        if (e instanceof ErroDaApi && e.status === 403) setEstado({ tag: 'sem-acesso' })
        else setEstado({ tag: 'erro', mensagem: e instanceof ErroDaApi ? e.message : 'Não foi possível montar o resumo.' })
      })
    return () => {
      valeu = false
    }
  }, [pronta, tentativa])

  const copiar = async (texto: string) => {
    try {
      await navigator.clipboard.writeText(texto)
      setRecado('Resumo copiado.')
    } catch {
      setRecado('Não foi possível copiar. Selecione o texto e copie à mão.')
    }
  }

  const cabecalho = (
    <>
      <p className="rot-int-sobretitulo">Gerado pela ferramenta</p>
      <h1 className="titulo">Resumo semanal</h1>
      <p className="nota">Pronto para colar no WhatsApp da equipe ou enviar para a liderança.</p>
    </>
  )

  if (estado.tag === 'carregando' || !pronta) {
    return (
      <section>
        {cabecalho}
        <Carregando linhas={8} />
      </section>
    )
  }
  if (estado.tag === 'sem-acesso') {
    return (
      <section>
        {cabecalho}
        <p className="carteira-erro" role="alert">
          Sem acesso a esta tela. O resumo semanal é da gestão da Firmare.
        </p>
      </section>
    )
  }
  if (estado.tag === 'erro') {
    return (
      <section>
        {cabecalho}
        <ErroDaCarteira mensagem={estado.mensagem} recarregar={() => setTentativa((n) => n + 1)} />
      </section>
    )
  }

  const { resumo } = estado
  return (
    <section>
      {cabecalho}
      <div className="msg-acoes">
        <button type="button" className="btn" onClick={() => void copiar(resumo.texto)}>
          Copiar texto
        </button>
        {resumo.comValores ? null : <span className="nota">Sem os valores: seu acesso não inclui receita.</span>}
      </div>
      <div className="msg-caixa" aria-label="Texto do resumo semanal">
        {resumo.texto}
      </div>
      <Toast recado={recado} aoFechar={() => setRecado(null)} />
    </section>
  )
}
