'use client'

import {
  AVISO_DA_NOTA_DO_FLUXO,
  NOTA_DO_FLUXO_MAXIMA,
  type DestinoDaTarefa,
  type GruposDaEquipe,
  type ListaDaEquipe,
  type TarefaNaLista,
} from '@fir/contracts'
import { useCallback, useRef, useState } from 'react'
import { useDados } from '@/lib/dados'
import { Carregando, Erro } from './estados'
import { Modal } from './modal'

/**
 * Transferir — para uma pessoa OU para um grupo, com uma nota opcional.
 *
 * Duas escolhas e um botão: o destino (Pessoa/Grupo e quem) e, se quiser, uma
 * nota. A nota é texto livre que fica na linha do tempo, por isso o aviso fica
 * VISÍVEL (não num ⓘ): é a única coisa aqui que pode vazar dado de saúde, e quem
 * lê uma dica depois de digitar já digitou (L3).
 *
 * Quem pode transferir é decidido pelo servidor; a tela só oferece o botão a
 * quem `podeTransferir` (domínio) libera. Aqui só se escolhe.
 */
export function TransferirTarefa({
  tarefa: t,
  transferir,
  aoFechar,
  aoTransferir,
}: {
  tarefa: TarefaNaLista
  transferir: (id: string, para: DestinoDaTarefa, nota?: string) => Promise<void>
  aoFechar: () => void
  /** Depois que o servidor aceitou. Quem chama fecha e recarrega. */
  aoTransferir?: () => void
}) {
  const equipe = useDados<ListaDaEquipe>('v1/equipe')
  const grupos = useDados<GruposDaEquipe>('v1/grupos')
  const [tipo, setTipo] = useState<'pessoa' | 'grupo'>('pessoa')
  const [escolhido, setEscolhido] = useState('')
  const [nota, setNota] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  // Identidade estável: o `Modal` re-prende o foco sempre que `aoFechar` muda.
  const emCurso = useRef(false)
  const fechar = useCallback(() => {
    if (!emCurso.current) aoFechar()
  }, [aoFechar])

  const pessoas = (equipe.dados?.equipe ?? []).filter((p) => p.ativo && p.id !== t.responsavelId)
  const doGrupo = (grupos.dados?.grupos ?? []).filter((g) => g.ativo && g.id !== t.grupoId)
  const opcoes = tipo === 'pessoa' ? pessoas : doGrupo
  const falhou = equipe.erro ?? grupos.erro
  const carregando = equipe.dados === null || grupos.dados === null

  async function enviar() {
    if (escolhido === '') {
      setErro(tipo === 'pessoa' ? 'Escolha a pessoa.' : 'Escolha o grupo.')
      return
    }
    setErro(null)
    setEnviando(true)
    emCurso.current = true
    try {
      await transferir(t.id, { tipo, id: escolhido }, nota.trim() === '' ? undefined : nota)
      emCurso.current = false
      aoTransferir?.()
      aoFechar()
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não consegui transferir a tarefa.')
      emCurso.current = false
      setEnviando(false)
    }
  }

  return (
    <Modal titulo="Transferir tarefa" aoFechar={fechar}>
      <p className="nota" style={{ overflowWrap: 'anywhere' }}>
        {t.descricao}
      </p>

      {falhou !== null ? (
        <Erro
          mensagem={falhou}
          recarregar={() => {
            equipe.recarregar()
            grupos.recarregar()
          }}
        />
      ) : carregando ? (
        <Carregando linhas={2} fino />
      ) : (
        <>
          <div className="chips" role="group" aria-label="Transferir para" style={{ marginBottom: 0 }}>
            {(['pessoa', 'grupo'] as const).map((x) => (
              <button
                key={x}
                type="button"
                aria-pressed={tipo === x}
                onClick={() => {
                  setTipo(x)
                  setEscolhido('')
                  setErro(null)
                }}
              >
                {x === 'pessoa' ? 'Uma pessoa' : 'Um grupo'}
              </button>
            ))}
          </div>

          <label className="campo">
            {tipo === 'pessoa' ? 'Quem recebe' : 'Qual grupo recebe'}
            <select value={escolhido} onChange={(e) => setEscolhido(e.target.value)}>
              <option value="">Selecione</option>
              {opcoes.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.nome}
                </option>
              ))}
            </select>
            {opcoes.length === 0 ? (
              <small>
                {tipo === 'pessoa'
                  ? 'Não há outra pessoa ativa na equipe.'
                  : 'Esta clínica ainda não tem outro grupo ativo.'}
              </small>
            ) : null}
          </label>

          <label className="campo">
            Nota <small>(opcional)</small>
            <textarea
              maxLength={NOTA_DO_FLUXO_MAXIMA}
              style={{ minHeight: 64 }}
              value={nota}
              onChange={(e) => setNota(e.target.value)}
              aria-describedby="aviso-da-nota"
            />
            <small id="aviso-da-nota">
              {AVISO_DA_NOTA_DO_FLUXO}{' '}
              <span className="num" style={{ fontVariantNumeric: 'tabular-nums' }}>
                {nota.length}/{NOTA_DO_FLUXO_MAXIMA}
              </span>
            </small>
          </label>
        </>
      )}

      {erro === null ? null : (
        <p className="campo" role="alert">
          <span className="erro">{erro}</span>
        </p>
      )}

      <div className="botoes">
        <button
          type="button"
          className="btn"
          onClick={() => void enviar()}
          disabled={enviando || carregando || falhou !== null}
        >
          {enviando ? 'Transferindo…' : 'Transferir'}
        </button>
        <button type="button" className="btn ghost" onClick={aoFechar} disabled={enviando}>
          Cancelar
        </button>
      </div>
    </Modal>
  )
}
