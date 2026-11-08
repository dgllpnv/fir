'use client'

import {
  CATEGORIAS_DE_DOCUMENTO,
  type CategoriaDeDocumento,
  type DocumentoNaLista,
  type DocumentoSaida,
  type DocumentosDoClienteSaida,
} from '@fir/contracts'
import { type FormEvent, useEffect, useState } from 'react'
import { Carregando, Toast } from '@/components/estados'
import { chamar, ErroDaApi } from '@/lib/api'

/**
 * **Os documentos da aba "Documentos" da ficha** (`cDocumentosProprios`,
 * protótipo L1640–1646; `F.doc` L2764; G8 1B, V13). A aba do protótipo junta
 * os materiais (`materiaisDoCliente`) e estes documentos — a ficha em abas
 * (1A) monta `<MateriaisDoCliente>` e depois este componente, na mesma ordem.
 *
 * Divergências, e por quê:
 *  - "Aparece no espaço da cliente?" sem resposta pré-escolhida: a escolha é
 *    explícita (LGPD A12; recomendação de A-18, porque "Diagnóstico" é a
 *    categoria que mais provavelmente é interna). O protótipo pré-seleciona
 *    "Sim".
 *  - "Excluir" vira arquivar (regra 20), só para quem administra (A-9).
 *  - Chip "só para a equipe" no documento interno, para quem lê a lista saber
 *    o que a cliente não vê.
 */

type Estado = { tag: 'carregando' } | { tag: 'erro'; mensagem: string } | { tag: 'pronto'; dados: DocumentosDoClienteSaida }

const dataBr = (dia: string): string => `${dia.slice(8, 10)}/${dia.slice(5, 7)}`

export function DocumentosDoCliente({ clienteId }: { clienteId: string }) {
  const [estado, setEstado] = useState<Estado>({ tag: 'carregando' })
  const [tentativa, setTentativa] = useState(0)
  const [recado, setRecado] = useState<string | null>(null)
  const [novo, setNovo] = useState(false)
  const [excluindo, setExcluindo] = useState<string | null>(null)

  const recarregar = () => setTentativa((n) => n + 1)

  useEffect(() => {
    let valeu = true
    void (async () => {
      try {
        const dados = await chamar<DocumentosDoClienteSaida>(`v1/carteira/clientes/${encodeURIComponent(clienteId)}/documentos`)
        if (valeu) setEstado({ tag: 'pronto', dados })
      } catch (e) {
        if (valeu) {
          setEstado({ tag: 'erro', mensagem: e instanceof ErroDaApi ? e.message : 'Não foi possível carregar os documentos.' })
        }
      }
    })()
    return () => {
      valeu = false
    }
  }, [clienteId, tentativa])

  if (estado.tag === 'carregando') return <Carregando linhas={3} />
  if (estado.tag === 'erro') {
    return (
      <div className="carteira-erro" role="alert">
        <p>{estado.mensagem}</p>
        <div className="carteira-erro-acoes">
          <button type="button" className="btn" onClick={recarregar}>
            Tentar de novo
          </button>
        </div>
      </div>
    )
  }

  const { documentos, podeAdministrar } = estado.dados
  // Agrupado por categoria, na ordem em que aparecem (o protótipo usa a ordem de cadastro).
  const categorias = [...new Set(documentos.map((d) => d.categoria))]

  const excluir = async (d: DocumentoNaLista) => {
    if (excluindo !== d.id) {
      setExcluindo(d.id)
      return
    }
    try {
      await chamar<void>(`v1/carteira/documentos/${d.id}/arquivar`, { method: 'POST' })
      setRecado('Documento excluído.')
      setExcluindo(null)
      recarregar()
    } catch (e) {
      setRecado(e instanceof ErroDaApi ? e.message : 'Sem conexão com o servidor.')
    }
  }

  return (
    <section className="conteudo-painel" aria-labelledby="conteudo-documentos-titulo">
      <div className="conteudo-cabeca">
        <h2 id="conteudo-documentos-titulo" className="conteudo-titulo">
          Documentos
        </h2>
        <div className="conteudo-acoes">
          <button type="button" className="btn" onClick={() => setNovo(true)} disabled={novo}>
            Adicionar documento
          </button>
        </div>
      </div>

      {novo ? (
        <FormularioDeDocumento
          clienteId={clienteId}
          aoSalvar={() => {
            setNovo(false)
            setRecado('Documento adicionado.')
            recarregar()
          }}
          aoCancelar={() => setNovo(false)}
        />
      ) : null}

      {categorias.length === 0 && !novo ? (
        <p className="vazio">Nenhum documento. Adicione o link do Drive de cada entrega.</p>
      ) : null}

      {categorias.map((cat) => (
        <div key={cat} className="conteudo-grupo">
          <h3 className="conteudo-sobretitulo">{cat}</h3>
          <ul className="conteudo-linhas">
            {documentos
              .filter((d) => d.categoria === cat)
              .map((d) => (
                <li key={d.id} className="conteudo-linha">
                  <span className="conteudo-linha-titulo">
                    {d.titulo}
                    {!d.visivelPortal ? <span className="conteudo-chip">só para a equipe</span> : null}
                  </span>
                  <span className="conteudo-linha-acoes">
                    <span className="conteudo-mudo num">{dataBr(d.data)}</span>
                    <a className="link" href={d.link} target="_blank" rel="noopener noreferrer">
                      Abrir
                    </a>
                    {podeAdministrar ? (
                      <button type="button" className="link perigo" onClick={() => void excluir(d)}>
                        {excluindo === d.id ? 'Toque de novo' : 'Excluir'}
                      </button>
                    ) : null}
                  </span>
                </li>
              ))}
          </ul>
        </div>
      ))}
      <Toast recado={recado} aoFechar={() => setRecado(null)} />
    </section>
  )
}

