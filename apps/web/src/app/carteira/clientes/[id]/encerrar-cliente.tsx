'use client'

import type { CadastroDoClienteNaSaida, CadastroDoClienteSaida } from '@fir/contracts'
import { useState } from 'react'
import { Modal } from '@/components/modal'
import { chamar, ErroDaApi } from '@/lib/api'

/**
 * **ENCERRAR O CLIENTE** (C5). No protótipo é "Excluir" dentro do "Editar
 * cadastro", só para a diretoria, e apaga em CASCATA metas, ações,
 * campanhas, documentos, reuniões, indicadores e lançamentos (`L2966`).
 *
 * Aqui é um ESTADO (regra 20): `PATCH …/clientes/:id { status: 'encerrado' }`.
 * Nada é apagado, o histórico continua na ficha, e voltar atrás é trocar o
 * status no cadastro. A ficha só oferece o botão a quem administra
 * (`podeAdministrar`, A-9) — a mesma pessoa que no protótipo via o "Excluir".
 */
export default function EncerrarCliente({
  cliente,
  aoEncerrar,
}: {
  cliente: CadastroDoClienteNaSaida
  aoEncerrar: (cliente: CadastroDoClienteNaSaida) => void
}) {
  const [aberto, setAberto] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState('')

  async function encerrar() {
    setErro('')
    setEnviando(true)
    try {
      const r = await chamar<CadastroDoClienteSaida>(`v1/carteira/clientes/${cliente.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'encerrado' }),
      })
      setAberto(false)
      aoEncerrar(r.cliente)
    } catch (x) {
      setErro(x instanceof ErroDaApi ? x.message : 'Sem conexão com o servidor.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <>
      <button type="button" className="btn ghost ficha-encerrar" onClick={() => setAberto(true)}>
        Encerrar cliente
      </button>
      {aberto ? (
        <Modal titulo={`Encerrar ${cliente.nome}?`} aoFechar={() => setAberto(false)}>
          <p className="nota">
            O status passa a ser Encerrado. <b>Nada é apagado</b>: metas,
            reuniões, documentos e o histórico continuam nesta ficha. Para reabrir, mude o status no cadastro.
          </p>
          <p role="alert" aria-live="polite" className="erro">
            {erro}
          </p>
          <div className="ficha-modal-acoes">
            <button type="button" className="btn" disabled={enviando} onClick={() => void encerrar()}>
              {enviando ? 'Encerrando…' : 'Encerrar cliente'}
            </button>
            <button type="button" className="btn ghost" onClick={() => setAberto(false)}>
              Cancelar
            </button>
          </div>
        </Modal>
      ) : null}
    </>
  )
}
