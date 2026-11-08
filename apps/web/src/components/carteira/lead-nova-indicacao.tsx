'use client'

import type { ListaDeClientesDaCarteiraSaida, ListaDeLeadsSaida } from '@fir/contracts'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Modal } from '@/components/modal'
import { chamar, ErroDaApi } from '@/lib/api'
import { FormularioDoLead } from './lead-formulario'

type Dados = { equipe: ListaDeLeadsSaida['equipe']; hoje: string; podeVerValores: boolean; clientes: { id: string; nome: string }[] }

/**
 * "Nova indicação" nas abas que não carregam a lista de leads (Quem indica e
 * Mensagens e roteiros) — o protótipo tem o botão no cabeçalho das três.
 * A equipe, o hoje do servidor e `podeVerValores` vêm da mesma rota da
 * lista, pedida só no toque.
 */
export function NovaIndicacao({ eu }: { eu: string }) {
  const router = useRouter()
  const [dados, setDados] = useState<Dados | null>(null)
  const [abrindo, setAbrindo] = useState(false)
  const [erro, setErro] = useState('')

  async function abrir() {
    setErro('')
    setAbrindo(true)
    try {
      const [l, c] = await Promise.all([
        chamar<ListaDeLeadsSaida>('v1/carteira/leads'),
        chamar<ListaDeClientesDaCarteiraSaida>('v1/carteira/clientes').catch(() => ({ clientes: [] })),
      ])
      setDados({
        equipe: l.equipe,
        hoje: l.hoje,
        podeVerValores: l.podeVerValores,
        clientes: c.clientes.map((x) => ({ id: x.id, nome: x.nome })),
      })
    } catch (e) {
      setErro(e instanceof ErroDaApi ? e.message : 'Sem conexão com o servidor.')
    } finally {
      setAbrindo(false)
    }
  }

  return (
    <>
      <span className="prosp-nova">
        <button type="button" className="btn" disabled={abrindo} onClick={() => void abrir()}>
          {abrindo ? 'Abrindo…' : 'Nova indicação'}
        </button>
        <span role="alert" aria-live="polite" className="erro">
          {erro}
        </span>
      </span>
      {dados !== null ? (
        <Modal titulo="Nova indicação" aoFechar={() => setDados(null)}>
          <FormularioDoLead
            lead={null}
            equipe={dados.equipe}
            clientes={dados.clientes}
            podeVerValores={dados.podeVerValores}
            eu={eu}
            hoje={dados.hoje}
            aoSalvar={(lead) => {
              setDados(null)
              router.push(`/carteira/leads/${lead.id}`)
            }}
          />
        </Modal>
      ) : null}
    </>
  )
}
