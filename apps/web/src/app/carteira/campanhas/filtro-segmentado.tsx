'use client'

import type { PeriodoDeCampanhasSaida } from '@fir/contracts'
import { rotuloDoPeriodo, type EscolhaDePeriodo } from '@/components/carteira/campanhas-pecas'

/**
 * O filtro de período do comparativo em `.seg` — botões colados, o ativo em
 * dourado claro, o intervalo ao lado (`filtroPeriodo`, `index.html` L1472).
 * "Ciclo do contrato" não entra: o comparativo não tem um cliente para dar o
 * início do contrato, e o protótipo também o tira daqui (L1964).
 */
const PERIODOS: readonly [EscolhaDePeriodo['chave'], string][] = [
  ['mes', 'Este mês'],
  ['3m', '3 meses'],
  ['6m', '6 meses'],
  ['12m', '12 meses'],
  ['ano', 'Este ano'],
  ['custom', 'Escolher'],
]

export function FiltroSegmentado({
  escolha,
  periodo,
  aoMudar,
}: {
  escolha: EscolhaDePeriodo
  periodo: PeriodoDeCampanhasSaida | null
  aoMudar: (e: EscolhaDePeriodo) => void
}) {
  return (
    <div className="fcamp-filtro">
      <div className="fcamp-seg" role="group" aria-label="Período">
        {PERIODOS.map(([chave, rotulo]) => (
          <button
            key={chave}
            type="button"
            aria-pressed={escolha.chave === chave}
            onClick={() => aoMudar({ ...escolha, chave })}
          >
            {rotulo}
          </button>
        ))}
      </div>
      {escolha.chave === 'custom' ? (
        <span className="fcamp-filtro-meses">
          <label htmlFor="fcamp-de">De</label>
          <input
            id="fcamp-de"
            type="month"
            value={escolha.de}
            onChange={(e) => aoMudar({ ...escolha, de: e.target.value })}
          />
          <label htmlFor="fcamp-ate">até</label>
          <input
            id="fcamp-ate"
            type="month"
            value={escolha.ate}
            onChange={(e) => aoMudar({ ...escolha, ate: e.target.value })}
          />
        </span>
      ) : null}
      {periodo !== null ? <span className="fcamp-intervalo">{rotuloDoPeriodo(periodo)}</span> : null}
    </div>
  )
}
