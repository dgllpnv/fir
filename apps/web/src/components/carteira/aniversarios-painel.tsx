'use client'

import type { AniversarioNaLista, ListaDeAniversariosSaida, MeuAniversarioSaida, ParabenizarSaida } from '@fir/contracts'
import { useEffect, useState } from 'react'
import { chamar, ErroDaApi } from '@/lib/api'
import { diaMes } from './rotina-pecas'

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']

const quando = (a: AniversarioNaLista): string =>
  a.emDias === 0 ? 'Hoje' : a.emDias === 1 ? 'Amanhã' : `Em ${a.emDias} dias · ${diaMes(a.data)}`

/**
 * Aniversários de hoje e dos próximos 7 dias (`painelAniversarios`, L1910).
 * Sem idade (LGPD A46) e sem telefone na tela (A45): o "Parabenizar" pede o
 * link ao servidor no clique e abre o WhatsApp. Some quando não há ninguém,
 * como no protótipo — mas "Meu aniversário" continua acessível embaixo.
 */
export function PainelDeAniversarios() {
  const [lista, setLista] = useState<AniversarioNaLista[] | null>(null)
  const [erro, setErro] = useState('')
  const [tentativa, setTentativa] = useState(0)

  useEffect(() => {
    let valeu = true
    chamar<ListaDeAniversariosSaida>('v1/carteira/aniversarios')
      .then((r) => {
        if (valeu) setLista(r.aniversarios)
      })
      .catch(() => {
        if (valeu) setLista([])
      })
    return () => {
      valeu = false
    }
  }, [tentativa])

  async function parabenizar(a: AniversarioNaLista) {
    setErro('')
    try {
      const r = await chamar<ParabenizarSaida>('v1/carteira/aniversarios/parabenizar', {
        method: 'POST',
        body: JSON.stringify({ tipo: a.tipo, id: a.id }),
      })
      window.open(r.url, '_blank', 'noopener')
    } catch (e) {
      setErro(e instanceof ErroDaApi ? e.message : 'Não foi possível abrir o WhatsApp.')
    }
  }

  return (
    <>
      {lista !== null && lista.length > 0 ? (
        <section className="rot-int-painel-aniv" aria-label="Aniversários">
          <div className="rot-int-painel-cabeca">
            <h2 className="carteira-secao-titulo">Aniversários</h2>
            <span className="nota">Hoje e nos próximos 7 dias</span>
          </div>
          <ul className="rot-int-aniv">
            {lista.map((a) => (
              <li key={`${a.tipo}-${a.id}`} className="rot-int-aniv-linha">
                <span className="rot-int-aniv-nome">
                  {a.nome} <span className="nota">· {a.sub}</span>
                </span>
                <span className="rot-int-aniv-acoes">
                  <span className={a.emDias === 0 ? 'pill rot-int-hoje num' : 'pill num'}>{quando(a)}</span>
                  {a.podeParabenizar ? (
                    <button type="button" className="btn ghost" onClick={() => void parabenizar(a)}>
                      Parabenizar
                    </button>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
          <p role="alert" aria-live="polite" className="erro">
            {erro}
          </p>
        </section>
      ) : null}
      <MeuAniversario aoSalvar={() => setTentativa((n) => n + 1)} />
    </>
  )
}

/**
 * O próprio aniversário: dia e mês, nunca o ano (A28), e a oposição simples
 * (A47) — "Mostrar para a equipe". Recolhido: é raro.
 */
function MeuAniversario({ aoSalvar }: { aoSalvar: () => void }) {
  const [form, setForm] = useState<{ dia: string; mes: string; mostrar: boolean } | null>(null)
  const [recado, setRecado] = useState('')
  const [enviando, setEnviando] = useState(false)

  useEffect(() => {
    let valeu = true
    chamar<MeuAniversarioSaida>('v1/carteira/eu/aniversario')
      .then((r) => {
        if (valeu) setForm({ dia: r.dia === null ? '' : String(r.dia), mes: r.mes === null ? '' : String(r.mes), mostrar: r.mostrar })
      })
      .catch(() => {})
    return () => {
      valeu = false
    }
  }, [])

  if (form === null) return null

  async function salvar(e: React.FormEvent) {
    e.preventDefault()
    if (form === null) return
    setRecado('')
    setEnviando(true)
    try {
      await chamar<MeuAniversarioSaida>('v1/carteira/eu/aniversario', {
        method: 'PUT',
        body: JSON.stringify({
          dia: form.dia === '' ? null : Number(form.dia),
          mes: form.mes === '' ? null : Number(form.mes),
          mostrar: form.mostrar,
        }),
      })
      setRecado('Salvo.')
      aoSalvar()
    } catch (x) {
      setRecado(x instanceof ErroDaApi ? x.message : 'Sem conexão com o servidor.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <details className="carteira-dobra carteira-dobra-mini">
      <summary>Meu aniversário</summary>
      <form className="carteira-form" onSubmit={salvar}>
        <div className="rot-int-duas">
          <label className="campo">
            Dia
            <select value={form.dia} onChange={(e) => setForm({ ...form, dia: e.target.value })}>
              <option value="">—</option>
              {Array.from({ length: 31 }, (_, i) => (
                <option key={i + 1} value={String(i + 1)}>
                  {i + 1}
                </option>
              ))}
            </select>
          </label>
          <label className="campo">
            Mês
            <select value={form.mes} onChange={(e) => setForm({ ...form, mes: e.target.value })}>
              <option value="">—</option>
              {MESES.map((m, i) => (
                <option key={m} value={String(i + 1)}>
                  {m}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="check-marcar">
          <input type="checkbox" checked={form.mostrar} onChange={(e) => setForm({ ...form, mostrar: e.target.checked })} />
          Mostrar meu aniversário para a equipe
        </label>
        <p className="nota">Só o dia e o mês. O ano não é pedido.</p>
        <p role="status" aria-live="polite" className="nota">
          {recado}
        </p>
        <button type="submit" className="btn" disabled={enviando}>
          {enviando ? 'Salvando…' : 'Salvar'}
        </button>
      </form>
    </details>
  )
}
