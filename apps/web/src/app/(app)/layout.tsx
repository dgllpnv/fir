import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import type { ReactNode } from 'react'
import type { EuSaida } from '@fir/contracts'
import { type ChaveDePermissao, PERMS } from '@fir/domain'
import { itensDoMenu } from '@/lib/menu'

const API = process.env.FIR_API_URL || 'http://127.0.0.1:4811'
const CHAVES = new Set<string>(PERMS.map((p) => p[1]))

export default async function AppLayout({ children }: { children: ReactNode }) {
  // A sessão é resolvida no SERVIDOR: a tela nunca decide se alguém entrou.
  const cabecalho = (await cookies()).toString()
  const r = await fetch(`${API}/v1/eu`, { headers: { cookie: cabecalho }, cache: 'no-store' })
  if (!r.ok) redirect('/entrar')

  const eu = (await r.json()) as EuSaida
  // `perms` chega como string[] do JSON; o domínio quer ChaveDePermissao[].
  // O estreitamento acontece aqui, uma vez, e não em cada chamada de temPerm.
  const perfis = eu.perfis.map((p) => ({
    id: p.id,
    nome: p.nome,
    perms: p.perms.filter((k): k is ChaveDePermissao => CHAVES.has(k)),
  }))
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
