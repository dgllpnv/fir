'use client'

import type { ChecklistAplicadoSaida, ChecklistDoClienteSaida, ItemDoChecklistDoCliente } from '@fir/contracts'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { Carregando, Toast } from '@/components/estados'
import { chamar, ErroDaApi } from '@/lib/api'

/**
 * **A ABA CHECKLIST DA FICHA** (V15, `cChecklist`, `index.html` L2620–2632)
 * e o **progresso na visão geral** (V3, `progChecklist`, L2613–2619), prontos
 * para a ficha em abas montar: `<ChecklistDoCliente clienteId=… />` e
 * `<ProgressoDoChecklist clienteId=… aoAbrir=… />`.
 *
 * Nada é calculado aqui: total, concluídos, atrasados e o próximo item vêm do
 * servidor (`progressoDoChecklist`, `packages/domain`). A barra é um
 * `<progress>` com os dois números do servidor — sem conta na tela.
 *
 * Marcar aqui conclui a tarefa na Rotina também: o status é um só, o da
 * tarefa (L2631).
 */

type Estado = { tag: 'carregando' } | { tag: 'erro'; mensagem: string } | { tag: 'pronto'; dados: ChecklistDoClienteSaida }

const dm = (dia: string): string => `${dia.slice(8, 10)}/${dia.slice(5, 7)}`

function useChecklist(clienteId: string, tentativa: number): Estado {
  const [estado, setEstado] = useState<Estado>({ tag: 'carregando' })
  useEffect(() => {
    let valeu = true
    void (async () => {
      try {
        const dados = await chamar<ChecklistDoClienteSaida>(`v1/carteira/clientes/${clienteId}/checklist`)
        if (valeu) setEstado({ tag: 'pronto', dados })
      } catch (e) {
        if (valeu) {
          setEstado({ tag: 'erro', mensagem: e instanceof ErroDaApi ? e.message : 'Não foi possível carregar o checklist.' })
        }
      }
    })()
    return () => {
      valeu = false
    }
  }, [clienteId, tentativa])
  return estado
}

function ErroComSaida({ mensagem, recarregar }: { mensagem: string; recarregar: () => void }) {
  return (
    <div className="erro-de-tela" role="alert">
      <p>{mensagem}</p>
      <button type="button" className="btn ghost" onClick={recarregar}>
        Recarregar
      </button>
    </div>
  )
}

