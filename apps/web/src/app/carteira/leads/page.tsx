'use client'

import type { LeadComercialNaLista, EtapaDoLead, ListaDeLeadsSaida } from '@fir/contracts'
import { ETAPAS_DO_LEAD, ETAPAS_TERMINAIS_DO_LEAD, TEMPERATURAS_DO_LEAD } from '@fir/domain'
import { useEffect, useRef, useState } from 'react'
import { Carregando, Toast, Vazio } from '@/components/estados'
import { chamar, ErroDaApi } from '@/lib/api'
import { useCarteira } from '../contexto'
import { ErroDaCarteira, NavDaCarteira } from '../pecas'

/**
 * **O FUNIL DE PROSPECÇÃO** — `docs/superpowers/plans/g5-spec-rotina-interna-funil.md`,
 * ADR 0016.
 *
 * `novo → contato → reuniao → proposta → espera` são passos livres (spec
 * §2.2: "não é uma máquina de estados rígida como a `Jornada` clínica") — o
 * servidor só fecha as duas bordas que são negócio de verdade: uma etapa
 * terminal nunca tem saída, e `perdido` exige motivo. A tela oferece um
 * caminho de UM toque para o avanço natural (`PROXIMA_ETAPA`) e recolhe o
 * resto ("Mudar etapa") atrás de um `<details>` — `design.md` §1.
 *
 * Nunca rola na horizontal: cada etapa é uma SEÇÃO empilhada, não uma coluna
 * de kanban lado a lado — a mesma regra que proíbe o Kanban da `Jornada`
 * clínica de ser a única forma em 390 px (`rotina.css`, `.etapas-lista`).
 */

const RECADO_ETAPA: Record<EtapaDoLead, string> = {
  novo: 'Novo',
  contato: 'Em contato',
  reuniao: 'Reunião marcada',
  proposta: 'Proposta enviada',
  espera: 'Aguardando o prospect',
  ganho: 'Ganho',
  perdido: 'Perdido',
}

const PROXIMA_ETAPA: Partial<Record<EtapaDoLead, EtapaDoLead>> = {
  novo: 'contato',
  contato: 'reuniao',
  reuniao: 'proposta',
  proposta: 'espera',
  espera: 'ganho',
}

const RECADO_TEMPERATURA: Record<string, string> = {
  frio: 'Frio',
  morno: 'Morno',
  quente: 'Quente',
}

const ETAPAS_ATIVAS = ETAPAS_DO_LEAD.filter((e) => !ETAPAS_TERMINAIS_DO_LEAD.includes(e))

type Estado =
  | { tag: 'carregando' }
  | { tag: 'erro'; mensagem: string }
  | { tag: 'pronto'; itens: LeadComercialNaLista[] }

