'use client'

import type { ListaDeClientesDaCarteiraSaida } from '@fir/contracts'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { chamar, ErroDaApi } from '@/lib/api'
import { useCarteira } from '../contexto'
import { NavDaCarteira } from '../pecas'

/**
 * A lista de Cliente Firmare visíveis ao Usuário de Gestão. Primeira tela
 * de DADO REAL da carteira — o servidor já filtrou por grupo
 * (`app_pode_ver_grupo`, ADR 0012); esta tela nunca filtra de novo, nunca
 * decide quem vê o quê.
 */
export default function ClientesDaCarteira() {
  const { sessao } = useCarteira()
  const [estado, setEstado] = useState<
    | { tag: 'carregando' }
    | { tag: 'erro'; mensagem: string }
    | { tag: 'pronto'; itens: ListaDeClientesDaCarteiraSaida['clientes'] }
  >({ tag: 'carregando' })

  useEffect(() => {
    if (sessao.tag !== 'pronta') return
    let valeu = true
    void (async () => {
      try {
        const r = await chamar<ListaDeClientesDaCarteiraSaida>('v1/carteira/clientes')
        if (valeu) setEstado({ tag: 'pronto', itens: r.clientes })
      } catch (e) {
        if (valeu) {
          setEstado({
            tag: 'erro',
            mensagem: e instanceof ErroDaApi ? e.message : 'Não foi possível carregar a lista.',
          })
        }
      }
    })()
    return () => {
      valeu = false
    }
  }, [sessao.tag])

  if (sessao.tag !== 'pronta' || estado.tag === 'carregando') {
    return <p className="muted">Carregando…</p>
  }
  if (estado.tag === 'erro') {
    return <p className="erro">{estado.mensagem}</p>
  }

  return (
    <section>
      <NavDaCarteira atual="/carteira/clientes" />
      <h1 className="titulo">Clínicas da carteira</h1>
      {estado.itens.length === 0 ? (
        <p className="vazio">Nenhuma clínica visível ainda neste grupo.</p>
      ) : (
        <div className="carteira-lista">
          {estado.itens.map((c) => (
            <Link key={c.id} href={`/carteira/clientes/${c.id}`} className="carteira-card">
              <span className="carteira-nome">{c.nome}</span>
              <span className="produto">{c.produto}</span>
              <span className={`pill ${c.status === 'ativo' ? 'bom' : c.status === 'encerrado' ? 'mau' : ''}`}>
                {c.status}
              </span>
            </Link>
          ))}
        </div>
      )}
    </section>
  )
}
