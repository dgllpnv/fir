'use client'

import type { ClinicaNaLista, ClinicasDoPainel, OperadorPublico, PainelEuSaida } from '@fir/contracts'
import { usePathname, useRouter } from 'next/navigation'
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { chamar, ErroDaApi } from '@/lib/api'
import { clinicaDaRota, ehPortaDoPainel } from '@/lib/rota-do-painel'

/**
 * QUEM ESTÁ NO PAINEL E EM QUAL CLÍNICA ELE AGE — resolvido **uma vez**, para
 * a faixa e para as telas.
 *
 * ## Por que isto existe
 *
 * O painel cria clínica e administradora em qualquer clínica. A pergunta "em
 * qual clínica estou agindo?" precisa ter **uma** resposta, vinda de **uma**
 * fonte: se a faixa resolvesse o nome da clínica por um caminho e a tela de
 * pessoas por outro, o dia em que os dois discordassem seria o dia de uma
 * administradora criada na clínica errada.
 *
 * Antes, cada página buscava a sua lista e cada uma repetia o desvio de 404
 * para a entrada. Aqui a sessão é resolvida uma vez:
 *
 *  1. `GET /v1/superadmin/eu` — quem é o operador. 404 é "não há sessão de
 *     painel" (o guard responde 404 para não confirmar que a rota existe), e
 *     a tela traduz isso para **ir para a entrada**.
 *  2. Senha provisória ⇒ a única coisa que a sessão pode fazer é trocá-la
 *     (`PainelGuard`), então o desvio é para `trocar-senha`. Sem isto, o
 *     operador recém-criado pela VPS cairia na lista de clínicas com um 409 e
 *     nenhuma saída — a credencial que vence em 72 h trancaria o painel.
 *  3. `GET /v1/superadmin/clinicas` — a lista. **Ela é o mínimo** (`id`,
 *     `codigo`, `nome`, `fuso`, `ativa`) e é a única fonte do NOME de uma
 *     clínica no painel. Nada aqui pede contagem de pacientes nem tamanho:
 *     seria o mapa comercial dos clientes do produto.
 *
 * ## A regra que a faixa depende
 *
 * `clinicaAberta` é `'nenhuma'` na lista e `'desconhecida'` enquanto a lista
 * não chegou — nunca a clínica da tela anterior, nunca a primeira da lista.
 * Quem não sabe em qual clínica está **não age**: é a tela de pessoas que
 * cobra isso, escondendo o formulário (ver `pessoas/page.tsx`).
 */

type Sessao =
  | { readonly tag: 'carregando' }
  /** Já estamos a caminho da porta; não há o que desenhar. */
  | { readonly tag: 'saindo' }
  | { readonly tag: 'erro'; readonly mensagem: string }
  | {
      readonly tag: 'pronta'
      readonly operador: OperadorPublico
      readonly clinicas: readonly ClinicaNaLista[]
    }

export type ClinicaAberta = ClinicaNaLista | 'nenhuma' | 'desconhecida'

type Painel = {
  readonly sessao: Sessao
  readonly clinicaAberta: ClinicaAberta
  readonly recarregar: () => void
}

const Vazio: Painel = {
  sessao: { tag: 'carregando' },
  clinicaAberta: 'desconhecida',
  recarregar: () => {},
}

const Contexto = createContext<Painel>(Vazio)

export function ProvedorDoPainel({ children }: { children: ReactNode }) {
  const router = useRouter()
  const caminho = usePathname()
  const [sessao, setSessao] = useState<Sessao>({ tag: 'carregando' })
  const [tentativa, setTentativa] = useState(0)

  // A porta não tem sessão para resolver: buscar `eu` ali responderia 404 e
  // mandaria a tela de entrada para a tela de entrada.
  const naPorta = ehPortaDoPainel(caminho)

  useEffect(() => {
    if (naPorta) return
    let valeu = true
    setSessao({ tag: 'carregando' })
    void (async () => {
      try {
        const eu = await chamar<PainelEuSaida>('v1/superadmin/eu')
        if (!valeu) return
        if (eu.operador.senhaProvisoria) {
          setSessao({ tag: 'saindo' })
          router.replace('/superadmin/trocar-senha')
          return
        }
        const lista = await chamar<ClinicasDoPainel>('v1/superadmin/clinicas')
        if (!valeu) return
        setSessao({ tag: 'pronta', operador: eu.operador, clinicas: lista.itens })
      } catch (e) {
        if (!valeu) return
        if (e instanceof ErroDaApi && e.status === 404) {
          setSessao({ tag: 'saindo' })
          router.replace('/superadmin/entrar')
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

  const id = clinicaDaRota(caminho)
  const clinicaAberta: ClinicaAberta =
    id === null
      ? 'nenhuma'
      : sessao.tag === 'pronta'
        ? (sessao.clinicas.find((c) => c.id === id) ?? 'desconhecida')
        : 'desconhecida'

  return (
    <Contexto.Provider value={{ sessao, clinicaAberta, recarregar }}>{children}</Contexto.Provider>
  )
}

export const usePainel = (): Painel => useContext(Contexto)
