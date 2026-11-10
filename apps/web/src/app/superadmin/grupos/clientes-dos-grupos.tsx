'use client'

import {
  type ClienteCarteiraNoPainel,
  type ClienteCarteiraNoPainelSaida,
  type GrupoNaLista,
  type GruposDaClinicaSaida,
  type ListaDeClientesCarteiraNoPainelSaida,
  type StatusDoClienteFirmare,
} from '@fir/contracts'
import { useEffect, useState } from 'react'
import { Modal } from '@/components/modal'
import { Carregando } from '@/components/estados'
import { chamar, ErroDaApi } from '@/lib/api'
import { ErroDoPainel } from '../pecas'

const STATUS: ReadonlyArray<[StatusDoClienteFirmare, string]> = [
  ['onboarding', 'Onboarding'],
  ['ativo', 'Ativo'],
  ['pausado', 'Pausado'],
  ['encerrado', 'Encerrado'],
]

/**
 * **QUEM PERTENCE A CADA GRUPO** (G8 0.4) — os `Cliente Firmare` de cada
 * grupo, com ou sem clínica, e o que é TENANCY e só o Operador mexe: o
 * GRUPO (A-11 item 6) e o status. Mudar o grupo pede motivo: ele vai para
 * `historico_grupo_da_clinica` quando há clínica.
 *
 * **Sem dinheiro nesta tela, de propósito.** O painel trata identidade e
 * tenancy, nunca negócio (`superadmin/identidade.test.ts`, "nenhum dinheiro
 * atravessa"). A rota `PATCH /v1/superadmin/clientes-carteira/:id` aceita
 * mensalidade e vencimento — a única escrita de valor enquanto a carteira
 * não tem a chave `valores` (ticket 0.5) —, mas a tela que os edita é o
 * cadastro da carteira, que mostra a seção Pagamento a quem o servidor
 * mandar os campos.
 */
