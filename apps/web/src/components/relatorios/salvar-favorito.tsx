'use client'

import { AVISO_NOME_DO_FAVORITO } from '@fir/contracts'
import { useState } from 'react'
import { Modal } from '@/components/modal'

/**
 * **"Salvar como favorito"** (1.9 G, item 5; I-41).
 *
 * Guarda os filtros DO QUE ESTÁ NA TELA — os que geraram a tabela, não os que
 * a pessoa mexeu depois. O favorito é da clínica, e o nome aparece para toda a
 * equipe: daí o aviso de não usar nome de paciente (LGPD L-IN-17).
 */
export function SalvarFavorito({
  ocupado,
  aoSalvar,
}: {
  ocupado: boolean
  /** Devolve a mensagem de erro, ou `null` quando salvou. */
  aoSalvar: (nome: string) => Promise<string | null>
}) {
  const [aberto, setAberto] = useState(false)
  const [nome, setNome] = useState('')
  const [erro, setErro] = useState<string | null>(null)

  const fechar = () => {
    setAberto(false)
    setErro(null)
  }

  return (
    <>
      <button type="button" className="btn ghost" onClick={() => setAberto(true)}>
        Salvar como favorito
      </button>
      {aberto ? (
        <Modal titulo="Salvar como favorito" aoFechar={fechar}>
          <form
            className="rel-confirmar"
            onSubmit={(e) => {
              e.preventDefault()
              const n = nome.trim()
              if (n === '') {
                setErro('Dê um nome ao favorito.')
                return
              }
              void aoSalvar(n).then((r) => {
                if (r === null) {
                  setNome('')
                  fechar()
                } else setErro(r)
              })
            }}
          >
            <label className="campo">
              Nome do favorito
              <input
                value={nome}
                maxLength={80}
                placeholder="ex.: Inativos de tirzepatida há 4 meses"
                aria-describedby="rel-favorito-dica"
                aria-invalid={erro !== null}
                onChange={(e) => setNome(e.target.value)}
              />
              <small id="rel-favorito-dica">{AVISO_NOME_DO_FAVORITO}</small>
              {erro === null ? null : <span className="erro">{erro}</span>}
            </label>
            <div className="rel-confirmar-botoes">
              <button type="button" className="link" style={{ minHeight: 44 }} onClick={fechar}>
                Cancelar
              </button>
              <button type="submit" className="btn" disabled={ocupado}>
                {ocupado ? 'Salvando…' : 'Salvar'}
              </button>
            </div>
          </form>
        </Modal>
      ) : null}
    </>
  )
}