export default function LeadsDaCarteira() {
  const { sessao } = useCarteira()
  const [estado, setEstado] = useState<Estado>({ tag: 'carregando' })
  const [tentativa, setTentativa] = useState(0)
  const [recado, setRecado] = useState<string | null>(null)
  const dobraCriar = useRef<HTMLDetailsElement>(null)

  useEffect(() => {
    if (sessao.tag !== 'pronta') return
    let valeu = true
    setEstado({ tag: 'carregando' })
    void (async () => {
      try {
        const r = await chamar<ListaDeLeadsSaida>('v1/carteira/leads')
        if (valeu) setEstado({ tag: 'pronto', itens: r.leads })
      } catch (e) {
        if (valeu) {
          setEstado({
            tag: 'erro',
            mensagem: e instanceof ErroDaApi ? e.message : 'Não foi possível carregar os leads.',
          })
        }
      }
    })()
    return () => {
      valeu = false
    }
  }, [sessao.tag, tentativa])

  const recarregar = () => setTentativa((n) => n + 1)

  const atualizarLead = (lead: LeadComercialNaLista) => {
    setEstado((e) =>
      e.tag === 'pronto' ? { tag: 'pronto', itens: e.itens.map((l) => (l.id === lead.id ? lead : l)) } : e,
    )
  }

  if (sessao.tag !== 'pronta' || estado.tag === 'carregando') {
    return (
      <section>
        <NavDaCarteira atual="/carteira/leads" />
        <h1 className="titulo">Leads</h1>
        <Carregando linhas={4} />
      </section>
    )
  }

  if (estado.tag === 'erro') {
    return (
      <section>
        <NavDaCarteira atual="/carteira/leads" />
        <h1 className="titulo">Leads</h1>
        <ErroDaCarteira mensagem={estado.mensagem} recarregar={recarregar} />
      </section>
    )
  }

  const porEtapa = (etapa: EtapaDoLead) => estado.itens.filter((l) => l.etapa === etapa)
  const fechados = estado.itens.filter((l) => ETAPAS_TERMINAIS_DO_LEAD.includes(l.etapa))

  return (
    <section>
      <NavDaCarteira atual="/carteira/leads" />
      <h1 className="titulo">Leads</h1>
      <p className="nota">
        O funil de prospecção da Firmare. Fechar um lead como <b>ganho</b> cria o{' '}
        <b>Cliente Firmare</b> dele automaticamente.
      </p>

      {estado.itens.length === 0 ? (
        <Vazio>
          <b>Nenhum lead ainda.</b>
          <p className="nota">Crie o primeiro lead para começar a acompanhar o funil.</p>
          <button
            type="button"
            className="btn"
            onClick={() => {
              if (dobraCriar.current !== null) dobraCriar.current.open = true
            }}
          >
            Criar o primeiro lead
          </button>
        </Vazio>
      ) : (
        <div className="carteira-grade">
          {ETAPAS_ATIVAS.map((etapa) => {
            const itens = porEtapa(etapa)
            if (itens.length === 0) return null
            return (
              <div key={etapa} className="carteira-etapa">
                <div className="carteira-etapa-cabeca">
                  <h2>{RECADO_ETAPA[etapa]}</h2>
                  <span className="pill num">{itens.length}</span>
                </div>
                {itens.map((lead) => (
                  <CartaoDeLead key={lead.id} lead={lead} aoAtualizar={atualizarLead} aoAvisar={setRecado} />
                ))}
              </div>
            )
          })}

          {fechados.length > 0 ? (
            <details className="carteira-dobra">
              <summary>
                Fechados <span className="pill num">{fechados.length}</span>
              </summary>
              {fechados.map((lead) => (
                <CartaoDeLead key={lead.id} lead={lead} aoAtualizar={atualizarLead} aoAvisar={setRecado} />
              ))}
            </details>
          ) : null}
        </div>
      )}

      <FormularioDeLead
        dobra={dobraCriar}
        aoCriar={(lead) => {
          setEstado((e) => (e.tag === 'pronto' ? { tag: 'pronto', itens: [lead, ...e.itens] } : e))
          setRecado(`Lead ${lead.nome} criado.`)
        }}
      />

      <Toast recado={recado} aoFechar={() => setRecado(null)} />
    </section>
  )
}

