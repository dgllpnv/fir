'use client'

import type { CadastroDoClienteSaida } from '@fir/contracts'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import { AvisoDeEntrada } from '@/components/carteira/checklist-aviso-de-entrada'
import { ChecklistDoCliente, ProgressoDoChecklist } from '@/components/carteira/checklist-do-cliente'
import { Carregando } from '@/components/estados'
import { chamar, ErroDaApi } from '@/lib/api'
import { useCarteira } from '../../contexto'
import { ErroDaCarteira } from '../../pecas'

/**
 * **A entrada de UMA cliente**: o aviso "Entrada de cliente que já é da
 * Firmare" (C6), o progresso (V3) e o checklist do contrato (V15) — os três
 * componentes que a ficha em abas (1A) monta, reunidos aqui enquanto a ficha
 * não os tem. O aviso aponta para cá.
 */
export default function EntradaDaCliente() {
  const { id } = useParams<{ id: string }>()
  const { sessao, recarregar } = useCarteira()
  const [nome, setNome] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [tentativa, setTentativa] = useState(0)

  useEffect(() => {
    if (sessao.tag !== 'pronta') return
    let valeu = true
    void chamar<CadastroDoClienteSaida>(`v1/carteira/clientes/${id}`)
      .then((r) => valeu && setNome(r.cliente.nome))
      .catch((e: unknown) => valeu && setErro(e instanceof ErroDaApi ? e.message : 'Não foi possível abrir a cliente.'))
    return () => {
      valeu = false
    }
  }, [id, sessao.tag, tentativa])

  if (sessao.tag === 'erro') {
    return (
      <section>
        <ErroDaCarteira mensagem={sessao.mensagem} recarregar={recarregar} />
      </section>
    )
  }
  if (erro) {
    return (
      <section>
        <ErroDaCarteira mensagem={erro} recarregar={() => { setErro(null); setTentativa((n) => n + 1) }} />
      </section>
    )
  }
  if (sessao.tag !== 'pronta' || nome === null) {
    return (
      <section>
        <Carregando linhas={5} />
      </section>
    )
  }
  const irParaOChecklist = () => document.getElementById('check-titulo')?.scrollIntoView({ behavior: 'smooth' })
  return (
    <section className="check">
      <h1 className="titulo">{nome}</h1>
      <div className="check-acoes">
        <Link className="link" href={`/carteira/clientes/${id}`}>
          Abrir a ficha
        </Link>
      </div>
      <AvisoDeEntrada clienteId={id} />
      <ProgressoDoChecklist clienteId={id} aoAbrir={irParaOChecklist} />
      <ChecklistDoCliente clienteId={id} />
    </section>
  )
}
