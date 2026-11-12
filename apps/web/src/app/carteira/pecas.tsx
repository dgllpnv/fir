'use client'

import type { ContadoresDoMenuSaida } from '@fir/contracts'
import { temPermCarteira } from '@fir/domain'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { chamar } from '@/lib/api'
import { type Area, areaDoCaminho, GRUPOS } from './areas'
import { useCarteira } from './contexto'

/**
 * As peças compartilhadas das telas de DADO da carteira (depois da porta).
 * Mesma forma de `gestao/pecas.tsx` — nenhum `style` inline, tudo em
 * `packages/ui/src/carteira.css`.
 */

/**
 * O MENU DA LATERAL: cada item só aparece se o perfil tem a tela (`can(k)`,
 * L1252), pela MESMA `temPermCarteira` do servidor (regra 16) — a tela é
 * conveniência, o guard é quem recusa. Os badges são CONTAGENS do servidor
 * (`GET /v1/carteira/eu/contadores`), nunca contados aqui; falhar em buscá-los
 * só deixa o menu sem badge.
 *
 * Desenhado UMA vez, pelo casco (`lateral.tsx`), e não mais por cada página:
 * o item aceso sai do endereço (`areaDoCaminho`). Como o menu não remonta a
 * cada tela, os contadores são rebuscados a cada troca de rota — antes isso
 * acontecia de graça, porque cada página montava a sua nav.
 */
export function NavDaCarteira() {
  const { sessao } = useCarteira()
  const caminho = usePathname()
  const usuario = sessao.tag === 'pronta' ? sessao.usuarioDeGestao : null
  const [contadores, setContadores] = useState<ContadoresDoMenuSaida | null>(null)
  const atual = areaDoCaminho(caminho)

  useEffect(() => {
    if (usuario === null) return
    let valeu = true
    chamar<ContadoresDoMenuSaida>('v1/carteira/eu/contadores')
      .then((c) => {
        if (valeu) setContadores(c)
      })
      .catch(() => {})
    return () => {
      valeu = false
    }
  }, [usuario, caminho])

  // Sem sessão resolvida (erro ao falar com o servidor), o menu inteiro: o
  // guard recusa o que não for dela.
  const pode = (a: Area) => usuario === null || temPermCarteira(usuario, a.tela)

  return (
    <nav className="carteira-menu" aria-label="Áreas da carteira">
      {GRUPOS.map((g) => {
        const areas = g.areas.filter(pode)
        if (areas.length === 0) return null
        return (
          <div key={g.titulo} className="carteira-menu-grupo">
            <span className="carteira-menu-titulo">{g.titulo}</span>
            {areas.map((a) => {
              const n = a.badge ? contadores?.[a.badge.de] : null
              return (
                <Link
                  key={a.href}
                  href={a.href}
                  className="carteira-menu-item"
                  aria-current={a.href === atual ? 'page' : undefined}
                >
                  <span className="carteira-menu-rotulo">{a.rotulo}</span>
                  {a.badge && typeof n === 'number' && n > 0 ? (
                    <span className="carteira-menu-badge" title={a.badge.dica} aria-label={`${n} ${a.badge.dica}`}>
                      {n}
                    </span>
                  ) : null}
                </Link>
              )
            })}
          </div>
        )
      })}
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
