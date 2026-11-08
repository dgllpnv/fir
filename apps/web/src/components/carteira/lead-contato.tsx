'use client'

import type { ContatoRegistradoSaida, EtapaDoLead, LeadComercialNaLista } from '@fir/contracts'
import { CANAIS_DE_CONTATO, ETAPAS_DO_LEAD, TEMPERATURAS_DO_LEAD } from '@fir/domain'
import { useState } from 'react'
import { chamar, ErroDaApi } from '@/lib/api'
import { ROTULO_DA_ETAPA, ROTULO_DA_TEMPERATURA } from './lead-rotulos'

/**
 * "Registrar contato" (`registrarContato`, L2559-2565): data, canal, o que foi
 * conversado, etapa depois do contato, temperatura e próximo contato — uma
 * transação só no servidor.
 *
 * Os padrões (hoje, etapa sugerida, próximo contato em 5 ou 7 dias) vêm do
 * SERVIDOR (`sugestaoDeContato`, regra 24): o relógio do aparelho não decide
 * data nenhuma. A chave de idempotência nasce quando o formulário abre — o
 * duplo toque manda a mesma chave, e o servidor devolve o mesmo contato.
 */
export function RegistrarContatoDoLead({
  lead,
  hoje,
  sugestao,
  aoRegistrar,
}: {
  lead: LeadComercialNaLista
  hoje: string
  sugestao: { etapa: EtapaDoLead; proximoContato: string }
  aoRegistrar: (r: ContatoRegistradoSaida) => void
}) {
  const [chave] = useState(() => crypto.randomUUID())
  const terminal = lead.etapa === 'ganho' || lead.etapa === 'perdido'
  const [f, setF] = useState({
    data: hoje,
    canal: 'WhatsApp' as (typeof CANAIS_DE_CONTATO)[number],
    nota: '',
    etapa: terminal ? lead.etapa : sugestao.etapa,
    temperatura: lead.temperatura as string,
    proximoContato: terminal ? '' : sugestao.proximoContato,
  })
  const [erro, setErro] = useState('')
  const [enviando, setEnviando] = useState(false)

  // "Virou cliente" não está na lista (L2560): a conversão tem caminho próprio.
  const etapas = terminal ? [lead.etapa] : ETAPAS_DO_LEAD.filter((e) => e !== 'ganho')

  async function registrar(e: React.FormEvent) {
    e.preventDefault()
    setErro('')
    setEnviando(true)
    try {
      const r = await chamar<ContatoRegistradoSaida>(`v1/carteira/leads/${lead.id}/contato`, {
        method: 'POST',
        body: JSON.stringify({
          chaveIdempotencia: chave,
          data: f.data,
          canal: f.canal,
          nota: f.nota,
          etapa: f.etapa,
          temperatura: f.temperatura,
          proximoContato: f.proximoContato === '' ? null : f.proximoContato,
        }),
      })
      aoRegistrar(r)
    } catch (x) {
      setErro(x instanceof ErroDaApi ? x.message : 'Sem conexão com o servidor.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <form className="carteira-form lead-form" onSubmit={registrar}>
      <div className="lead-form-duas">
        <label className="campo">
          Data
          <input type="date" value={f.data} max={hoje} onChange={(e) => setF({ ...f, data: e.target.value })} required />
        </label>
        <label className="campo">
          Canal
          <select
            value={f.canal}
            onChange={(e) => setF({ ...f, canal: e.target.value as (typeof CANAIS_DE_CONTATO)[number] })}
          >
            {CANAIS_DE_CONTATO.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="campo">
        O que foi conversado
        <textarea rows={3} value={f.nota} onChange={(e) => setF({ ...f, nota: e.target.value })} required maxLength={2000} />
      </label>
      <div className="lead-form-duas">
        <label className="campo">
          Etapa depois do contato
          <select value={f.etapa} onChange={(e) => setF({ ...f, etapa: e.target.value as EtapaDoLead })} disabled={terminal}>
            {etapas.map((x) => (
              <option key={x} value={x}>
                {ROTULO_DA_ETAPA[x]}
              </option>
            ))}
          </select>
        </label>
        <label className="campo">
          Temperatura
          <select value={f.temperatura} onChange={(e) => setF({ ...f, temperatura: e.target.value })}>
            {TEMPERATURAS_DO_LEAD.map((t) => (
              <option key={t} value={t}>
                {ROTULO_DA_TEMPERATURA[t]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="campo">
        Próximo contato
        <input type="date" value={f.proximoContato} onChange={(e) => setF({ ...f, proximoContato: e.target.value })} />
        <small className="nota">Com data marcada, a ferramenta avisa no dia.</small>
      </label>
      <p role="alert" aria-live="polite" className="erro">
        {erro}
      </p>
      <button type="submit" className="btn" disabled={enviando}>
        {enviando ? 'Registrando…' : 'Registrar contato'}
      </button>
    </form>
  )
}

/**
 * "Marcar como perdido" (L2960): motivo obrigatório e "Tentar de novo em
 * (opcional)" — com data, o lead vai para Em espera em vez de se perder.
 */
export function MarcarLeadPerdido({
  lead,
  hoje,
  aoMarcar,
}: {
  lead: LeadComercialNaLista
  hoje: string
  aoMarcar: (lead: LeadComercialNaLista) => void
}) {
  const [motivo, setMotivo] = useState('')
  const [tentarDeNovoEm, setTentar] = useState('')
  const [erro, setErro] = useState('')
  const [enviando, setEnviando] = useState(false)

  async function marcar(e: React.FormEvent) {
    e.preventDefault()
    setErro('')
    setEnviando(true)
    try {
      const r = await chamar<{ lead: LeadComercialNaLista }>(`v1/carteira/leads/${lead.id}/perder`, {
        method: 'POST',
        body: JSON.stringify({ motivo, tentarDeNovoEm: tentarDeNovoEm === '' ? null : tentarDeNovoEm }),
      })
      aoMarcar(r.lead)
    } catch (x) {
      setErro(x instanceof ErroDaApi ? x.message : 'Sem conexão com o servidor.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <form className="carteira-form lead-form" onSubmit={marcar}>
      <label className="campo">
        Motivo
        <textarea rows={3} value={motivo} onChange={(e) => setMotivo(e.target.value)} required maxLength={500} />
      </label>
      <label className="campo">
        Tentar de novo em (opcional)
        <input type="date" value={tentarDeNovoEm} min={hoje} onChange={(e) => setTentar(e.target.value)} />
        <small className="nota">Com data, a indicação vai para Em espera e a ferramenta avisa no dia.</small>
      </label>
      <p role="alert" aria-live="polite" className="erro">
        {erro}
      </p>
      <button type="submit" className="btn lead-perigo" disabled={enviando || motivo.trim() === ''}>
        {enviando ? 'Salvando…' : tentarDeNovoEm === '' ? 'Marcar como perdido' : 'Mover para Em espera'}
      </button>
    </form>
  )
}
