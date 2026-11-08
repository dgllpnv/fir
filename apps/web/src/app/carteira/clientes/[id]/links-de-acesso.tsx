'use client'

import {
  type CadastroDoClienteNaSaida,
  FRENTES_DO_PARCEIRO,
  type FrenteDoParceiro,
  type LinksDeAcessoDoClienteAtualizadosSaida,
} from '@fir/contracts'
import Link from 'next/link'
import { useRef, useState } from 'react'
import { MensagemWhatsApp } from '@/components/carteira/mensagem-whatsapp'
import { chamar, ErroDaApi } from '@/lib/api'

/**
 * **ACESSOS DA CLIENTE** (V5; `painelLinks`, `index.html` L2593-2600).
 *
 * Na ordem do protótipo: "Acessos da cliente · N de 4 cadastrados" com
 * "Enviar acessos" pelo WhatsApp; os quatro links (Abrir · Copiar, ou
 * Cadastrar); e "Formulários dos parceiros" por frente, com o nome do
 * parceiro e "sem WhatsApp" quando falta o número.
 *
 * Dois desvios, os dois de onde mora o dado:
 *  - os quatro links têm rota própria (`PATCH …/links-de-acesso`, G6) e NÃO
 *    estão no formulário do cadastro (0.4). "Cadastrar" abre aqui mesmo o
 *    formulário recolhido "Editar links", em vez do "Editar cadastro";
 *  - os parceiros estão no cadastro (`parceiros_do_cliente`), então o
 *    "Cadastrar" deles leva ao cadastro.
 *
 * A mensagem de "Enviar acessos" é montada no SERVIDOR (modelo `acessos`,
 * X4) pelo modal da casa — esta tela não preenche variável nenhuma.
 */

/** Os rótulos e a ordem de `LINKS` do protótipo (L627). */
const LINKS: readonly { chave: 'linkPainel' | 'linkDashFin' | 'linkDashInd' | 'linkRotina'; rotulo: string }[] = [
  { chave: 'linkPainel', rotulo: 'Painel do cliente' },
  { chave: 'linkDashFin', rotulo: 'Dash financeiro' },
  { chave: 'linkDashInd', rotulo: 'Dash de indicadores' },
  { chave: 'linkRotina', rotulo: 'Gestor de rotinas' },
]

/** `FRENTES` do protótipo (L629). */
const ROTULO_DA_FRENTE: Record<FrenteDoParceiro, string> = {
  financeiro: 'Financeiro',
  comercial: 'Comercial',
  trafego: 'Tráfego pago',
  marketing: 'Marketing',
}

type Links = Pick<CadastroDoClienteNaSaida, 'linkPainel' | 'linkDashFin' | 'linkDashInd' | 'linkRotina'>

