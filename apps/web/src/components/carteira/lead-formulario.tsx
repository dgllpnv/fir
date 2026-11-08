'use client'

import type { EtapaDoLead, LeadComercialNaLista, PessoaDaEquipeFirmare } from '@fir/contracts'
import { ORIGENS_DO_LEAD, PRODUTOS_DE_INTERESSE, TEMPERATURAS_DO_LEAD } from '@fir/domain'
import { useState } from 'react'
import { chamar, ErroDaApi } from '@/lib/api'
import { centavosDoTexto, textoDeCentavos } from '@/lib/dinheiro-digitado'
import { ROTULO_DA_ETAPA, ROTULO_DA_TEMPERATURA } from './lead-rotulos'

const ETAPAS_DE_ENTRADA: readonly EtapaDoLead[] = ['novo', 'contato', 'reuniao', 'proposta', 'espera']

type Campos = {
  nome: string
  especialidade: string
  clinica: string
  cidade: string
  whatsapp: string
  instagram: string
  origem: string
  clienteIndicadorId: string
  indicadoPor: string
  etapa: EtapaDoLead
  temperatura: string
  produtoInteresse: string
  valorEstimado: string
  recebidaEm: string
  proximoContato: string
  responsavelUsuarioGestaoId: string
  observacoes: string
}

const camposDe = (l: LeadComercialNaLista | null, eu: string, hoje: string): Campos => ({
  nome: l?.nome ?? '',
  especialidade: l?.especialidade ?? '',
  clinica: l?.clinica ?? '',
  cidade: l?.cidade ?? '',
  whatsapp: l?.whatsapp ?? '',
  instagram: l?.instagram ?? '',
  origem: l?.origem ?? 'Indicação de cliente',
  clienteIndicadorId: l?.clienteIndicadorId ?? '',
  indicadoPor: l?.indicadoPor ?? '',
  etapa: l?.etapa ?? 'novo',
  temperatura: l?.temperatura ?? 'morno',
  produtoInteresse: l?.produtoInteresse ?? 'Acelerador FIR',
  valorEstimado: l?.valorEstimado ? textoDeCentavos(BigInt(l.valorEstimado)) : '',
  recebidaEm: l?.recebidaEm ?? hoje,
  proximoContato: l?.proximoContato ?? '',
  responsavelUsuarioGestaoId: l?.responsavelUsuarioGestaoId ?? eu,
  observacoes: l?.observacoes ?? '',
})

/** Os campos de texto que, vazios, viram `null` na edição (limpar) e somem na criação. */
const TEXTOS_OPCIONAIS = [
  'especialidade',
  'clinica',
  'cidade',
  'whatsapp',
  'instagram',
  'indicadoPor',
  'produtoInteresse',
  'proximoContato',
  'observacoes',
  'clienteIndicadorId',
  'responsavelUsuarioGestaoId',
] as const

/**
 * "Nova indicação" e "Editar" (`fLead`, L2554-2558), o mesmo formulário.
 *
 * O caminho principal cabe sem rolar (design.md §1): nome, WhatsApp, origem,
 * quem indicou e temperatura. O resto fica em "+ Mais opções".
 *
 * Na edição só vai ao servidor o que MUDOU: um campo que a tela não mostra
 * (o valor estimado de quem não vê valores) nunca é apagado por um PATCH que
 * o reenviasse vazio.
 */
