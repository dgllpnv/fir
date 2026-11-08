'use client'

import type { EnvioDeMaterialSaida, MateriaisDoClienteSaida, MaterialNaLista } from '@fir/contracts'
import { useEffect, useState } from 'react'
import { Carregando, Toast } from '@/components/estados'
import { chamar, ErroDaApi } from '@/lib/api'
import { FormularioDeMaterial, MaterialCartao } from './materiais-cartao'

/**
 * **Os materiais da aba "Documentos" da ficha** (`materiaisDoCliente`,
 * protótipo L2706–2712; `cardMaterial` L2697–2705; G8 1B, X2 na parte do
 * cliente). A ficha (1A) monta este componente e, abaixo, `<DocumentosDoCliente>`
 * — a mesma ordem de `cDocumentos` (L1639).
 *
 * "Enviar para a cliente" monta o texto do protótipo (L2807) para copiar, e o
 * "Enviado em" só nasce de uma confirmação explícita ("Já enviei"): abrir o
 * WhatsApp não prova o envio (PP-6). O botão do WhatsApp com o número da
 * cliente entra quando o cadastro tiver o telefone (ticket 0.4).
 */

type Estado = { tag: 'carregando' } | { tag: 'erro'; mensagem: string } | { tag: 'pronto'; dados: MateriaisDoClienteSaida }

const mensagemDoMaterial = (nome: string, m: MaterialNaLista): string =>
  `Olá, ${nome}! Tudo bem? Segue o material "${m.titulo}" do seu programa com a Firmare` +
  `${m.descricao ? ` (${m.descricao.replace(/\.$/, '')})` : ''}:` +
  `${m.link ? `\n${m.link}` : ''}${m.texto ? `\n\n${m.texto}` : ''}\n\nQualquer dúvida, estou à disposição.`

