'use client'

import type { CheckinInternoNaLista, ClienteCarteiraNaLista, ListaDeCheckinsInternosSaida } from '@fir/contracts'
import { SAUDES_DO_CLIENTE } from '@fir/domain'
import { useEffect, useState } from 'react'
import { chamar, ErroDaApi } from '@/lib/api'

type SaudeDoCliente = CheckinInternoNaLista['saude']

const RECADO_SAUDE: Record<SaudeDoCliente, string> = {
  bom: 'Bem',
  atencao: 'Atenção',
  critico: 'Crítico',
}

/**
 * **CHECKIN INTERNO** — qualitativo (spec §4): nota + leitura de saúde, sem
 * número de meta. Um por cliente por semana (o servidor resolve a semana —
 * regra 24, nunca o relógio do cliente); reenviar na mesma semana
 * ATUALIZA o checkin existente, não duplica.
 */
export function CheckinDoCliente({
  clientes,
  aoAvisar,
}: {
  clientes: ClienteCarteiraNaLista[]
  aoAvisar: (recado: string) => void
}) {
  const [clienteId, setClienteId] = useState('')
  const [nota, setNota] = useState('')
  const [saude, setSaude] = useState<SaudeDoCliente>('bom')
  const [erro, setErro] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [historico, setHistorico] = useState<CheckinInternoNaLista[] | null>(null)

  useEffect(() => {
    if (clienteId === '') {
      setHistorico(null)
      return
    }
    let valeu = true
    chamar<ListaDeCheckinsInternosSaida>(`v1/carteira/clientes/${clienteId}/checkins`)
      .then((r) => {
        if (valeu) setHistorico(r.checkins)
      })
      .catch(() => {
        if (valeu) setHistorico(null)
      })
    return () => {
      valeu = false
    }
  }, [clienteId])

  async function registrar(e: React.FormEvent) {
    e.preventDefault()
    setErro('')
    setEnviando(true)
    try {
      await chamar<{ checkin: CheckinInternoNaLista }>('v1/carteira/checkins-internos', {
        method: 'POST',
        body: JSON.stringify({ clienteCarteiraId: clienteId, nota, saude }),
      })
      aoAvisar('Checkin registrado.')
      setNota('')
    } catch (x) {
      setErro(x instanceof ErroDaApi ? x.message : 'Sem conexão com o servidor.')
    } finally {
      setEnviando(false)
    }
  }

  const pillDaSaude = (s: SaudeDoCliente): string =>
    s === 'bom' ? 'pill bom' : s === 'critico' ? 'pill mau' : 'pill alerta'

  return (
    <section className="carteira-secao">
      <h2 className="carteira-secao-titulo">Checkin da semana</h2>
      <p className="nota">
        O ritual de olhar para cada cliente — nota e uma leitura de saúde, sem número de meta.
      </p>

      {clientes.length === 0 ? (
        <p className="nota">Nenhum cliente visível ainda para registrar um checkin.</p>
      ) : (
        <form className="carteira-form" onSubmit={registrar}>
          <label className="campo">
            Cliente
            <select value={clienteId} onChange={(e) => setClienteId(e.target.value)} required>
              <option value="" disabled>
                Escolha o cliente
              </option>
              {clientes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                </option>
              ))}
            </select>
          </label>

          {historico !== null && historico.length > 0 ? (
            <p className="nota">
              Último checkin ({historico[0]!.semana}):{' '}
              <span className={pillDaSaude(historico[0]!.saude)}>{RECADO_SAUDE[historico[0]!.saude]}</span>
            </p>
          ) : null}

          <label className="campo">
            Nota
            <textarea value={nota} onChange={(e) => setNota(e.target.value)} rows={3} required />
          </label>

          <label className="campo">
            Saúde do cliente
            <select value={saude} onChange={(e) => setSaude(e.target.value as SaudeDoCliente)}>
              {SAUDES_DO_CLIENTE.map((s) => (
                <option key={s} value={s}>
                  {RECADO_SAUDE[s]}
                </option>
              ))}
            </select>
          </label>

          <p role="alert" aria-live="polite" className="erro">
            {erro}
          </p>

          <button type="submit" disabled={enviando || clienteId === ''} className="btn">
            {enviando ? 'Registrando…' : 'Registrar checkin'}
          </button>
        </form>
      )}
    </section>
  )
}
