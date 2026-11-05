'use client'

import type { PortalEuSaida, UsuarioDoPortalPublico } from '@fir/contracts'
import { usePathname, useRouter } from 'next/navigation'
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { chamar, ErroDaApi } from '@/lib/api'
import { ehPortaDoPortal } from '@/lib/rota-do-portal'

/**
 * QUEM ESTÁ NO PORTAL — resolvido uma vez, para a faixa e para a tela de
 * dado. Mesma forma de `carteira/contexto.tsx`: espaço de identidade
 * PRÓPRIO, cookie próprio (`__Host-fir-portal`), nunca reaproveita a sessão
 * de carteira nem a de clínica (ADR 0017, ADR 0018).
 *
 * Mais simples ainda que a carteira: não há um "grupo aberto" para resolver
 * pelo endereço — `escopo` já vem pronto em `usuarioDoPortal` e decide, na
 * tela, se ela mostra uma lista de `Cliente Firmare` ou a ficha de um só.
 */

type Sessao =
  | { readonly tag: 'carregando' }
  | { readonly tag: 'saindo' }
  | { readonly tag: 'erro'; readonly mensagem: string }
  | { readonly tag: 'pronta'; readonly usuarioDoPortal: UsuarioDoPortalPublico }

type Portal = {
  readonly sessao: Sessao
  readonly recarregar: () => void
}

const Vazio: Portal = { sessao: { tag: 'carregando' }, recarregar: () => {} }

const Contexto = createContext<Portal>(Vazio)

export function ProvedorDoPortal({ children }: { children: ReactNode }) {
  const router = useRouter()
  const caminho = usePathname()
  const [sessao, setSessao] = useState<Sessao>({ tag: 'carregando' })
  const [tentativa, setTentativa] = useState(0)

  const naPorta = ehPortaDoPortal(caminho)

  useEffect(() => {
    if (naPorta) return
    let valeu = true
    setSessao({ tag: 'carregando' })
    void (async () => {
      try {
        const eu = await chamar<PortalEuSaida>('v1/portal/eu')
        if (!valeu) return
        setSessao({ tag: 'pronta', usuarioDoPortal: eu.usuarioDoPortal })
      } catch (e) {
        if (!valeu) return
        if (e instanceof ErroDaApi && e.status === 404) {
          setSessao({ tag: 'saindo' })
          router.replace('/portal/entrar')
          return
        }
        setSessao({
          tag: 'erro',
          mensagem:
            e instanceof ErroDaApi
              ? e.message
              : 'Não consegui falar com o servidor. Confira a conexão.',
        })
      }
    })()
    return () => {
      valeu = false
    }
  }, [naPorta, tentativa, router])

  const recarregar = useCallback(() => setTentativa((n) => n + 1), [])

  return <Contexto.Provider value={{ sessao, recarregar }}>{children}</Contexto.Provider>
}

export const usePortal = (): Portal => useContext(Contexto)