export default function AcessosDaCliente({
  cliente,
  aoAvisar,
}: {
  cliente: CadastroDoClienteNaSaida
  /** Uma mensagem por vez: o toast é da ficha. */
  aoAvisar: (recado: string) => void
}) {
  const [links, setLinks] = useState<Links>({
    linkPainel: cliente.linkPainel,
    linkDashFin: cliente.linkDashFin,
    linkDashInd: cliente.linkDashInd,
    linkRotina: cliente.linkRotina,
  })
  const [enviando, setEnviando] = useState(false)
  const dobra = useRef<HTMLDetailsElement>(null)

  const cadastrados = LINKS.filter((l) => links[l.chave] !== null).length
  const parceiros = FRENTES_DO_PARCEIRO.map(
    (frente) => cliente.parceiros.find((p) => p.frente === frente) ?? { frente, nome: null, whatsapp: null, linkFormulario: null },
  )
  const formularios = parceiros.filter((p) => p.linkFormulario !== null).length

  async function copiar(url: string, rotulo: string) {
    try {
      await navigator.clipboard.writeText(url)
      aoAvisar(`Link de ${rotulo.toLowerCase()} copiado.`)
    } catch {
      aoAvisar('Não consegui copiar. Abra o link e copie da barra de endereço.')
    }
  }

  function abrirEdicao() {
    if (dobra.current === null) return
    dobra.current.open = true
    dobra.current.querySelector('input')?.focus()
  }

  return (
    <section className="ficha-acessos" aria-labelledby="ficha-acessos-titulo">
      <div className="ficha-acessos-cabeca">
        <h3 id="ficha-acessos-titulo" className="eyebrow">
          Acessos da cliente
        </h3>
        <span className="ficha-mudo num">{cadastrados} de 4 cadastrados</span>
        <button type="button" className="btn ficha-whatsapp" onClick={() => setEnviando(true)}>
          <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true">
            <path d="M12 2a10 10 0 00-8.6 15.1L2 22l5-1.3A10 10 0 1012 2zm0 18.2a8.2 8.2 0 01-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1112 20.2z" />
          </svg>
          Enviar acessos
        </button>
      </div>

      <ul className="ficha-links">
        {LINKS.map((l) => {
          const url = links[l.chave]
          return (
            <li key={l.chave} className="ficha-link">
              <span className="ficha-link-rotulo">{l.rotulo}</span>
              {url !== null ? (
                <>
                  <a className="link" href={url} target="_blank" rel="noopener noreferrer">
                    Abrir
                  </a>
                  <button type="button" className="link" onClick={() => void copiar(url, l.rotulo)}>
                    Copiar
                  </button>
                </>
              ) : (
                <button type="button" className="link ficha-cadastrar" onClick={abrirEdicao}>
                  Cadastrar
                </button>
              )}
            </li>
          )
        })}
      </ul>

      <h3 className="eyebrow ficha-acessos-sub">
        Formulários dos parceiros <span className="ficha-mudo num">· {formularios} de 4 cadastrados</span>
      </h3>
      <ul className="ficha-links">
        {parceiros.map((p) => (
          <li key={p.frente} className="ficha-link">
            <span className="ficha-link-rotulo">
              {ROTULO_DA_FRENTE[p.frente]}{' '}
              <span className="ficha-mudo">
                · {p.nome ?? 'parceiro não informado'}
                {p.whatsapp === null ? ' · sem WhatsApp' : ''}
              </span>
            </span>
            {p.linkFormulario !== null ? (
              <>
                <a className="link" href={p.linkFormulario} target="_blank" rel="noopener noreferrer">
                  Abrir
                </a>
                <button
                  type="button"
                  className="link"
                  onClick={() => void copiar(p.linkFormulario ?? '', `formulário de ${ROTULO_DA_FRENTE[p.frente]}`)}
                >
                  Copiar
                </button>
              </>
            ) : (
              <Link className="link ficha-cadastrar" href={`/carteira/clientes/${cliente.id}/cadastro`}>
                Cadastrar
              </Link>
            )}
          </li>
        ))}
      </ul>

      <details className="carteira-dobra" ref={dobra}>
        <summary>Editar links</summary>
        <FormularioDeLinks
          clienteId={cliente.id}
          links={links}
          aoSalvar={(novos) => {
            setLinks(novos)
            if (dobra.current !== null) dobra.current.open = false
            aoAvisar('Links salvos.')
          }}
        />
      </details>

      {enviando ? (
        <MensagemWhatsApp
          destino={{ para: 'cliente', clienteId: cliente.id, chave: 'acessos' }}
          aoFechar={() => setEnviando(false)}
        />
      ) : null}
    </section>
  )
}

/**
 * Os quatro links (migration 0036). Nenhum processamento de URL aqui: o
 * contrato valida a FORMA na entrada, e o que está salvo é string crua.
 * Em branco = remover.
 */
function FormularioDeLinks({
  clienteId,
  links,
  aoSalvar,
}: {
  clienteId: string
  links: Links
  aoSalvar: (links: Links) => void
}) {
  const [form, setForm] = useState<Record<keyof Links, string>>({
    linkPainel: links.linkPainel ?? '',
    linkDashFin: links.linkDashFin ?? '',
    linkDashInd: links.linkDashInd ?? '',
    linkRotina: links.linkRotina ?? '',
  })
  const [erro, setErro] = useState('')
  const [enviando, setEnviando] = useState(false)
  const ouNulo = (t: string): string | null => (t.trim() === '' ? null : t.trim())

  async function salvar(e: React.FormEvent) {
    e.preventDefault()
    setErro('')
    setEnviando(true)
    try {
      const r = await chamar<LinksDeAcessoDoClienteAtualizadosSaida>(`v1/carteira/clientes/${clienteId}/links-de-acesso`, {
        method: 'PATCH',
        body: JSON.stringify({
          linkPainel: ouNulo(form.linkPainel),
          linkDashInd: ouNulo(form.linkDashInd),
          linkDashFin: ouNulo(form.linkDashFin),
          linkRotina: ouNulo(form.linkRotina),
        }),
      })
      aoSalvar({
        linkPainel: r.cliente.linkPainel,
        linkDashFin: r.cliente.linkDashFin,
        linkDashInd: r.cliente.linkDashInd,
        linkRotina: r.cliente.linkRotina,
      })
    } catch (x) {
      setErro(x instanceof ErroDaApi ? x.message : 'Sem conexão com o servidor.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <form className="carteira-form" onSubmit={salvar}>
      {LINKS.map((l) => (
        <label key={l.chave} className="campo">
          {l.rotulo}
          <input
            type="url"
            value={form[l.chave]}
            onChange={(e) => setForm({ ...form, [l.chave]: e.target.value })}
            placeholder="https://"
          />
        </label>
      ))}
      <p className="nota">Deixe em branco para remover um link já cadastrado.</p>
      <p role="alert" aria-live="polite" className="erro">
        {erro}
      </p>
      <button type="submit" disabled={enviando} className="btn">
        {enviando ? 'Salvando…' : 'Salvar links'}
      </button>
    </form>
  )
}
