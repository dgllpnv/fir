'use client'

import type { ListaDeLocais } from '@fir/contracts'
import { useState } from 'react'
import { chamar, ErroDaApi } from '@/lib/api'

/**
 * Os locais do estoque — *"onde os itens ficam na clínica"*.
 *
 * Eles existem por causa da CONTAGEM: a lista sai agrupada por local, como um
 * roteiro de quem vai contar. Sem isso, contar quarenta itens é andar quatro
 * vezes pela clínica.
 *
 * Desativar é um ESTADO, nunca uma exclusão: o item aponta para o local, e o
 * movimento antigo foi feito num item que morava ali.
 */
export function FormularioDeLocais({
  locais,
  aoFechar,
  aoSalvar,
}: {
  locais: ListaDeLocais['locais']
  aoFechar: () => void
  aoSalvar: () => void
}) {
  const [nome, setNome] = useState('')
  const [editando, setEditando] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)

  async function salvar(): Promise<void> {
    setErro(null)
    if (nome.trim() === '') {
      setErro('Dê um nome ao local.')
      return
    }
    setOcupado(true)
    try {
      if (editando === null) {
        await chamar('v1/estoque/locais', {
          method: 'POST',
          body: JSON.stringify({ nome: nome.trim() }),
        })
      } else {
        await chamar(`v1/estoque/locais/${editando}`, {
          method: 'PATCH',
          body: JSON.stringify({ nome: nome.trim() }),
        })
      }
      setNome('')
      setEditando(null)
      aoSalvar()
    } catch (e) {
      setErro(e instanceof ErroDaApi ? e.message : 'Não consegui falar com o servidor.')
    } finally {
      setOcupado(false)
    }
  }

  async function alternar(id: string, ativo: boolean): Promise<void> {
    setErro(null)
    try {
      await chamar(`v1/estoque/locais/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ ativo }),
      })
      aoSalvar()
    } catch (e) {
      setErro(e instanceof ErroDaApi ? e.message : 'Não consegui falar com o servidor.')
    }
  }

  return (
    <div className="cartao" style={{ display: 'grid', gap: 10 }}>
      <h3>Locais do estoque</h3>
      <p className="nota" style={{ margin: 0 }}>
        Onde os itens ficam na clínica: sala de estoque, sala de enfermagem, geladeira, sala da
        doutora… Cada item fica em um local, e a contagem pode ser feita local por local.
      </p>

      <div className="linhas">
        {locais.map((l) => (
          <div key={l.id} className="linha">
            <div className="info">
              <b>{l.nome}</b>
              <small>
                {l.itens === 1 ? '1 item' : `${l.itens} itens`}
                {l.ativo ? '' : ' · inativo'}
              </small>
            </div>
            <div className="botoes">
              <button
                type="button"
                className="link"
                onClick={() => {
                  setEditando(l.id)
                  setNome(l.nome)
                }}
              >
                Renomear
              </button>
              <button
                type="button"
                className="link"
                onClick={() => void alternar(l.id, !l.ativo)}
              >
                {l.ativo ? 'Desativar' : 'Reativar'}
              </button>
            </div>
          </div>
        ))}
      </div>

      <label className="campo">
        {editando === null ? 'Novo local' : 'Renomear local'}
        <input
          type="text"
          maxLength={40}
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          placeholder="Ex.: Geladeira da enfermagem"
        />
      </label>

      {erro !== null ? (
        <p className="erro" role="alert">
          {erro}
        </p>
      ) : null}

      <div className="botoes">
        <button type="button" className="btn" disabled={ocupado} onClick={() => void salvar()}>
          {editando === null ? 'Adicionar local' : 'Salvar'}
        </button>
        {editando !== null ? (
          <button
            type="button"
            className="btn ghost"
            onClick={() => {
              setEditando(null)
              setNome('')
            }}
          >
            Cancelar
          </button>
        ) : null}
        <button type="button" className="btn ghost" onClick={aoFechar}>
          Fechar
        </button>
      </div>
    </div>
  )
}
