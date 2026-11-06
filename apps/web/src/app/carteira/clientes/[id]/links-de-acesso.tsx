'use client'

import type { ClienteCarteiraNaLista, LinksDeAcessoDoClienteAtualizadosSaida } from '@fir/contracts'
import { useState } from 'react'
import { chamar, ErroDaApi } from '@/lib/api'

/**
 * OS 4 LINKS DE ACESSO do `Cliente Firmare` (migration 0036, spec G6 §3.1
 * item 7, `fg-portal.js:116-117`) — editados aqui pelo `Usuário de Gestão`,
 * mostrados no Portal do Grupo (`portal/clientes/page.tsx`).
 *
 * **Arquivo separado de propósito**, mesmo racional de `acesso-do-portal.tsx`:
 * a ficha do cliente (`clientes/[id]/page.tsx`) está sendo editada por outra
 * frente (formulários de indicador/meta/cobrança) no mesmo momento. Um
 * componente à parte, importado com uma única linha, evita que as duas
 * frentes resolvam o mesmo arquivo ao mesmo tempo.
 *
 * **Campo raro, recolhido por padrão** — mesma regra de design.md §1 e do
 * racional de `acesso-do-portal.tsx`: cadastrar/trocar um link não é tarefa
 * do dia a dia.
 *
 * **Nenhum processamento de URL aqui** (nem no servidor): o campo só valida
 * FORMA (`z.string().url()`, no contrato) — o que está salvo é string crua,
 * e é string crua que o Portal abre em nova aba.
 */
export default function LinksDeAcessoDoCliente({ cliente }: { cliente: ClienteCarteiraNaLista }) {
  const [form, setForm] = useState({
    linkPainel: cliente.linkPainel ?? '',
    linkDashInd: cliente.linkDashInd ?? '',
    linkDashFin: cliente.linkDashFin ?? '',
    linkRotina: cliente.linkRotina ?? '',
  })
  const [salvo, setSalvo] = useState(false)
  const [erro, setErro] = useState('')
  const [enviando, setEnviando] = useState(false)

  async function salvar(e: React.FormEvent) {
    e.preventDefault()
    setErro('')
    setSalvo(false)
    setEnviando(true)
    try {
      const r = await chamar<LinksDeAcessoDoClienteAtualizadosSaida>(
        `v1/carteira/clientes/${cliente.id}/links-de-acesso`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            linkPainel: form.linkPainel.trim() === '' ? null : form.linkPainel.trim(),
            linkDashInd: form.linkDashInd.trim() === '' ? null : form.linkDashInd.trim(),
            linkDashFin: form.linkDashFin.trim() === '' ? null : form.linkDashFin.trim(),
            linkRotina: form.linkRotina.trim() === '' ? null : form.linkRotina.trim(),
          }),
        },
      )
      setForm({
        linkPainel: r.cliente.linkPainel ?? '',
        linkDashInd: r.cliente.linkDashInd ?? '',
        linkDashFin: r.cliente.linkDashFin ?? '',
        linkRotina: r.cliente.linkRotina ?? '',
      })
      setSalvo(true)
    } catch (x) {
      setErro(x instanceof ErroDaApi ? x.message : 'Sem conexão com o servidor.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <section className="cartao carteira-secao">
      <div className="titulo">
        <h2>Links de acesso</h2>
      </div>
      <p className="nota">
        As URLs que {cliente.nome} vê no portal do grupo — abertas em nova aba, exatamente como
        cadastradas aqui.
      </p>

      <details className="carteira-dobra">
        <summary>Editar links de acesso</summary>
        <form className="carteira-form" onSubmit={salvar}>
          <label className="campo">
            Painel da clínica
            <input
              type="url"
              value={form.linkPainel}
              onChange={(e) => setForm({ ...form, linkPainel: e.target.value })}
              placeholder="https://"
            />
          </label>

          <label className="campo">
            Indicadores
            <input
              type="url"
              value={form.linkDashInd}
              onChange={(e) => setForm({ ...form, linkDashInd: e.target.value })}
              placeholder="https://"
            />
          </label>

          <label className="campo">
            Financeiro
            <input
              type="url"
              value={form.linkDashFin}
              onChange={(e) => setForm({ ...form, linkDashFin: e.target.value })}
              placeholder="https://"
            />
          </label>

          <label className="campo">
            FIR Clinic (rotina)
            <input
              type="url"
              value={form.linkRotina}
              onChange={(e) => setForm({ ...form, linkRotina: e.target.value })}
              placeholder="https://"
            />
            <small>Deixe em branco para remover um link já cadastrado.</small>
          </label>

          <p role="alert" aria-live="polite" className="erro">
            {erro}
          </p>
          <p role="status" aria-live="polite" className="nota">
            {salvo ? 'Links salvos.' : ''}
          </p>

          <button type="submit" disabled={enviando} className="btn">
            {enviando ? 'Salvando…' : 'Salvar links'}
          </button>
        </form>
      </details>
    </section>
  )
}