export function MateriaisDoCliente({ clienteId, nomeDaCliente }: { clienteId: string; nomeDaCliente: string }) {
  const [estado, setEstado] = useState<Estado>({ tag: 'carregando' })
  const [tentativa, setTentativa] = useState(0)
  const [recado, setRecado] = useState<string | null>(null)
  const [formulario, setFormulario] = useState<{ material: MaterialNaLista | null } | null>(null)
  const [enviando, setEnviando] = useState<MaterialNaLista | null>(null)

  const recarregar = () => setTentativa((n) => n + 1)

  useEffect(() => {
    let valeu = true
    void (async () => {
      try {
        const dados = await chamar<MateriaisDoClienteSaida>(`v1/carteira/clientes/${encodeURIComponent(clienteId)}/materiais`)
        if (valeu) setEstado({ tag: 'pronto', dados })
      } catch (e) {
        if (valeu) {
          setEstado({ tag: 'erro', mensagem: e instanceof ErroDaApi ? e.message : 'Não foi possível carregar os materiais.' })
        }
      }
    })()
    return () => {
      valeu = false
    }
  }, [clienteId, tentativa])

  const copiar = async (texto: string) => {
    try {
      await navigator.clipboard.writeText(texto)
      setRecado('Texto copiado.')
    } catch {
      setRecado('Não foi possível copiar. Selecione o texto e copie à mão.')
    }
  }

  if (estado.tag === 'carregando') return <Carregando linhas={4} />
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

  const { dados } = estado
  const aoSalvar = (texto: string) => {
    setFormulario(null)
    setEnviando(null)
    setRecado(texto)
    recarregar()
  }

  const arquivar = async (m: MaterialNaLista) => {
    try {
      await chamar<void>(`v1/carteira/materiais/${m.id}/arquivar`, { method: 'POST' })
      aoSalvar('Material excluído.')
    } catch (e) {
      setRecado(e instanceof ErroDaApi ? e.message : 'Sem conexão com o servidor.')
    }
  }

  const arquivarDe = (m: MaterialNaLista) => () => void arquivar(m)

  const botaoEnviar = (m: MaterialNaLista) =>
    m.usoInterno ? null : (
      <button type="button" className="btn ghost conteudo-enviar" onClick={() => setEnviando(m)}>
        {m.enviadoEm ? 'Enviar de novo' : 'Enviar para a cliente'}
      </button>
    )

  return (
    <div className="conteudo-materiais">
      <section className="conteudo-painel" aria-labelledby="conteudo-pers-titulo">
        <div className="conteudo-cabeca">
          <h2 id="conteudo-pers-titulo" className="conteudo-titulo">
            Materiais personalizados
          </h2>
          <span className="conteudo-mudo">Feitos só para {nomeDaCliente}</span>
          <div className="conteudo-acoes">
            <button type="button" className="btn" onClick={() => setFormulario({ material: null })} disabled={formulario !== null}>
              Novo material personalizado
            </button>
          </div>
        </div>
        {formulario !== null ? (
          <FormularioDeMaterial
            destino={{ tag: 'cliente', clienteId }}
            material={formulario.material}
            programaPadrao={dados.programa}
            aoSalvar={aoSalvar}
            aoCancelar={() => setFormulario(null)}
            {...(formulario.material !== null ? { aoArquivar: arquivarDe(formulario.material) } : {})}
          />
        ) : null}
        {dados.personalizados.length === 0 && formulario === null ? (
          <p className="vazio">Nenhum material personalizado ainda. Scripts e modelos ajustados para esta cliente ficam aqui.</p>
        ) : (
          <div className="conteudo-grade">
            {dados.personalizados.map((m) => (
              <MaterialCartao
                key={m.id}
                material={m}
                mostrarTexto={false}
                aoCopiar={(t) => void copiar(t)}
                acoes={
                  <>
                    {botaoEnviar(m)}
                    <button type="button" className="link" onClick={() => setFormulario({ material: m })}>
                      Editar
                    </button>
                  </>
                }
              />
            ))}
          </div>
        )}
      </section>

      <section className="conteudo-painel" aria-labelledby="conteudo-prog-titulo">
        <div className="conteudo-cabeca">
          <h2 id="conteudo-prog-titulo" className="conteudo-titulo">
            Materiais do programa
          </h2>
          <span className="conteudo-mudo">
            Programa {dados.programa} · <span className="num">{dados.doPrograma.length}</span>{' '}
            {dados.doPrograma.length === 1 ? 'material incluído' : 'materiais incluídos'}
          </span>
        </div>
        {dados.doPrograma.length === 0 ? (
          <p className="vazio">
            Nenhum material cadastrado para este programa. Cadastre em Método Firmare, na Biblioteca de materiais.
          </p>
        ) : (
          <div className="conteudo-grade">
            {dados.doPrograma.map((m) => (
              <MaterialCartao key={m.id} material={m} mostrarTexto={false} aoCopiar={(t) => void copiar(t)} acoes={botaoEnviar(m)} />
            ))}
          </div>
        )}
        {dados.deOutrosProgramas.length > 0 ? (
          <div className="conteudo-grupo">
            <h3 className="conteudo-sobretitulo">Disponíveis em outros programas</h3>
            <ul className="conteudo-linhas">
              {dados.deOutrosProgramas.map((m) => (
                <li key={m.id} className="conteudo-linha">
                  <span className="conteudo-linha-titulo">
                    {m.titulo} <span className="conteudo-mudo">· {m.tipo}</span>
                  </span>
                  <span className="conteudo-mudo">disponível no programa {m.programas.join(', ')}</span>
                </li>
              ))}
            </ul>
            <p className="conteudo-mudo">Materiais de outros programas são uma porta natural para a próxima contratação.</p>
          </div>
        ) : null}
      </section>

      {enviando !== null ? (
        <EnviarMaterial
          clienteId={clienteId}
          material={enviando}
          texto={mensagemDoMaterial(nomeDaCliente, enviando)}
          aoCopiar={(t) => void copiar(t)}
          aoRegistrar={() => aoSalvar('Envio registrado.')}
          aoFechar={() => setEnviando(null)}
        />
      ) : null}
      <Toast recado={recado} aoFechar={() => setRecado(null)} />
    </div>
  )
}

function EnviarMaterial({
  clienteId,
  material,
  texto,
  aoCopiar,
  aoRegistrar,
  aoFechar,
}: {
  clienteId: string
  material: MaterialNaLista
  texto: string
  aoCopiar: (t: string) => void
  aoRegistrar: () => void
  aoFechar: () => void
}) {
  const [mensagem, setMensagem] = useState(texto)
  const [erro, setErro] = useState<string | null>(null)

  const registrar = async () => {
    setErro(null)
    try {
      await chamar<EnvioDeMaterialSaida>(`v1/carteira/clientes/${encodeURIComponent(clienteId)}/materiais/envios`, {
        method: 'POST',
        body: JSON.stringify({ origem: material.origem, materialId: material.id }),
      })
      aoRegistrar()
    } catch (e) {
      setErro(e instanceof ErroDaApi ? e.message : 'Sem conexão com o servidor.')
    }
  }

  return (
    <section className="conteudo-painel conteudo-envio" aria-label={`Enviar ${material.titulo}`}>
      <h3 className="conteudo-subtitulo">Enviar “{material.titulo}”</h3>
      <label className="campo">
        Mensagem
        <textarea value={mensagem} onChange={(e) => setMensagem(e.target.value)} rows={8} />
      </label>
      <p role="alert" aria-live="polite" className="erro">
        {erro}
      </p>
      <div className="conteudo-acoes">
        <button type="button" className="btn ghost" onClick={() => aoCopiar(mensagem)}>
          Copiar
        </button>
        <button type="button" className="btn" onClick={() => void registrar()}>
          Já enviei: registrar
        </button>
        <span className="conteudo-espaco" />
        <button type="button" className="btn ghost" onClick={aoFechar}>
          Fechar
        </button>
      </div>
    </section>
  )
}
