import { redirect } from 'next/navigation'

/**
 * `/portal` — a porta do portal. Mesma razão de `carteira/page.tsx`: sem
 * esta página, `/portal` cairia no catch-all do PRODUTO, que resolve sessão
 * de clínica e manda para `/entrar` — confuso para quem digitou o endereço
 * certo.
 */
export default function PortaDoPortal() {
  redirect('/portal/clientes')
}
