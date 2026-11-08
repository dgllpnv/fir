'use client'

import type { PeriodoDeCampanhasSaida } from '@fir/contracts'
import { formatarDinheiro } from '@fir/ui'

/**
 * As peças das duas telas de campanhas da carteira — a comparativa
 * (`/carteira/campanhas`, `vCampanhas`) e a aba do cliente
 * (`campanhas-do-cliente.tsx`, `cCampanhas`). Só FORMATAÇÃO: todo total,
 * retorno e percentual chega pronto do servidor, já com a supressão aplicada
 * (`suprimirCampanhas`, `@fir/domain`).
 */

export type EscolhaDePeriodo = { chave: PeriodoDeCampanhasSaida['chave']; de: string; ate: string }

export const PERIODO_INICIAL: EscolhaDePeriodo = { chave: '3m', de: '', ate: '' }

/** Os botões do filtro, na ordem do protótipo (`PERIODOS`, L1458). "Ciclo do contrato" só aparece com o início cadastrado. */
const PERIODOS: readonly [EscolhaDePeriodo['chave'], string][] = [
  ['mes', 'Este mês'],
  ['3m', '3 meses'],
  ['6m', '6 meses'],
  ['12m', '12 meses'],
  ['ano', 'Este ano'],
  ['ciclo', 'Ciclo do contrato'],
  ['custom', 'Escolher'],
]

/** A query string do período. "Escolher" sem as duas pontas fica nos 3 meses até a pessoa completar. */
export function consultaDoPeriodo(p: EscolhaDePeriodo): string {
  if (p.chave === 'custom') {
    return p.de !== '' && p.ate !== '' ? `periodo=custom&de=${p.de}&ate=${p.ate}` : 'periodo=3m'
  }
  return `periodo=${p.chave}`
}

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'] as const
const MESES_LONGOS = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
] as const

/** `2026-10-01` → "out de 26" — o `mesNome` do protótipo (L502), sem passar por `Date`. */
export const mesCurto = (mes: string): string =>
  `${MESES[Number(mes.slice(5, 7)) - 1] ?? ''} de ${mes.slice(2, 4)}`

/** `2026-10-01` → "outubro". */
export const mesPorExtenso = (mes: string): string => MESES_LONGOS[Number(mes.slice(5, 7)) - 1] ?? ''

/** "out de 26 a dez de 26", ou só o mês (`rotuloPeriodo`, L1472). */
export const rotuloDoPeriodo = (p: PeriodoDeCampanhasSaida): string =>
  p.de === p.ate ? mesCurto(p.de) : `${mesCurto(p.de)} a ${mesCurto(p.ate)}`

/** Valor de uma célula: "—" quando zero (como `x?brl(x):"—"`, L1987) ou quando apagado pela redação. */
export function valorOuTraco(centavos: string | null): string {
  if (centavos === null || centavos === '0') return '—'
  return formatarDinheiro(BigInt(centavos))
}

export const dinheiro = (centavos: string | null): string =>
  formatarDinheiro(centavos === null ? null : BigInt(centavos))

/** A legenda do retorno: "R$ X investidos", "sem investimento lançado" ou nada quando o valor foi apagado. */
export function legendaDoInvestimento(investimento: string | null, sufixo = 'investidos'): string {
  if (investimento === null) return ''
  if (investimento === '0') return 'sem investimento lançado'
  return `${dinheiro(investimento)} ${sufixo}`
}

export function FiltroDePeriodo({
  escolha,
  periodo,
  comCiclo,
  aoMudar,
}: {
  escolha: EscolhaDePeriodo
  periodo: PeriodoDeCampanhasSaida | null
  comCiclo: boolean
  aoMudar: (e: EscolhaDePeriodo) => void
}) {
  return (
    <div className="camp-filtro">
      <div className="chips" role="group" aria-label="Período">
        {PERIODOS.filter(([k]) => k !== 'ciclo' || comCiclo).map(([chave, rotulo]) => (
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
        <div className="camp-filtro-meses">
          <label className="campo">
            De
            <input type="month" value={escolha.de} onChange={(e) => aoMudar({ ...escolha, de: e.target.value })} />
          </label>
          <label className="campo">
            até
            <input type="month" value={escolha.ate} onChange={(e) => aoMudar({ ...escolha, ate: e.target.value })} />
          </label>
        </div>
      ) : null}
      {periodo !== null ? <span className="nota num">{rotuloDoPeriodo(periodo)}</span> : null}
    </div>
  )
}

/** O aviso de supressão — LGPD A21/A22: o total é das campanhas exibidas, e o porquê. */
export function AvisoDeSupressao({ quantidade }: { quantidade: number }) {
  if (quantidade === 0) return null
  return (
    <p className="camp-aviso">
      {quantidade === 1
        ? '1 campanha teve menos de 5 pagamentos no mês e aparece sem valor'
        : `${quantidade} campanhas tiveram menos de 5 pagamentos no mês e aparecem sem valor`}
      , para proteger os pacientes. Os totais somam só as campanhas exibidas.
    </p>
  )
}

/** "Agendamentos" → "agendamentos", mas "Receita gerada (R$)" não vira "(r$)": só a primeira letra desce. */
export const rotuloEmMinuscula = (r: string): string => (r === '' ? r : r[0]!.toLowerCase() + r.slice(1))
