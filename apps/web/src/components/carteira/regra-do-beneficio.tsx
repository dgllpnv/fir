'use client'

import type { RegraDoBeneficioSaida } from '@fir/contracts'
import { type FormEvent, useEffect, useState } from 'react'
import { chamar, ErroDaApi } from '@/lib/api'
import { centavosDoTexto } from '@/lib/dinheiro-digitado'

/**
 * **"Alterar regra"** do benefício por indicação (T5, L12; protótipo L2542,
 * `editBenef` L2956). G8 3D.
 *
 * Só aparece para quem o servidor diz que pode (`podeAlterar`: escopo geral e
 * `carteira.administrar`); o servidor confere de novo. O protótipo guarda um
 * texto livre; aqui é o percentual (ADR 0015 achado 5), e a conversão de um
 * lead fotografa o valor vigente — mudar a regra não mexe em benefício já
 * gerado (gate de números, ajuste 9). Digitado em pontos ("10" ou "12,5"),
 * gravado em centésimos.
 */
export function AlterarRegraDoBeneficio({ aoMudar }: { aoMudar: (recado: string) => void }) {
  const [regra, setRegra] = useState<RegraDoBeneficioSaida | null>(null)
  const [editando, setEditando] = useState(false)
  const [texto, setTexto] = useState('')
  const [erro, setErro] = useState('')

  useEffect(() => {
    let valeu = true
    chamar<RegraDoBeneficioSaida>('v1/carteira/beneficios/regra')
      .then((r) => valeu && setRegra(r))
      .catch(() => undefined)
    return () => {
      valeu = false
    }
  }, [])

  if (regra === null || !regra.podeAlterar) return null
  if (!editando) {
    return (
      <button type="button" className="link" onClick={() => setEditando(true)}>
        Alterar regra
      </button>
    )
  }
  const salvar = async (e: FormEvent) => {
    e.preventDefault()
    const centesimos = centavosDoTexto(texto.trim())
    if (centesimos === null || centesimos < 1n || centesimos > 10000n) {
      setErro('Informe um desconto entre 0,01% e 100%.')
      return
    }
    try {
      const r = await chamar<RegraDoBeneficioSaida>('v1/carteira/beneficios/regra', {
        method: 'PUT',
        body: JSON.stringify({ percentualCentesimos: centesimos.toString() }),
      })
      setRegra(r)
      setEditando(false)
      setErro('')
      aoMudar('Regra do benefício alterada. Vale para as próximas indicações que virarem cliente.')
    } catch (x) {
      setErro(x instanceof ErroDaApi ? x.message : 'Sem conexão com o servidor.')
    }
  }
  return (
    <form className="bib-regra" onSubmit={salvar} aria-label="Regra do benefício de indicação">
      <label className="campo">
        Desconto na mensalidade seguinte (%)
        <input value={texto} onChange={(e) => setTexto(e.target.value)} inputMode="decimal" placeholder="10" required autoFocus />
        <small>Aparece na mensagem de agradecimento e nos próximos benefícios gerados.</small>
      </label>
      <p className="erro" role="alert" aria-live="polite">
        {erro}
      </p>
      <span className="bib-espaco-botoes">
        <button type="button" className="btn ghost" onClick={() => setEditando(false)}>
          Cancelar
        </button>
        <button type="submit" className="btn">
          Salvar regra
        </button>
      </span>
    </form>
  )
}
