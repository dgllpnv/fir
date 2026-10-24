import type { ReactNode } from 'react'
import { Shell } from '@/components/shell'
import { itensDoMenu } from '@/lib/menu'
import { sessaoAtual } from '@/lib/sessao'

export default async function AppLayout({ children }: { children: ReactNode }) {
  // A sessão é resolvida no SERVIDOR, em `lib/sessao` — um lugar só, usado
  // também pelas páginas que precisam conferir permissão.
  const { eu, perfis } = await sessaoAtual()

  // O menu é filtrado AQUI, no servidor. O `Shell` é cliente, e cliente não
  // decide acesso: ele recebe a lista pronta.
  const itens = itensDoMenu(eu.usuario, perfis)

  return (
    <Shell
      itens={itens}
      clinica={eu.clinica.nome}
      usuario={eu.usuario.nome}
      funcao={eu.usuario.funcao}
    >
      {children}
    </Shell>
  )
}
