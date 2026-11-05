import type { ReactNode } from 'react'
import { Casco } from './casco'

/**
 * A CARTEIRA COMERCIAL DA FIRMARE. Segmento `carteira` — não `gestao`
 * (colide com o nome do produto, "Rotinas de Gestão") nem `painel` (já é
 * chave de permissão e nome de tela) — decisão Q5 do grilling.
 *
 * Mesma identidade "papel e dourado" do resto do produto; a faixa (discreta,
 * borda dourada — não preenchida como a do painel) é o sinal de que esta é
 * uma TERCEIRA sessão, disjunta da de clínica e da de superadmin.
 */
export default function LayoutDaCarteira({ children }: { children: ReactNode }) {
  return <Casco>{children}</Casco>
}
