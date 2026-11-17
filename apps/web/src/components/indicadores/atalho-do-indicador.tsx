import Link from 'next/link'

/**
 * O atalho "lugar único" (backlog, decisão de produto; revisão S6): as telas
 * de meta que já existiam — Visão do mês, Equipe › Metas do mês, Campanhas —
 * continuam iguais e ganham um link para o indicador correspondente.
 *
 * O id vem do SERVIDOR (`kpiDaMetaId`, `kpiDoAtingimentoId`,
 * `kpiDoResultadoId`): `null` quando a clínica não acompanha aquele KPI, e
 * então não há link. `podeIndicadores` só esconde o link de quem cairia em
 * "Sem acesso" — nenhum número passa por aqui.
 */
export function AtalhoDoIndicador({
  kpiId,
  podeIndicadores,
}: {
  kpiId: string | null | undefined
  podeIndicadores: boolean
}) {
  if (!podeIndicadores || kpiId === null || kpiId === undefined) return null
  return (
    <Link className="link" style={{ minHeight: 44, display: 'inline-flex', alignItems: 'center', justifySelf: 'start' }} href={`/indicadores/${kpiId}`}>
      Acompanhar em Indicadores &amp; Insights
    </Link>
  )
}
