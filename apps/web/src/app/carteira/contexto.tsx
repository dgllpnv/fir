'use client'

import type { CarteiraEuComSegundoFatorSaida, UsuarioDeGestaoPublico } from '@fir/contracts'
import { usePathname, useRouter } from 'next/navigation'
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { chamar, ErroDaApi } from '@/lib/api'
import { ehPortaDaCarteira } from '@/lib/rota-da-carteira'

/**
 * QUEM ESTÁ NA CARTEIRA — resolvido uma vez, para a faixa e para as telas.
 * Mesma forma de `contexto.tsx` do painel do superadmin.
 *
 * Mais simples que o painel: a carteira não "age numa clínica" — ela lê
 * dado agregado, sempre já filtrado pelo grupo da sessão (ADR 0012). Não há
 * "clínica aberta" para resolver pelo endereço.
 */

type Sessao =
  | { readonly tag: 'carregando' }
  | { readonly tag: 'saindo' }
  | { readonly tag: 'erro'; readonly mensagem: string }
  | { readonly tag: 'pronta'; readonly usuarioDeGestao: UsuarioDeGestaoPublico }

type Carteira = {
  readonly sessao: Sessao
  readonly recarregar: () => void
}

const Vazio: Carteira = { sessao: { tag: 'carregando' }, recarregar: () => {} }

const Contexto = createContext<Carteira>(Vazio)

export function ProvedorDaCarteira({ children }: { children: ReactNode }) {
  const router = useRouter()
  const caminho = usePathname()
  const [sessao, setSessao] = useState<Sessao>({ tag: 'carregando' })
  const [tentativa, setTentativa] = useState(0)

  const naPorta = ehPortaDaCarteira(caminho)

  useEffect(() => {
    if (naPorta) return
    let valeu = true
    setSessao({ tag: 'carregando' })
    void (async () => {
      try {
        const eu = await chamar<CarteiraEuComSegundoFatorSaida>('v1/carteira/eu')
        if (!valeu) return
        // Senha provisória ⇒ a única coisa que a sessão pode fazer é trocá-la
        // (`CarteiraGuard`). Sem este desvio, o usuário recém-criado cairia
        // numa tela com 409 e nenhuma saída.
        if (eu.usuarioDeGestao.senhaProvisoria) {
          setSessao({ tag: 'saindo' })
          router.replace('/carteira/trocar-senha')
          return
        }
        // Sem o app autenticador cadastrado ⇒ a única coisa que a sessão pode
        // fazer é cadastrá-lo (G8 0.6, `SegundoFatorDaCarteiraGuard`).
        if (!eu.segundoFator.ativo) {
          setSessao({ tag: 'saindo' })
          router.replace('/carteira/segundo-fator')
          return
        }
        setSessao({ tag: 'pronta', usuarioDeGestao: eu.usuarioDeGestao })
      } catch (e) {
        if (!valeu) return
        if (e instanceof ErroDaApi && e.status === 404) {
          setSessao({ tag: 'saindo' })
          router.replace('/carteira/entrar')
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

export const useCarteira = (): Carteira => useContext(Contexto)
