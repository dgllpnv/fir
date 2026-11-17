/**
 * **O minigráfico de linha** (`spark` do protótipo da carteira, L1483-1493).
 *
 * Subiu de `components/carteira/` para cá com Indicadores & Insights (I-44):
 * o mesmo desenho serve aos indicadores da cliente na carteira e ao cartão do
 * KPI. SVG feito à mão, sem biblioteca de gráfico.
 */

const W = 240
const H = 44
const P = 4

/**
 * A linha das últimas semanas, a área sob ela, a meta tracejada e o ponto
 * final na cor de "na meta" / "abaixo". SVG puro, sem `style=` e sem
 * biblioteca; as cores moram no CSS (`.ind-faisca-*`), então o tema escuro
 * vem de graça.
 *
 * A escala é GEOMETRIA de desenho, não número de negócio: a posição vertical
 * é `(v − mín) / amplitude` da série, feita em `bigint` (milésimos de pixel)
 * para que um faturamento em centavos não passe por ponto flutuante antes de
 * virar coordenada. Nada daqui vai para o texto.
 *
 * Sem meta, o ponto final fica no dourado (`tom: 'neutro'`) — o protótipo o
 * pintava de "abaixo" comparando com `undefined` (ajuste 22).
 */
export function Faisca({
  valores,
  meta,
  tom,
}: {
  valores: readonly bigint[]
  meta: bigint | null
  tom: 'bom' | 'mau' | 'neutro'
}) {
  const primeiro = valores[0]
  if (primeiro === undefined) return null
  let mn = primeiro
  let mx = primeiro
  for (const v of meta === null ? valores : [...valores, meta]) {
    if (v < mn) mn = v
    if (v > mx) mx = v
  }
  const amplitude = mx - mn === 0n ? 1n : mx - mn
  const alturaUtil = BigInt((H - 2 * P) * 1000)
  const y = (v: bigint): number => H - P - Number(((v - mn) * alturaUtil) / amplitude) / 1000
  const x = (i: number): number => P + (i * (W - 2 * P)) / Math.max(1, valores.length - 1)
  const ultimoI = valores.length - 1
  const pts = valores.map((v, i) => `${x(i)},${y(v)}`).join(' ')

  return (
    <svg className="ind-faisca" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
      {meta !== null ? (
        <line className="ind-faisca-meta" x1={P} x2={W - P} y1={y(meta)} y2={y(meta)} vectorEffect="non-scaling-stroke" />
      ) : null}
      <polygon className="ind-faisca-area" points={`${P},${H} ${pts} ${x(ultimoI)},${H}`} />
      <polyline className="ind-faisca-linha" points={pts} vectorEffect="non-scaling-stroke" />
      <circle className={`ind-faisca-ponto ind-faisca-ponto-${tom}`} cx={x(ultimoI)} cy={y(valores[ultimoI]!)} r="3.2" />
    </svg>
  )
}

