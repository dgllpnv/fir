'use client'

import type { CadastroDoClienteNaSaida, CadastroDoClienteSaida, OpcoesDoCadastroSaida } from '@fir/contracts'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import { Toast } from '@/components/estados'
import { chamar, ErroDaApi } from '@/lib/api'
import { useCarteira } from '../../../contexto'
import { ErroDaCarteira } from '../../../pecas'
import CadastroDoCliente from '../cadastro'

/**
 * A tela do CADASTRO de um `Cliente Firmare` — "Editar cliente" do
 * protótipo (`fCliente`, L2771). Lê `GET /v1/carteira/clientes/:id` (a rota
 * que a ficha não tinha) e as opções dos selects; o formulário mora em
 * `../cadastro.tsx`, o mesmo que cria cliente na lista.
 */
type Estado =
  | { tag: 'carregando' }
  | { tag: 'naoEncontrado' }
  | { tag: 'erro'; mensagem: string }
  | { tag: 'pronto'; cliente: CadastroDoClienteNaSaida; opcoes: OpcoesDoCadastroSaida }

export default function TelaDoCadastro() {
  const { id } = useParams<{ id: string }>()
  const { sessao } = useCarteira()
  const [estado, setEstado] = useState<Estado>({ tag: 'carregando' })
  const [tentativa, setTentativa] = useState(0)
  const [recado, setRecado] = useState<string | null>(null)

  useEffect(() => {
    if (sessao.tag !== 'pronta') return
    let valeu = true
    setEstado({ tag: 'carregando' })
    void (async () => {
      try {
        const [c, opcoes] = await Promise.all([
          chamar<CadastroDoClienteSaida>(`v1/carteira/clientes/${id}`),
          chamar<OpcoesDoCadastroSaida>('v1/carteira/cadastro/opcoes'),
        ])
        if (valeu) setEstado({ tag: 'pronto', cliente: c.cliente, opcoes })
      } catch (e) {
        if (!valeu) return
        if (e instanceof ErroDaApi && e.status === 404) setEstado({ tag: 'naoEncontrado' })
        else
          setEstado({
            tag: 'erro',
            mensagem: e instanceof ErroDaApi ? e.message : 'Não consegui falar com o servidor. Confira a conexão.',
          })
      }
    })()
    return () => {
      valeu = false
    }
  }, [sessao.tag, id, tentativa])

  if (sessao.tag !== 'pronta' || estado.tag === 'carregando') return <p className="muted">Carregando…</p>

  if (estado.tag === 'naoEncontrado') {
    return (
      <section className="vazio">
        <b>Cliente não encontrado.</b>
        <p className="nota">Ele pode não existir mais, ou estar fora dos grupos que você enxerga.</p>
        <Link className="btn" href="/carteira/clientes">
          Voltar para Clientes
        </Link>
      </section>
    )
  }

  if (estado.tag === 'erro') {
    return <ErroDaCarteira mensagem={estado.mensagem} recarregar={() => setTentativa((n) => n + 1)} />
  }

  return (
    <div className="carteira-cliente">
      <p className="nota">
        <Link className="link" href={`/carteira/clientes/${estado.cliente.id}`}>
          ← {estado.cliente.nome}
        </Link>
      </p>
      <header className="carteira-cliente-cabecalho">
        <div>
          <div className="eyebrow">Cadastro</div>
          <h1>{estado.cliente.nome}</h1>
        </div>
      </header>

      <section className="cartao carteira-secao">
        <CadastroDoCliente
          key={tentativa}
          cliente={estado.cliente}
          opcoes={estado.opcoes}
          aoSalvar={(c) => {
            setEstado({ tag: 'pronto', cliente: c, opcoes: estado.opcoes })
            setRecado('Cadastro salvo.')
          }}
        />
      </section>

      <Toast recado={recado} aoFechar={() => setRecado(null)} />
    </div>
  )
}