export function ClientesDosGrupos({
  grupos,
  clinicas,
  versao,
  aoMudar,
}: {
  grupos: readonly GrupoNaLista[]
  clinicas: readonly { id: string; codigo: string; nome: string }[]
  /** Muda quando outra parte da tela criou um cliente — relê a lista. */
  versao: number
  aoMudar: (recado: string) => void
}) {
  const [clientes, setClientes] = useState<ClienteCarteiraNoPainel[] | null>(null)
  const [erro, setErro] = useState('')
  const [tentativa, setTentativa] = useState(0)
  const [editando, setEditando] = useState<ClienteCarteiraNoPainel | null>(null)

  useEffect(() => {
    let valeu = true
    setErro('')
    chamar<ListaDeClientesCarteiraNoPainelSaida>('v1/superadmin/clientes-carteira')
      .then((r) => {
        if (valeu) setClientes(r.clientes)
      })
      .catch((x: unknown) => {
        if (valeu) setErro(x instanceof ErroDaApi ? x.message : 'Sem conexão com o servidor.')
      })
    return () => {
      valeu = false
    }
  }, [tentativa, versao])

  const codigoDa = (id: string | null) => (id === null ? null : (clinicas.find((c) => c.id === id)?.codigo ?? 'clínica'))

  return (
    <section className="superadmin-clientes-dos-grupos">
      <div className="titulo">
        <h2>Clientes de cada grupo</h2>
      </div>
      {erro !== '' ? (
        <ErroDoPainel mensagem={erro} recarregar={() => setTentativa((n) => n + 1)} />
      ) : clientes === null ? (
        <Carregando linhas={3} fino />
      ) : (
        grupos.map((g) => {
          const doGrupo = clientes.filter((c) => c.grupoId === g.id)
          return (
            <details key={g.id} className="superadmin-dobra" open={doGrupo.length > 0 && grupos.length <= 3}>
              <summary>
                {g.nome} <span className="num">({doGrupo.length})</span>
              </summary>
              {doGrupo.length === 0 ? (
                <p className="nota">Nenhum cliente neste grupo ainda.</p>
              ) : (
                <table className="superadmin-lista">
                  <thead>
                    <tr>
                      <th>Cliente</th>
                      <th>Clínica</th>
                      <th>Status</th>
                      <th>
                        <span className="sr-apenas">Editar</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {doGrupo.map((c) => (
                      <tr key={c.id}>
                        <td data-rotulo="Cliente">{c.nome}</td>
                        <td data-rotulo="Clínica">{codigoDa(c.clinicaId) ?? <span className="muted">sem clínica</span>}</td>
                        <td data-rotulo="Status">{c.status}</td>
                        <td className="coluna-acao">
                          <button type="button" className="link" onClick={() => setEditando(c)} title={`Editar ${c.nome}`}>
                            Editar
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </details>
          )
        })
      )}

      {editando === null ? null : (
        <EdicaoDoCliente
          cliente={editando}
          grupos={grupos}
          aoFechar={() => setEditando(null)}
          aoMudouGrupos={() => {
            setTentativa((n) => n + 1)
            aoMudar('Os grupos da clínica foram atualizados.')
          }}
          aoSalvar={(c) => {
            setEditando(null)
            setTentativa((n) => n + 1)
            aoMudar(`${c.nome} foi atualizado.`)
          }}
        />
      )}
    </section>
  )
}

function EdicaoDoCliente({
  cliente,
  grupos,
  aoFechar,
  aoSalvar,
  aoMudouGrupos,
}: {
  cliente: ClienteCarteiraNoPainel
  grupos: readonly GrupoNaLista[]
  aoFechar: () => void
  aoSalvar: (c: ClienteCarteiraNoPainel) => void
  /** A clínica ganhou ou perdeu um grupo: a lista de clientes precisa reler. */
  aoMudouGrupos: () => void
}) {
  const [status, setStatus] = useState<StatusDoClienteFirmare>(cliente.status)
  const [grupoId, setGrupoId] = useState(cliente.grupoId)
  const [motivo, setMotivo] = useState('')
  const [erro, setErro] = useState('')
  const [enviando, setEnviando] = useState(false)
  const mudandoDeGrupo = grupoId !== cliente.grupoId

  async function salvar(e: React.FormEvent) {
    e.preventDefault()
    setErro('')
    const corpo: Record<string, unknown> = {}
    if (status !== cliente.status) corpo['status'] = status
    if (mudandoDeGrupo) {
      corpo['grupoId'] = grupoId
      if (motivo.trim() !== '') corpo['motivo'] = motivo.trim()
    }
    if (Object.keys(corpo).length === 0) {
      aoFechar()
      return
    }
    setEnviando(true)
    try {
      const r = await chamar<ClienteCarteiraNoPainelSaida>(`v1/superadmin/clientes-carteira/${cliente.id}`, {
        method: 'PATCH',
        body: JSON.stringify(corpo),
      })
      aoSalvar(r.cliente)
    } catch (x) {
      setErro(x instanceof ErroDaApi ? x.message : 'Sem conexão com o servidor.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <Modal titulo={`Editar ${cliente.nome}`} aoFechar={aoFechar}>
      <form onSubmit={salvar}>
        <label className="campo">
          Status
          <select value={status} onChange={(e) => setStatus(e.target.value as StatusDoClienteFirmare)}>
            {STATUS.map(([v, r]) => (
              <option key={v} value={v}>
                {r}
              </option>
            ))}
          </select>
        </label>

        {cliente.clinicaId !== null ? (
          <GruposDaClinica clinicaId={cliente.clinicaId} grupos={grupos} aoMudar={aoMudouGrupos} />
        ) : (
        <label className="campo">
          Grupo
          <select value={grupoId} onChange={(e) => setGrupoId(e.target.value)}>
            {grupos.map((g) => (
              <option key={g.id} value={g.id} disabled={!g.ativo && g.id !== cliente.grupoId}>
                {g.nome}
                {g.ativo ? '' : ' (desativado)'}
              </option>
            ))}
          </select>
        </label>
        )}

        {mudandoDeGrupo ? (
          <>
            <label className="campo">
              Motivo da mudança
              <input value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={300} />
            </label>
            <p className="nota">
              Tudo do cliente vai para o grupo novo (reuniões, metas, cobranças, parceiros), o grupo antigo deixa de
              vê-lo e o acesso do cliente ao portal precisa entrar de novo.
            </p>
          </>
        ) : null}

        <p role="alert" aria-live="polite" className="erro-do-painel">
          {erro}
        </p>

        <div className="botoes">
          <button type="submit" disabled={enviando} className="btn">
            {enviando ? 'Salvando…' : 'Salvar'}
          </button>
          <button type="button" className="btn ghost" onClick={aoFechar} disabled={enviando}>
            Cancelar
          </button>
        </div>
      </form>
    </Modal>
  )
}

/**
 * **Os grupos da clínica** (0068): uma clínica fica no Firmare e em quantos
 * outros o operador designar. Adicionar cria o Cliente Firmare do grupo (vazio);
 * remover encerra o dele e o grupo perde a leitura. O Firmare não sai.
 */
function GruposDaClinica({
  clinicaId,
  grupos,
  aoMudar,
}: {
  clinicaId: string
  grupos: readonly GrupoNaLista[]
  aoMudar: () => void
}) {
  const [atuais, setAtuais] = useState<GruposDaClinicaSaida['grupos'] | null>(null)
  const [novo, setNovo] = useState('')
  const [motivo, setMotivo] = useState('')
  const [erro, setErro] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [tentativa, setTentativa] = useState(0)

  useEffect(() => {
    let valeu = true
    chamar<GruposDaClinicaSaida>(`v1/superadmin/clinicas/${clinicaId}/grupos`)
      .then((r) => {
        if (valeu) setAtuais(r.grupos)
      })
      .catch((x: unknown) => {
        if (valeu) setErro(x instanceof ErroDaApi ? x.message : 'Sem conexão com o servidor.')
      })
    return () => {
      valeu = false
    }
  }, [clinicaId, tentativa])

  const daClinica = new Set((atuais ?? []).map((g) => g.grupoId))
  const livres = grupos.filter((g) => g.ativo && !daClinica.has(g.id))

  async function enviar(caminho: string, grupoId: string) {
    if (motivo.trim().length < 3) {
      setErro('Informe o motivo (sem dado de paciente).')
      return
    }
    setErro('')
    setEnviando(true)
    try {
      await chamar(`v1/superadmin/clinicas/${clinicaId}/grupos${caminho}`, {
        method: 'POST',
        body: JSON.stringify({ grupoId, motivo: motivo.trim() }),
      })
      setNovo('')
      setMotivo('')
      setTentativa((n) => n + 1)
      aoMudar()
    } catch (x) {
      setErro(x instanceof ErroDaApi ? x.message : 'Sem conexão com o servidor.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <fieldset className="campo">
      <legend>Grupos da clínica</legend>
      {atuais === null ? (
        <Carregando />
      ) : (
        <ul>
          {atuais.map((g) => (
            <li key={g.grupoId}>
              {g.nome}
              {g.padrao ? null : (
                <>
                  {' '}
                  <button type="button" className="link" disabled={enviando} onClick={() => enviar('/remover', g.grupoId)}>
                    Remover
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      <label className="campo">
        Motivo
        <input value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={300} />
      </label>
      {livres.length === 0 ? null : (
        <label className="campo">
          Adicionar a outro grupo
          <select value={novo} onChange={(e) => setNovo(e.target.value)}>
            <option value="">Escolha…</option>
            {livres.map((g) => (
              <option key={g.id} value={g.id}>
                {g.nome}
              </option>
            ))}
          </select>
          <button type="button" className="btn ghost" disabled={enviando || novo === ''} onClick={() => enviar('', novo)}>
            Adicionar
          </button>
        </label>
      )}
      <p className="nota">Remover tira o cliente daquele grupo; o Firmare sempre fica.</p>
      {erro === '' ? null : <p role="alert" className="erro-do-painel">{erro}</p>}
    </fieldset>
  )
}