function FormularioDeDocumento({
  clienteId,
  aoSalvar,
  aoCancelar,
}: {
  clienteId: string
  aoSalvar: () => void
  aoCancelar: () => void
}) {
  const [titulo, setTitulo] = useState('')
  const [categoria, setCategoria] = useState<CategoriaDeDocumento>('Relatório')
  const [link, setLink] = useState('')
  const [visivel, setVisivel] = useState<'sim' | 'nao' | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  const salvar = async (e: FormEvent) => {
    e.preventDefault()
    if (visivel === null) {
      setErro('Diga se o documento aparece no espaço da cliente.')
      return
    }
    setEnviando(true)
    setErro(null)
    try {
      await chamar<DocumentoSaida>(`v1/carteira/clientes/${encodeURIComponent(clienteId)}/documentos`, {
        method: 'POST',
        body: JSON.stringify({ titulo, categoria, link: link.trim(), visivelPortal: visivel === 'sim' }),
      })
      aoSalvar()
    } catch (x) {
      setErro(x instanceof ErroDaApi ? x.message : 'Sem conexão com o servidor.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <form className="conteudo-form" onSubmit={salvar} aria-label="Adicionar documento">
      <label className="campo">
        Título
        <input value={titulo} onChange={(e) => setTitulo(e.target.value)} required maxLength={160} />
      </label>
      <label className="campo">
        Categoria
        <select value={categoria} onChange={(e) => setCategoria(e.target.value as CategoriaDeDocumento)}>
          {CATEGORIAS_DE_DOCUMENTO.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </label>
      <label className="campo">
        Link (Drive, portal)
        <input
          value={link}
          onChange={(e) => setLink(e.target.value)}
          type="url"
          inputMode="url"
          placeholder="https://"
          required
          maxLength={2000}
        />
      </label>
      <fieldset className="conteudo-fieldset">
        <legend>Aparece no espaço da cliente?</legend>
        <label className="conteudo-marcar">
          <input type="radio" name="visivel" checked={visivel === 'sim'} onChange={() => setVisivel('sim')} />
          Sim
        </label>
        <label className="conteudo-marcar">
          <input type="radio" name="visivel" checked={visivel === 'nao'} onChange={() => setVisivel('nao')} />
          Não, só para a equipe
        </label>
      </fieldset>
      <p role="alert" aria-live="polite" className="erro">
        {erro}
      </p>
      <div className="conteudo-acoes">
        <span className="conteudo-espaco" />
        <button type="button" className="btn ghost" onClick={aoCancelar}>
          Cancelar
        </button>
        <button type="submit" className="btn" disabled={enviando}>
          {enviando ? 'Salvando…' : 'Salvar'}
        </button>
      </div>
    </form>
  )
}