export function FormularioDoLead({
  lead,
  equipe,
  clientes,
  podeVerValores,
  eu,
  hoje,
  aoSalvar,
}: {
  lead: LeadComercialNaLista | null
  equipe: readonly PessoaDaEquipeFirmare[]
  clientes: readonly { id: string; nome: string }[]
  podeVerValores: boolean
  eu: string
  hoje: string
  aoSalvar: (lead: LeadComercialNaLista) => void
}) {
  const original = camposDe(lead, eu, hoje)
  const [f, setF] = useState<Campos>(original)
  const [erro, setErro] = useState('')
  const [enviando, setEnviando] = useState(false)
  const muda = <K extends keyof Campos>(k: K, v: Campos[K]) => setF((x) => ({ ...x, [k]: v }))

  async function salvar(e: React.FormEvent) {
    e.preventDefault()
    setErro('')
    const corpo: Record<string, unknown> = {}
    const editando = lead !== null
    const mudou = (k: keyof Campos) => !editando || f[k] !== original[k]

    for (const k of ['nome', 'origem', 'temperatura', 'recebidaEm'] as const) if (mudou(k)) corpo[k] = f[k]
    for (const k of TEXTOS_OPCIONAIS) {
      if (!mudou(k)) continue
      const v = f[k].trim()
      if (v !== '') corpo[k] = v
      else if (editando) corpo[k] = null
    }
    if (!editando && f.etapa !== 'novo') corpo['etapa'] = f.etapa
    if (podeVerValores && mudou('valorEstimado')) {
      const c = centavosDoTexto(f.valorEstimado)
      if (f.valorEstimado.trim() !== '' && c === null) {
        setErro('O valor estimado não é um valor em reais.')
        return
      }
      corpo['valorEstimado'] = c === null ? null : c.toString()
    }
    if (editando && Object.keys(corpo).length === 0) {
      setErro('Nada mudou.')
      return
    }

    setEnviando(true)
    try {
      const r = await chamar<{ lead: LeadComercialNaLista }>(
        editando ? `v1/carteira/leads/${lead.id}` : 'v1/carteira/leads',
        { method: editando ? 'PATCH' : 'POST', body: JSON.stringify(corpo) },
      )
      aoSalvar(r.lead)
    } catch (x) {
      setErro(x instanceof ErroDaApi ? x.message : 'Sem conexão com o servidor.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <form className="carteira-form lead-form" onSubmit={salvar}>
      <label className="campo">
        Nome do médico
        <input value={f.nome} onChange={(e) => muda('nome', e.target.value)} required maxLength={160} />
      </label>
      <label className="campo">
        WhatsApp
        <input type="tel" inputMode="tel" value={f.whatsapp} onChange={(e) => muda('whatsapp', e.target.value)} maxLength={40} />
      </label>
      <label className="campo">
        Origem
        <select value={f.origem} onChange={(e) => muda('origem', e.target.value)}>
          {(ORIGENS_DO_LEAD as readonly string[]).includes(f.origem) ? null : <option value={f.origem}>{f.origem}</option>}
          {ORIGENS_DO_LEAD.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      </label>
      <label className="campo">
        Indicado por cliente da carteira
        <select value={f.clienteIndicadorId} onChange={(e) => muda('clienteIndicadorId', e.target.value)}>
          <option value="">Não foi cliente</option>
          {clientes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nome}
            </option>
          ))}
        </select>
        <small className="nota">Indicações de clientes entram no ranking e geram o benefício quando viram contrato.</small>
      </label>
      {f.clienteIndicadorId === '' ? (
        <label className="campo">
          Quem indicou, se não foi cliente (parceiro, amigo, evento)
          <input value={f.indicadoPor} onChange={(e) => muda('indicadoPor', e.target.value)} maxLength={160} />
        </label>
      ) : null}
      <label className="campo">
        Temperatura
        <select value={f.temperatura} onChange={(e) => muda('temperatura', e.target.value)}>
          {TEMPERATURAS_DO_LEAD.map((t) => (
            <option key={t} value={t}>
              {ROTULO_DA_TEMPERATURA[t]}
            </option>
          ))}
        </select>
      </label>

      <details className="carteira-dobra carteira-dobra-mini">
        <summary>+ Mais opções</summary>
        <div className="carteira-form lead-form-duas">
          <label className="campo">
            Especialidade
            <input value={f.especialidade} onChange={(e) => muda('especialidade', e.target.value)} maxLength={120} />
          </label>
          <label className="campo">
            Clínica
            <input value={f.clinica} onChange={(e) => muda('clinica', e.target.value)} maxLength={160} />
          </label>
          <label className="campo">
            Cidade
            <input value={f.cidade} onChange={(e) => muda('cidade', e.target.value)} maxLength={120} />
          </label>
          <label className="campo">
            Instagram
            <input value={f.instagram} onChange={(e) => muda('instagram', e.target.value)} maxLength={80} />
          </label>
          {lead === null ? (
            <label className="campo">
              Etapa
              <select value={f.etapa} onChange={(e) => muda('etapa', e.target.value as EtapaDoLead)}>
                {ETAPAS_DE_ENTRADA.map((x) => (
                  <option key={x} value={x}>
                    {ROTULO_DA_ETAPA[x]}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label className="campo">
            Produto de interesse
            <select value={f.produtoInteresse} onChange={(e) => muda('produtoInteresse', e.target.value)}>
              <option value="">—</option>
              {(PRODUTOS_DE_INTERESSE as readonly string[]).includes(f.produtoInteresse) || f.produtoInteresse === '' ? null : (
                <option value={f.produtoInteresse}>{f.produtoInteresse}</option>
              )}
              {PRODUTOS_DE_INTERESSE.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
          {podeVerValores ? (
            <label className="campo">
              Valor estimado por mês (R$)
              <input inputMode="decimal" value={f.valorEstimado} onChange={(e) => muda('valorEstimado', e.target.value)} />
            </label>
          ) : null}
          <label className="campo">
            Indicação recebida em
            <input type="date" value={f.recebidaEm} max={hoje} onChange={(e) => muda('recebidaEm', e.target.value)} required />
          </label>
          <label className="campo">
            Próximo contato combinado
            <input type="date" value={f.proximoContato} onChange={(e) => muda('proximoContato', e.target.value)} />
          </label>
          <label className="campo">
            Responsável
            <select
              value={f.responsavelUsuarioGestaoId}
              onChange={(e) => muda('responsavelUsuarioGestaoId', e.target.value)}
            >
              <option value="">Sem responsável</option>
              {equipe.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nome}
                </option>
              ))}
            </select>
          </label>
          <label className="campo lead-form-inteira">
            Observações
            <textarea rows={3} value={f.observacoes} onChange={(e) => muda('observacoes', e.target.value)} maxLength={2000} />
          </label>
        </div>
      </details>

      <p role="alert" aria-live="polite" className="erro">
        {erro}
      </p>
      <button type="submit" className="btn" disabled={enviando}>
        {enviando ? 'Salvando…' : lead === null ? 'Registrar indicação' : 'Salvar'}
      </button>
    </form>
  )
}
