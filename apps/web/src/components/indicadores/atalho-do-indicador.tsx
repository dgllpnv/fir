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
  return <LinkDoAtalho href={`/indicadores/${kpiId}`} />
}

/**
 * O mesmo atalho para a ABA, quando a tela não tem um KPI só seu — Minhas
 * metas: a meta é da pessoa, e o KPI que a agrega ("Atingimento das metas
 * individuais") é de RH e some para quem não tem `pessoas.gerir`. Levar a
 * recepção a ele seria levá-la a um 404; a aba ela abre.
 */
export function AtalhoParaIndicadores({ podeIndicadores }: { podeIndicadores: boolean }) {
  if (!podeIndicadores) return null
  return <LinkDoAtalho href="/indicadores" />
}

function LinkDoAtalho({ href }: { href: string }) {
  return (
    <Link className="link" style={{ minHeight: 44, display: 'inline-flex', alignItems: 'center', justifySelf: 'start' }} href={href}>
      Acompanhar em Indicadores &amp; Insights
    </Link>
  )
}