function CartaoDeLead({
  lead,
  aoAtualizar,
  aoAvisar,
}: {
  lead: LeadComercialNaLista
  aoAtualizar: (lead: LeadComercialNaLista) => void
  aoAvisar: (recado: string) => void
}) {
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState('')
  const [arquivando, setArquivando] = useState(false)
  const [etapaEscolhida, setEtapaEscolhida] = useState<EtapaDoLead>(lead.etapa)
  const [motivoPerda, setMotivoPerda] = useState('')
  const terminal = ETAPAS_TERMINAIS_DO_LEAD.includes(lead.etapa)
  const proxima = PROXIMA_ETAPA[lead.etapa]

  async function mudarEtapa(etapa: EtapaDoLead, motivo?: string) {
    setErro('')
    setEnviando(true)
    try {
      const r = await chamar<{ lead: LeadComercialNaLista }>(`v1/carteira/leads/${lead.id}/etapa`, {
        method: 'POST',
        body: JSON.stringify({ etapa, motivoPerda: motivo }),
      })
      aoAtualizar(r.lead)
      aoAvisar(
        etapa === 'ganho'
          ? `${lead.nome} fechou — Cliente Firmare criado.`
          : `${lead.nome} movido para ${RECADO_ETAPA[etapa]}.`,
      )
    } catch (e) {
      setErro(e instanceof ErroDaApi ? e.message : 'Não foi possível mudar a etapa.')
    } finally {
      setEnviando(false)
    }
  }

  async function arquivar() {
    setErro('')
    setEnviando(true)
    try {
      const r = await chamar<{ lead: LeadComercialNaLista }>(`v1/carteira/leads/${lead.id}/arquivar`, {
        method: 'POST',
      })
      aoAtualizar(r.lead)
      aoAvisar(`${lead.nome} arquivado.`)
      setArquivando(false)
    } catch (e) {
      setErro(e instanceof ErroDaApi ? e.message : 'Não foi possível arquivar.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className="carteira-card carteira-card-coluna">
      <div className="carteira-linha">
        <span className="carteira-nome">{lead.nome}</span>
        <span className="pill">{RECADO_TEMPERATURA[lead.temperatura] ?? lead.temperatura}</span>
        {terminal ? <span className={`pill ${lead.etapa === 'ganho' ? 'bom' : 'mau'}`}>{RECADO_ETAPA[lead.etapa]}</span> : null}
      </div>
      <div className="carteira-linha muted">
        <span>{lead.origem}</span>
        {lead.produtoInteresse ? <span>· {lead.produtoInteresse}</span> : null}
        {lead.proximoContato ? <span className="num">Próximo contato: {lead.proximoContato}</span> : null}
      </div>
      {lead.etapa === 'perdido' && lead.motivoPerda ? <p className="nota">Motivo: {lead.motivoPerda}</p> : null}
      {lead.etapa === 'ganho' && lead.clienteCarteiraId ? (
        <p className="nota">
          Convertido em Cliente Firmare —{' '}
          <a className="link" href="/carteira/clientes">
            ver em Clientes
          </a>
        </p>
      ) : null}

      <p role="alert" aria-live="polite" className="erro">
        {erro}
      </p>

      {!terminal ? (
        <div className="carteira-acoes">
          {proxima ? (
            <button type="button" className="btn" disabled={enviando} onClick={() => void mudarEtapa(proxima)}>
              {enviando ? 'Movendo…' : `Mover para ${RECADO_ETAPA[proxima]}`}
            </button>
          ) : null}

          <details className="carteira-dobra carteira-dobra-mini">
            <summary>Mudar etapa</summary>
            <div className="carteira-form">
              <label className="campo">
                Nova etapa
                <select value={etapaEscolhida} onChange={(e) => setEtapaEscolhida(e.target.value as EtapaDoLead)}>
                  {ETAPAS_DO_LEAD.filter((e) => e !== lead.etapa).map((e) => (
                    <option key={e} value={e}>
                      {RECADO_ETAPA[e]}
                    </option>
                  ))}
                </select>
              </label>
              {etapaEscolhida === 'perdido' ? (
                <label className="campo">
                  Motivo da perda
                  <input value={motivoPerda} onChange={(e) => setMotivoPerda(e.target.value)} required />
                </label>
              ) : null}
              <button
                type="button"
                className="btn"
                disabled={enviando || (etapaEscolhida === 'perdido' && motivoPerda.trim() === '')}
                onClick={() => void mudarEtapa(etapaEscolhida, motivoPerda || undefined)}
              >
                {enviando ? 'Movendo…' : 'Confirmar'}
              </button>
            </div>
          </details>
        </div>
      ) : null}

      {/*
       * "ARQUIVAR" NUNCA FICA ATRÁS DO `!terminal` — um lead `perdido` É
       * terminal e continua arquivável (spec §2.4): é exatamente o jeito de
       * tirar da seção "Fechados" um prospect morto que não interessa mais
       * acompanhar. Só um lead JÁ CONVERTIDO (`clienteCarteiraId`
       * preenchido — sempre um `ganho`) nunca mostra a ação: o servidor
       * recusaria (`LeadConvertidoNaoArquiva`), e um botão que sempre falha
       * não deveria existir.
       */}
      {lead.clienteCarteiraId === null ? (
        <div className="carteira-acoes">
          {arquivando ? (
            <span className="carteira-confirmar">
              Arquivar este lead?
              <button type="button" className="btn ghost" disabled={enviando} onClick={() => void arquivar()}>
                {enviando ? 'Arquivando…' : 'Confirmar'}
              </button>
              <button type="button" className="link" disabled={enviando} onClick={() => setArquivando(false)}>
                Cancelar
              </button>
            </span>
          ) : (
            <button type="button" className="link" onClick={() => setArquivando(true)}>
              Arquivar
            </button>
          )}
        </div>
      ) : null}
    </div>
  )
}

function FormularioDeLead({
  dobra,
  aoCriar,
}: {
  dobra: React.RefObject<HTMLDetailsElement | null>
  aoCriar: (lead: LeadComercialNaLista) => void
}) {
  const [erro, setErro] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [form, setForm] = useState({
    nome: '',
    origem: '',
    temperatura: 'morno' as (typeof TEMPERATURAS_DO_LEAD)[number],
    produtoInteresse: '',
    proximoContato: '',
  })

  async function criar(e: React.FormEvent) {
    e.preventDefault()
    setErro('')
    setEnviando(true)
    try {
      const r = await chamar<{ lead: LeadComercialNaLista }>('v1/carteira/leads', {
        method: 'POST',
        body: JSON.stringify({
          nome: form.nome,
          origem: form.origem,
          temperatura: form.temperatura,
          produtoInteresse: form.produtoInteresse || undefined,
          proximoContato: form.proximoContato || undefined,
        }),
      })
      aoCriar(r.lead)
      setForm({ nome: '', origem: '', temperatura: 'morno', produtoInteresse: '', proximoContato: '' })
      if (dobra.current !== null) dobra.current.open = false
    } catch (x) {
      setErro(x instanceof ErroDaApi ? x.message : 'Sem conexão com o servidor.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <details className="carteira-dobra" ref={dobra}>
      <summary>Criar lead</summary>
      <form className="carteira-form" onSubmit={criar}>
        <label className="campo">
          Nome
          <input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} required />
        </label>

        <label className="campo">
          Origem
          <input
            value={form.origem}
            onChange={(e) => setForm({ ...form, origem: e.target.value })}
            placeholder="indicação, evento, site…"
            required
          />
        </label>

        <label className="campo">
          Temperatura
          <select
            value={form.temperatura}
            onChange={(e) =>
              setForm({ ...form, temperatura: e.target.value as (typeof TEMPERATURAS_DO_LEAD)[number] })
            }
          >
            {TEMPERATURAS_DO_LEAD.map((t) => (
              <option key={t} value={t}>
                {RECADO_TEMPERATURA[t]}
              </option>
            ))}
          </select>
        </label>

        <details className="carteira-dobra carteira-dobra-mini">
          <summary>+ Mais opções</summary>
          <div className="carteira-form">
            <label className="campo">
              Produto de interesse
              <input
                value={form.produtoInteresse}
                onChange={(e) => setForm({ ...form, produtoInteresse: e.target.value })}
              />
            </label>
            <label className="campo">
              Próximo contato
              <input
                type="date"
                value={form.proximoContato}
                onChange={(e) => setForm({ ...form, proximoContato: e.target.value })}
              />
            </label>
          </div>
        </details>

        <p role="alert" aria-live="polite" className="erro">
          {erro}
        </p>

        <button type="submit" disabled={enviando} className="btn">
          {enviando ? 'Criando…' : 'Criar lead'}
        </button>
      </form>
    </details>
  )
}
