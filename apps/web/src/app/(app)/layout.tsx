import type { ReactNode } from 'react'
import { itensDoMenu } from '@/lib/menu'
import { sessaoAtual } from '@/lib/sessao'

export default async function AppLayout({ children }: { children: ReactNode }) {
  // A sessão é resolvida no SERVIDOR, em `lib/sessao` — um lugar só, usado
  // também pelas páginas que precisam conferir permissão.
  const { eu, perfis } = await sessaoAtual()
  const itens = itensDoMenu(eu.usuario, perfis)

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr)', minHeight: '100%' }}>
      <header style={{ borderBottom: '1px solid var(--line)', background: 'var(--surface)' }}>
        <div className="wrap" style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '12px 16px' }}>
          <strong style={{ fontFamily: 'var(--display)' }}>{eu.clinica.nome || 'Firmare'}</strong>
          <nav style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 14 }}>
            {itens.map((i) => (
              <a key={i.href} href={i.href} style={{ color: 'var(--muted)', textDecoration: 'none' }}>
                {i.rotulo}
              </a>
            ))}
          </nav>
          <span style={{ marginLeft: 'auto', color: 'var(--muted)', fontSize: 14 }}>{eu.usuario.nome}</span>
        </div>
      </header>
      <main className="wrap" style={{ paddingBlock: 24 }}>{children}</main>
    </div>
  )
}
