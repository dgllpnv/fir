import type { ReactNode } from 'react'
import { Casco } from './casco'

/**
 * O PORTAL DO GRUPO. Segmento `portal` — quarto espaço de identidade, ao
 * lado do produto, do painel do superadmin e da carteira comercial. Spec:
 * `docs/superpowers/plans/g6-spec-portal-do-grupo.md`. ADRs 0017, 0018.
 *
 * Mesma identidade "papel e dourado" do resto do produto; a faixa (discreta,
 * borda dourada — ver `portal.css`) sinaliza que esta é a QUARTA sessão,
 * disjunta das outras três. Quem abre o portal é o CLIENTE da Firmare, nunca
 * a equipe interna — por isso o portal nunca reaproveita `carteira.css` nem
 * o contexto da carteira, embora a estrutura seja a mesma de propósito.
 */
export default function LayoutDoPortal({ children }: { children: ReactNode }) {
  return <Casco>{children}</Casco>
}