export function ChecklistDoCliente({ clienteId }: { clienteId: string }) {
  const [tentativa, setTentativa] = useState(0)
  const [recado, setRecado] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState<string | null>(null)
  const estado = useChecklist(clienteId, tentativa)

  if (estado.tag === 'carregando') return <Carregando linhas={5} />
  if (estado.tag === 'erro') return <ErroComSaida mensagem={estado.mensagem} recarregar={() => setTentativa((n) => n + 1)} />

  const d = estado.dados
  const gerar = async () => {
    setOcupado('gerar')
    try {
      const r = await chamar<ChecklistAplicadoSaida>(`v1/carteira/clientes/${clienteId}/checklist`, {
        method: 'POST',
        body: JSON.stringify({ origem: 'gerar' }),
      })
      setRecado(r.recado)
      setTentativa((n) => n + 1)
    } catch (e) {
      setRecado(e instanceof ErroDaApi ? e.message : 'Não foi possível gerar o checklist.')
    } finally {
      setOcupado(null)
    }
  }
  const alternar = async (item: ItemDoChecklistDoCliente) => {
    setOcupado(item.id)
    const acao = item.status === 'concluida' ? 'reabrir' : 'concluir'
    try {
      await chamar<void>(`v1/carteira/clientes/${clienteId}/checklist/${item.id}/${acao}`, { method: 'POST' })
      setRecado(acao === 'concluir' ? 'Item concluído' : 'Item reaberto')
      setTentativa((n) => n + 1)
    } catch (e) {
      setRecado(e instanceof ErroDaApi ? e.message : 'Não foi possível mudar o item.')
    } finally {
      setOcupado(null)
    }
  }

  return (
    <section className="check-painel" aria-labelledby="check-titulo">
      <div className="check-cabeca">
        <h2 id="check-titulo" className="check-titulo">
          Checklist do contrato · {d.modelo.rotulo}
        </h2>
        {!d.geradoParaOModelo && d.modelo.existe ? (
          <button type="button" className="btn" disabled={ocupado !== null} onClick={() => void gerar()}>
            Gerar checklist de {d.modelo.rotulo}
          </button>
        ) : (
          <span className="check-mudo num">
            {d.progresso.concluidos} de {d.progresso.total} concluídos
          </span>
        )}
      </div>

      {d.itens.length > 0 ? (
        <>
          <progress
            className="check-barra"
            value={d.progresso.concluidos}
            max={d.progresso.total}
            aria-label={`${d.progresso.concluidos} de ${d.progresso.total} concluídos`}
          />
          <ul className="check-lista">
            {d.itens.map((t) => {
              const feito = t.status === 'concluida'
              const atrasado = t.status === 'pendente' && t.prazo < d.hoje
              return (
                <li key={t.id} className={feito ? 'check-item check-feito' : 'check-item'}>
                  <button
                    type="button"
                    className="check-marca"
                    aria-pressed={feito}
                    aria-label={feito ? `Reabrir: ${t.titulo}` : `Concluir: ${t.titulo}`}
                    disabled={ocupado !== null || t.status === 'cancelada'}
                    onClick={() => void alternar(t)}
                  />
                  <div className="check-corpo">
                    <span className="check-item-titulo">{t.titulo}</span>
                    <span className="check-meta">
                      <span>{t.responsavel?.nome ?? 'Sem responsável'}</span>
                      <span className="num">D+{t.dias}</span>
                      {t.acao === 'diagnostico' && !feito ? (
                        <Link className="link" href="/carteira/metodo/roteiros">
                          Abrir roteiro de briefing
                        </Link>
                      ) : null}
                      {feito && t.concluidaNoDia ? <span className="num">concluído em {dm(t.concluidaNoDia)}</span> : null}
                      {t.status === 'cancelada' ? <span>cancelada na rotina</span> : null}
                    </span>
                  </div>
                  <span className={atrasado ? 'check-prazo check-atrasado num' : 'check-prazo num'}>{dm(t.prazo)}</span>
                </li>
              )
            })}
          </ul>
        </>
      ) : (
        <p className="check-vazio">
          {d.modelo.existe
            ? 'Este cliente ainda não tem checklist. Gere acima: cada item vira uma tarefa na Rotina.'
            : 'Não há checklist cadastrado para este tipo de contrato. Monte em Método Firmare, na aba Checklists.'}
        </p>
      )}
      <p className="check-mudo">Cada item é também uma tarefa na Rotina da equipe. Marcar aqui ou lá conclui nos dois lugares.</p>
      <Toast recado={recado} aoFechar={() => setRecado(null)} />
    </section>
  )
}

/** V3: "Checklist Acelerador FIR · 2 atrasados · 8 de 27", a barra e o próximo item. */
export function ProgressoDoChecklist({ clienteId, aoAbrir }: { clienteId: string; aoAbrir: () => void }) {
  const [tentativa, setTentativa] = useState(0)
  const estado = useChecklist(clienteId, tentativa)
  if (estado.tag === 'carregando') return <Carregando linhas={1} fino />
  if (estado.tag === 'erro') return <ErroComSaida mensagem={estado.mensagem} recarregar={() => setTentativa((n) => n + 1)} />
  const d = estado.dados
  if (d.itens.length === 0) return null
  const proximo = d.itens.find((i) => i.id === d.progresso.proximoId)
  return (
    <div className="check-progresso">
      <div className="check-progresso-linha">
        <span className="check-mudo">
          Checklist {d.modelo.rotulo}
          {d.progresso.atrasados > 0 ? <span className="check-atrasado"> · {d.progresso.atrasados} atrasados</span> : null}
        </span>
        <button type="button" className="link num" onClick={aoAbrir}>
          {d.progresso.concluidos} de {d.progresso.total}
        </button>
      </div>
      <progress className="check-barra" value={d.progresso.concluidos} max={d.progresso.total} aria-hidden="true" />
      {proximo ? (
        <span className="check-mudo">
          Próximo: <b className="check-proximo">{proximo.titulo}</b> · {proximo.responsavel?.nome ?? 'sem responsável'} ·{' '}
          <span className="num">{dm(proximo.prazo)}</span>
        </span>
      ) : null}
    </div>
  )
}
