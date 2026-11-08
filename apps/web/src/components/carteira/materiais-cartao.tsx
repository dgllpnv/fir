'use client'

import { type MaterialNaLista, PROGRAMAS_DE_MATERIAL, TIPOS_DE_MATERIAL, type TipoDeMaterial } from '@fir/contracts'
import { type FormEvent, type ReactNode, useState } from 'react'
import { chamar, ErroDaApi } from '@/lib/api'

/**
 * As peças de material compartilhadas pela ficha do cliente
 * (`materiais-do-cliente.tsx`) e pela Biblioteca do Método
 * (`app/carteira/metodo/biblioteca`): o cartão (`cardMaterial`, protótipo
 * L2697–2705) e o formulário (`fMaterial`, L2713–2715).
 */

const dataBr = (dia: string): string => `${dia.slice(8, 10)}/${dia.slice(5, 7)}`

export function MaterialCartao({
  material,
  mostrarTexto,
  acoes,
  aoCopiar,
}: {
  material: MaterialNaLista
  /** Na biblioteca o texto aparece no cartão; na ficha, só "Copiar texto" (L2701). */
  mostrarTexto: boolean
  acoes?: ReactNode
  aoCopiar: (texto: string) => void
}) {
  const m = material
  return (
    <article className="conteudo-material">
      <div className="conteudo-material-chips">
        <span className="conteudo-chip">{m.tipo}</span>
        {m.programas.map((p) => (
          <span key={p} className="conteudo-chip conteudo-chip-ouro">
            {p}
          </span>
        ))}
        {m.usoInterno ? <span className="conteudo-chip">uso interno</span> : null}
        {m.origem === 'personalizado' ? <span className="conteudo-chip conteudo-saude-bom">personalizado</span> : null}
      </div>
      <b className="conteudo-material-titulo">{m.titulo}</b>
      {m.descricao ? <p className="conteudo-mudo">{m.descricao}</p> : null}
      {mostrarTexto && m.texto ? <pre className="conteudo-material-texto">{m.texto}</pre> : null}
      <div className="conteudo-material-acoes">
        {m.link ? (
          <a className="link" href={m.link} target="_blank" rel="noopener noreferrer">
            Abrir
          </a>
        ) : null}
        {m.texto ? (
          <button type="button" className="link" onClick={() => aoCopiar(m.texto ?? '')}>
            Copiar texto
          </button>
        ) : null}
        {!m.link && !m.texto ? <span className="conteudo-aviso">falta o link ou o texto</span> : null}
        {acoes}
      </div>
      {m.enviadoEm ? <p className="conteudo-enviado num">Enviado em {dataBr(m.enviadoEm)}</p> : null}
    </article>
  )
}

export type DestinoDoMaterial =
  | { tag: 'cliente'; clienteId: string }
  | { tag: 'biblioteca' }

/**
 * Cadastro e edição. Para o cliente, "Quem pode receber" é `visivelPortal`;
 * na biblioteca, `usoInterno` — os dois sem pré-escolha (LGPD A12).
 */
