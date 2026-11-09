'use client'

import type { ListaDeClientesDaCarteiraSaida, OpcoesDoCadastroSaida } from '@fir/contracts'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { Modal } from '@/components/modal'
import { chamar, ErroDaApi } from '@/lib/api'
import { useCarteira } from '../contexto'
import CadastroDoCliente from './[id]/cadastro'

/**
 * A lista de Cliente Firmare visíveis ao Usuário de Gestão. Primeira tela
 * de DADO REAL da carteira — o servidor já filtrou por grupo
 * (`app_pode_ver_grupo`, ADR 0012); esta tela nunca filtra de novo, nunca
 * decide quem vê o quê.
 *
 * "Novo cliente" (G8 0.4, D-22 item 4) abre o MESMO formulário do cadastro,
 * num modal, como o protótipo (`fCliente`). O cliente nasce sem clínica — e
 * pode ficar ativo assim; ligar a uma clínica é do Operador.
 */
export default function ClientesDaCarteira() {
  const { sessao } = useCarteira()
  const router = useRouter()
  const [estado, setEstado] = useState<
    | { tag: 'carregando' }
    | { tag: 'erro'; mensagem: string }
    | { tag: 'pronto'; itens: ListaDeClientesDaCarteiraSaida['clientes'] }
  >({ tag: 'carregando' })
  const [criando, setCriando] = useState<
    { tag: 'fechado' } | { tag: 'carregando' } | { tag: 'erro'; mensagem: string } | { tag: 'aberto'; opcoes: OpcoesDoCadastroSaida }
  >({ tag: 'fechado' })

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

  async function abrirCriacao() {
    setCriando({ tag: 'carregando' })
    try {
      const opcoes = await chamar<OpcoesDoCadastroSaida>('v1/carteira/cadastro/opcoes')
      setCriando({ tag: 'aberto', opcoes })
    } catch (e) {
      setCriando({ tag: 'erro', mensagem: e instanceof ErroDaApi ? e.message : 'Sem conexão com o servidor.' })
    }
  }

  if (sessao.tag !== 'pronta' || estado.tag === 'carregando') {
    return <p className="muted">Carregando…</p>
  }
  if (estado.tag === 'erro') {
    return <p className="erro">{estado.mensagem}</p>
  }

  return (
    <section>
      <div className="carteira-acoes">
        <h1 className="titulo">Clientes da carteira</h1>
        <button type="button" className="btn" onClick={abrirCriacao} disabled={criando.tag === 'carregando'}>
          Novo cliente
        </button>
      </div>
      {criando.tag === 'erro' ? (
        <p role="alert" className="erro">
          {criando.mensagem}
        </p>
      ) : null}

      {estado.itens.length === 0 ? (
        <div className="vazio">
          <b>Nenhum cliente visível ainda neste grupo.</b>
          <p className="nota">Cadastre o primeiro em “Novo cliente”.</p>
        </div>
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

      {criando.tag === 'aberto' ? (
        <Modal titulo="Novo cliente" aoFechar={() => setCriando({ tag: 'fechado' })}>
          <CadastroDoCliente
            cliente={null}
            opcoes={criando.opcoes}
            aoSalvar={(c) => {
              setCriando({ tag: 'fechado' })
              router.push(`/carteira/clientes/${c.id}`)
            }}
          />
        </Modal>
      ) : null}
    </section>
  )
}
