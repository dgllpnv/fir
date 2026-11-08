/**
 * A barra do progresso do ensaio (`.progress` do protótipo, L2242). SVG para
 * não precisar de `style` inline; o número vai no `aria-label` e, à vista, na
 * linha "n de t perguntas tratadas" logo acima.
 */
export function BarraDeProgresso({ valor, rotulo }: { valor: number; rotulo: string }) {
  const v = Math.max(0, Math.min(100, valor))
  return (
    <svg className="brief-barra" viewBox="0 0 100 6" preserveAspectRatio="none" role="img" aria-label={rotulo}>
      <rect className="brief-barra-fundo" x={0} y={0} width={100} height={6} />
      {v > 0 ? <rect className="brief-barra-cheia" x={0} y={0} width={v} height={6} /> : null}
    </svg>
  )
}
