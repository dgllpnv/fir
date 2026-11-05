'use client'

import Link from 'next/link'

/**
 * As peças compartilhadas das telas de DADO da carteira (depois da porta).
 * Mesma forma de `superadmin/pecas.tsx` — nenhum `style` inline, tudo em
 * `packages/ui/src/carteira.css`.
 */

/**
 * **AS TRÊS ÁREAS DA CARTEIRA, sempre na mesma ordem.** Mesmo padrão de
 * `NavDoPainel`: cada tela chama isto no topo, e `aria-current="page"` diz
 * onde se está — sem cor extra, sem ícone (a carteira é pequena, três
 * destinos cabem em texto).
 */
const AREAS: readonly { href: string; rotulo: string }[] = [
  { href: '/carteira/clientes', rotulo: 'Clientes' },
  { href: '/carteira/leads', rotulo: 'Leads' },
  { href: '/carteira/rotina', rotulo: 'Rotina' },
]

export function NavDaCarteira({ atual }: { atual: string }) {
  return (
    <nav className="carteira-nav" aria-label="Áreas da carteira">
      {AREAS.map((a) => (
        <Link
          key={a.href}
          href={a.href}
          className={a.href === atual ? 'link carteira-nav-atual' : 'link'}
          aria-current={a.href === atual ? 'page' : undefined}
        >
          {a.rotulo}
        </Link>
      ))}
    </nav>
  )
}

/**
 * O erro diz o que aconteceu e DÁ SAÍDA (`design.md` §4) — mas a saída de
 * `Erro` (`components/estados.tsx`) é "Ir para Hoje", uma rota do PRODUTO que
 * a sessão de `Usuário de Gestão` não tem (ela cairia na entrada da clínica).
 * Aqui a saída é a primeira tela da carteira — mesma razão de `ErroDoPainel`.
 */
export function ErroDaCarteira({
  mensagem,
  recarregar,
}: {
  mensagem: string
  recarregar: () => void
}) {
  return (
    <div className="carteira-erro" role="alert">
      <p>{mensagem}</p>
      <div className="carteira-erro-acoes">
        <button type="button" className="btn" onClick={recarregar}>
          Tentar de novo
        </button>
        <Link className="btn ghost" href="/carteira/clientes">
          Ir para Clientes
        </Link>
      </div>
    </div>
  )
}