export function FormularioDeMaterial({
  destino,
  material,
  programaPadrao,
  aoSalvar,
  aoCancelar,
  aoArquivar,
}: {
  destino: DestinoDoMaterial
  material: MaterialNaLista | null
  programaPadrao: string | null
  aoSalvar: (texto: string) => void
  aoCancelar: () => void
  aoArquivar?: () => void
}) {
  const [titulo, setTitulo] = useState(material?.titulo ?? '')
  const [tipo, setTipo] = useState<TipoDeMaterial>(
    (TIPOS_DE_MATERIAL as readonly string[]).includes(material?.tipo ?? '')
      ? (material!.tipo as TipoDeMaterial) // estreitado pelo includes acima
      : destino.tag === 'cliente'
        ? 'Script'
        : 'Planilha',
  )
  const [quem, setQuem] = useState<'cliente' | 'interno' | null>(
    material === null ? null : material.usoInterno ? 'interno' : 'cliente',
  )
  const [programas, setProgramas] = useState<string[]>(
    material?.programas ?? (programaPadrao !== null ? [programaPadrao] : []),
  )
  const [link, setLink] = useState(material?.link ?? '')
  const [texto, setTexto] = useState(material?.texto ?? '')
  const [descricao, setDescricao] = useState(material?.descricao ?? '')
  const [erro, setErro] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [confirmandoExclusao, setConfirmandoExclusao] = useState(false)

  const salvar = async (e: FormEvent) => {
    e.preventDefault()
    if (quem === null) {
      setErro('Diga quem pode receber o material.')
      return
    }
    setEnviando(true)
    setErro(null)
    const corpo = {
      titulo,
      tipo,
      programas,
      link: link.trim() === '' ? null : link.trim(),
      texto,
      descricao,
      ...(destino.tag === 'cliente' ? { visivelPortal: quem === 'cliente' } : { usoInterno: quem === 'interno' }),
    }
    const caminho =
      material !== null
        ? destino.tag === 'cliente'
          ? `v1/carteira/materiais/${material.id}`
          : `v1/carteira/biblioteca/${material.id}`
        : destino.tag === 'cliente'
          ? `v1/carteira/clientes/${encodeURIComponent(destino.clienteId)}/materiais`
          : 'v1/carteira/biblioteca'
    try {
      await chamar(caminho, { method: material !== null ? 'PATCH' : 'POST', body: JSON.stringify(corpo) })
      aoSalvar(material !== null ? 'Material atualizado.' : destino.tag === 'cliente' ? 'Material personalizado salvo.' : 'Material cadastrado.')
    } catch (x) {
      setErro(x instanceof ErroDaApi ? x.message : 'Sem conexão com o servidor.')
    } finally {
      setEnviando(false)
    }
  }

  const alternarPrograma = (p: string) =>
    setProgramas((atual) => (atual.includes(p) ? atual.filter((x) => x !== p) : [...atual, p]))

  return (
    <form className="conteudo-form" onSubmit={salvar} aria-label={material ? 'Editar material' : 'Novo material'}>
      <label className="campo">
        Nome do material
        <input value={titulo} onChange={(e) => setTitulo(e.target.value)} required maxLength={160} />
      </label>
      <div className="conteudo-duas">
        <label className="campo">
          Tipo
          <select value={tipo} onChange={(e) => setTipo(e.target.value as TipoDeMaterial)}>
            {TIPOS_DE_MATERIAL.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <fieldset className="conteudo-fieldset">
          <legend>Quem pode receber</legend>
          <label className="conteudo-marcar">
            <input type="radio" name="quem" checked={quem === 'cliente'} onChange={() => setQuem('cliente')} />
            Pode ir para a cliente
          </label>
          <label className="conteudo-marcar">
            <input type="radio" name="quem" checked={quem === 'interno'} onChange={() => setQuem('interno')} />
            Só uso interno
          </label>
        </fieldset>
      </div>
      <fieldset className="conteudo-fieldset">
        <legend>Programas que incluem este material</legend>
        <div className="conteudo-marcas">
          {PROGRAMAS_DE_MATERIAL.map((p) => (
            <label key={p} className="conteudo-marcar">
              <input type="checkbox" checked={programas.includes(p)} onChange={() => alternarPrograma(p)} />
              {p}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="campo">
        Link (Drive, Google Planilhas, Docs)
        <input value={link} onChange={(e) => setLink(e.target.value)} type="url" inputMode="url" placeholder="https://" maxLength={2000} />
        <small className="conteudo-mudo">Para planilhas, prefira o link terminado em /copy.</small>
      </label>
      <label className="campo">
        Texto (para scripts e modelos de mensagem)
        <textarea value={texto} onChange={(e) => setTexto(e.target.value)} maxLength={8000} rows={4} />
      </label>
      <label className="campo">
        Para que serve
        <input value={descricao} onChange={(e) => setDescricao(e.target.value)} maxLength={500} />
      </label>
      <p role="alert" aria-live="polite" className="erro">
        {erro}
      </p>
      <div className="conteudo-acoes">
        {aoArquivar ? (
          <button
            type="button"
            className="btn ghost conteudo-perigo"
            onClick={() => (confirmandoExclusao ? aoArquivar() : setConfirmandoExclusao(true))}
          >
            {confirmandoExclusao ? 'Toque de novo para excluir' : 'Excluir'}
          </button>
        ) : null}
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
