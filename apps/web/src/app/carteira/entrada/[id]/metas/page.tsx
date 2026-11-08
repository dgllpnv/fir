'use client'

import type { CadastroDoClienteSaida } from '@fir/contracts'
import { useParams, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { MetasEmAndamento } from '@/components/carteira/checklist-metas-em-andamento'
import { Carregando } from '@/components/estados'
import { chamar, ErroDaApi } from '@/lib/api'
import { useCarteira } from '../../../contexto'
import { ErroDaCarteira, NavDaCarteira } from '../../../pecas'

/**
 * "Cadastrar metas em andamento" a partir do aviso da ficha (`data-migmetas`,
 * L2845): o mesmo passo da entrada, fora do passo a passo.
 */
export default function MetasDaEntrada() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
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

  const nav = <NavDaCarteira atual="/carteira/clientes" />
  if (sessao.tag === 'erro' || erro) {
    return (
      <section>
        {nav}
        <ErroDaCarteira
          mensagem={erro ?? (sessao.tag === 'erro' ? sessao.mensagem : '')}
          recarregar={() => {
            setErro(null)
            setTentativa((n) => n + 1)
            recarregar()
          }}
        />
      </section>
    )
  }
  if (sessao.tag !== 'pronta' || nome === null) {
    return (
      <section>
        {nav}
        <Carregando linhas={5} />
      </section>
    )
  }
  return (
    <section className="check">
      {nav}
      <MetasEmAndamento clienteId={id} nomeDoCliente={nome} passoAPasso={false} aoTerminar={() => router.push(`/carteira/entrada/${id}`)} />
    </section>
  )
}
