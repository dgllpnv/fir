'use client'

import type { ClienteCarteiraNaLista, EquipeDaRotinaSaida, ListaDeClientesDaCarteiraSaida } from '@fir/contracts'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { chamar } from '@/lib/api'

/**
 * Peças compartilhadas da Rotina da equipe (G8 2A): as abas (`vRotina`,
 * L1861 — Tarefas · Carga da equipe · Rotinas), o formatador de dia/mês e a
 * leitura da equipe e dos clientes para os seletores. Nada aqui calcula
 * prazo, seção ou carga: isso vem pronto do servidor.
 */

export type Pessoa = EquipeDaRotinaSaida['pessoas'][number]

/** `dm` do protótipo: "13/11". Formatar é do front; o dia veio do servidor. */
export const diaMes = (dia: string): string => `${dia.slice(8, 10)}/${dia.slice(5, 7)}`

export const nomeDaPessoa = (pessoas: readonly Pessoa[], id: string | null): string =>
  id === null ? 'Sem responsável' : (pessoas.find((p) => p.id === id)?.nome ?? 'Outra pessoa')

export function AbasDaRotina({ atual, podeVerCarga }: { atual: 'tarefas' | 'carga' | 'rotinas'; podeVerCarga: boolean }) {
  const abas = [
    { chave: 'tarefas', href: '/carteira/rotina', rotulo: 'Tarefas' },
    ...(podeVerCarga ? [{ chave: 'carga', href: '/carteira/carga', rotulo: 'Carga da equipe' }] : []),
    { chave: 'rotinas', href: '/carteira/rotina/rotinas', rotulo: 'Rotinas' },
  ]
  return (
    <nav className="rot-int-abas" aria-label="Rotina da equipe">
      {abas.map((a) => (
        <Link
          key={a.chave}
          href={a.href}
          className={a.chave === atual ? 'rot-int-aba rot-int-aba-atual' : 'rot-int-aba'}
          aria-current={a.chave === atual ? 'page' : undefined}
        >
          {a.rotulo}
        </Link>
      ))}
    </nav>
  )
}

/**
 * A equipe (para "Minhas", os seletores de responsável e a aba de carga) e
 * os clientes (para o seletor de cliente). Falhar aqui degrada os seletores,
 * não derruba a tela.
 */
export function useEquipeEClientes(ativo: boolean): {
  equipe: EquipeDaRotinaSaida | null
  clientes: ClienteCarteiraNaLista[]
} {
  const [equipe, setEquipe] = useState<EquipeDaRotinaSaida | null>(null)
  const [clientes, setClientes] = useState<ClienteCarteiraNaLista[]>([])
  useEffect(() => {
    if (!ativo) return
    let valeu = true
    chamar<EquipeDaRotinaSaida>('v1/carteira/equipe-da-rotina')
      .then((r) => {
        if (valeu) setEquipe(r)
      })
      .catch(() => {})
    chamar<ListaDeClientesDaCarteiraSaida>('v1/carteira/clientes')
      .then((r) => {
        if (valeu) setClientes(r.clientes)
      })
      .catch(() => {})
    return () => {
      valeu = false
    }
  }, [ativo])
  return { equipe, clientes }
}
