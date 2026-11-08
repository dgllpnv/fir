import type { DiaDaSerieDeUsoSaida, SaudeDeUsoSaida } from '@fir/contracts'

/**
 * Peças da tela FIR Clinic e da aba de uso da ficha (G8 1D). SÓ FORMATAM: todo
 * número — percentual, delta, décimos, situação — chega pronto do servidor
 * (`@fir/domain`, `uso-carteira.ts`). Nenhum `style` inline; tudo em
 * `packages/ui/src/carteira.css`, classes `uso-*`.
 */

/** `pctTxt` do protótipo (L1584): `null` é "—", nunca "0%". */
export const pctTexto = (v: number | null): string => (v === null ? '—' : `${v}%`)

/** Décimos inteiros para "3,5" — formatação, sem ponto flutuante. */
export const decimosTexto = (v: number | null): string => {
  if (v === null) return '—'
  const abs = Math.abs(v)
  return `${v < 0 ? '−' : ''}${Math.trunc(abs / 10)},${abs % 10}`
}

/**
 * `deltaTxt` do protótipo (L1585): "igual" quando zero, sinal explícito, verde
 * quando melhora (vermelho quando `menorEMelhor` e sobe). O delta já vem
 * calculado — é a diferença dos valores exibidos (ajuste 33).
 */
export function UsoDelta({
  valor,
  menorEMelhor = false,
  decimos = false,
}: {
  valor: number | null
  menorEMelhor?: boolean
  decimos?: boolean
}) {
  if (valor === null) return null
  if (valor === 0) return <span className="uso-delta muted">igual</span>
  const bom = menorEMelhor ? valor < 0 : valor > 0
  const texto = decimos ? decimosTexto(Math.abs(valor)) : String(Math.abs(valor))
  return (
    <span className={`uso-delta ${bom ? 'uso-delta-bom' : 'uso-delta-mau'}`}>
      {valor > 0 ? '+' : '−'}
      {texto}
    </span>
  )
}

const PILULA: Record<NonNullable<SaudeDeUsoSaida['situacao']>, string> = {
  bom: 'pill bom',
  atencao: 'pill alerta',
  critico: 'pill mau',
}

export function UsoSituacao({ saude }: { saude: SaudeDeUsoSaida }) {
  if (saude.situacao === null) return <span className="muted">{saude.rotulo.toLowerCase()}</span>
  return <span className={PILULA[saude.situacao]}>{saude.rotulo}</span>
}

/**
 * `sparkUso` do protótipo (L1586): uma barra por dia, tarefas concluídas,
 * últimos 30 dias. Barra dourada com conclusão, traço com zero, e o dia SEM
 * DADO (o job não gravou) fica vazio — "sem dado" não é "zero" (ajuste 31).
 * Só tarefas, nunca pessoas (A16).
 */
export function UsoSpark({ serie, grande = false }: { serie: readonly DiaDaSerieDeUsoSaida[]; grande?: boolean }) {
  if (serie.length === 0) return null
  const L = 260
  const A = 40
  const maximo = Math.max(1, ...serie.map((d) => d.tarefasConcluidas ?? 0))
  const largura = L / serie.length
  const comConclusao = serie.reduce((n, d) => n + ((d.tarefasConcluidas ?? 0) > 0 ? 1 : 0), 0)
  return (
    <svg
      className={grande ? 'uso-spark uso-spark-grande' : 'uso-spark'}
      viewBox={`0 0 ${L} ${A}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={`Tarefas concluídas por dia nos últimos ${serie.length} dias: ${comConclusao} dias com conclusão.`}
    >
      {serie.map((d, i) => {
        if (d.tarefasConcluidas === null) return null
        const h = Math.max(1, (d.tarefasConcluidas / maximo) * (A - 2))
        return (
          <rect
            key={d.dia}
            className={d.tarefasConcluidas > 0 ? 'uso-barra' : 'uso-barra-vazia'}
            x={(i * largura + 0.5).toFixed(1)}
            y={(A - h).toFixed(1)}
            width={Math.max(1, largura - 1.5).toFixed(1)}
            height={h.toFixed(1)}
            rx="1"
          />
        )
      })}
    </svg>
  )
}
