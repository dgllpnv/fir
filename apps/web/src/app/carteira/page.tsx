import { redirect } from 'next/navigation'

/**
 * `/carteira` — a porta da carteira. Mesma razão de `superadmin/page.tsx`:
 * sem esta página, `/carteira` cairia no catch-all do PRODUTO, que resolve
 * sessão de clínica e manda para `/entrar` — confuso para quem digitou o
 * endereço certo.
 */
export default function PortaDaCarteira() {
  redirect('/carteira/clientes')
}
