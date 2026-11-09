'use client'

import type {
  ConfiguracaoDasMensagensSaida,
  ModeloDeMensagem,
  ModelosDeMensagemSaida,
  RoteiroComercial,
  RoteirosComerciaisSaida,
} from '@fir/contracts'
import { useState, type FormEvent } from 'react'
import { Carregando, Toast } from '@/components/estados'
import { Modal } from '@/components/modal'
import { chamar, ErroDaApi } from '@/lib/api'
import { useDados } from '@/lib/dados'
import { useCarteira } from '../../contexto'
import { ErroDaCarteira } from '../../pecas'

/**
 * **MÉTODO FIRMARE · MENSAGENS E ROTEIROS** (G8 3A; protótipo `vCadastros`
 * abas "mensagens" e "config" L2655-2660, `vRoteiros` L2526-2532).
 *
 * Três blocos, na ordem do balcão: os dados de pagamento que o lembrete usa,
 * os modelos de mensagem das rotinas e checklists (X4), e os roteiros de
 * abordagem do lead (L10). Quem edita é a diretoria (`podeEditar` vem do
 * servidor, que também confere); a chave Pix só aparece para quem tem acesso
 * a valores — o servidor já a apagou para os outros, e esta tela só diz
 * "restrito".
 */

type Formulario =
  | { readonly tag: 'modelo'; readonly modelo: ModeloDeMensagem | null }
  | { readonly tag: 'roteiro'; readonly roteiro: RoteiroComercial | null }
  | { readonly tag: 'pagamento' }

export default function MensagensERoteiros() {
  const { sessao, recarregar } = useCarteira()
  const pronta = sessao.tag === 'pronta'
  const modelos = useDados<ModelosDeMensagemSaida>(pronta ? 'v1/carteira/mensagens/modelos' : null)
  const roteiros = useDados<RoteirosComerciaisSaida>(pronta ? 'v1/carteira/mensagens/roteiros' : null)
  const config = useDados<ConfiguracaoDasMensagensSaida>(pronta ? 'v1/carteira/mensagens/configuracao' : null)
  const [form, setForm] = useState<Formulario | null>(null)
  const [recado, setRecado] = useState<string | null>(null)

  const cabecalho = (
    <>
      <h1 className="titulo">Mensagens e roteiros</h1>
    </>
  )

  if (sessao.tag === 'erro') {
    return (
      <section>
        {cabecalho}
        <ErroDaCarteira mensagem={sessao.mensagem} recarregar={recarregar} />
      </section>
    )
  }

  const erro = modelos.erro ?? roteiros.erro ?? config.erro
  if (erro !== null) {
    return (
      <section>
        {cabecalho}
        <ErroDaCarteira
          mensagem={erro}
          recarregar={() => {
            modelos.recarregar()
            roteiros.recarregar()
            config.recarregar()
          }}
        />
      </section>
    )
  }

  if (!pronta || modelos.dados === null || roteiros.dados === null || config.dados === null) {
    return (
      <section>
        {cabecalho}
        <Carregando linhas={6} />
      </section>
    )
  }

  const m = modelos.dados
  const r = roteiros.dados
  const c = config.dados

  const salvo = (texto: string, qual: 'modelos' | 'roteiros' | 'config') => {
    setForm(null)
    setRecado(texto)
    if (qual === 'modelos') modelos.recarregar()
    else if (qual === 'roteiros') roteiros.recarregar()
    else config.recarregar()
  }

  const arquivar = async (roteiro: RoteiroComercial) => {
    try {
      await chamar(`v1/carteira/mensagens/roteiros/${roteiro.id}/arquivar`, { method: 'POST' })
      salvo('Roteiro excluído.', 'roteiros')
    } catch (e) {
      setRecado(e instanceof ErroDaApi ? e.message : 'Não consegui excluir. Tente de novo.')
    }
  }

  return (
    <section className="msg-tela">
      {cabecalho}
      <p className="nota">
        As variáveis entre chaves, como {'{responsavel}'}, são trocadas pelos dados de cada cliente na hora do envio.
      </p>

      <section className="msg-bloco" aria-labelledby="msg-pagamento">
        <div className="msg-bloco-cabeca">
          <h2 id="msg-pagamento" className="carteira-secao-titulo">
            Dados de pagamento da Firmare
          </h2>
          {c.podeEditarPagamento && (
            <button type="button" className="btn ghost" onClick={() => setForm({ tag: 'pagamento' })}>
              Editar
            </button>
          )}
        </div>
        <dl className="msg-fatos">
          <div>
            <dt>Chave Pix</dt>
            <dd>{!c.pagamentoVisivel ? 'restrito' : (c.chavePix ?? <span className="msg-falta">não cadastrada</span>)}</dd>
          </div>
          <div>
            <dt>Favorecido</dt>
            <dd>{c.favorecido ?? <span className="msg-falta">não cadastrado</span>}</dd>
          </div>
        </dl>
        <p className="nota">Usados no lembrete de pagamento das mensalidades.</p>
      </section>

      <section className="msg-bloco" aria-labelledby="msg-beneficio">
        <h2 id="msg-beneficio" className="carteira-secao-titulo">
          Benefício por indicação
        </h2>
        <p className="msg-beneficio">{c.beneficio}</p>
        <p className="nota">Registrado automaticamente quando uma indicação vira cliente. Entra na mensagem de agradecimento.</p>
      </section>

      <section className="msg-bloco" aria-labelledby="msg-modelos">
        <div className="msg-bloco-cabeca">
          <h2 id="msg-modelos" className="carteira-secao-titulo">
            Mensagens das rotinas e checklists
          </h2>
          {m.podeEditar && (
            <button type="button" className="btn ghost" onClick={() => setForm({ tag: 'modelo', modelo: null })}>
              Nova mensagem
            </button>
          )}
        </div>
        <Variaveis lista={m.variaveisDisponiveis} />
        {m.modelos.length === 0 ? (
          <p className="vazio">Nenhuma mensagem cadastrada. Crie a primeira em Nova mensagem.</p>
        ) : (
          <ul className="msg-lista">
            {m.modelos.map((x) => (
              <li key={x.chave} className="msg-item">
                <div className="msg-item-cabeca">
                  <h3 className="msg-item-titulo">{x.titulo}</h3>
                  {m.podeEditar && (
                    <button type="button" className="link" onClick={() => setForm({ tag: 'modelo', modelo: x })}>
                      Editar
                    </button>
                  )}
                </div>
                <p className="msg-caixa">{x.texto}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="msg-bloco" aria-labelledby="msg-roteiros">
        <div className="msg-bloco-cabeca">
          <h2 id="msg-roteiros" className="carteira-secao-titulo">
            Roteiros de abordagem
          </h2>
          {r.podeEditar && (
            <button type="button" className="btn ghost" onClick={() => setForm({ tag: 'roteiro', roteiro: null })}>
              Novo roteiro
            </button>
          )}
        </div>
        <p className="nota">
          Um trecho entre [[ e ]] só aparece quando as variáveis dele estão preenchidas. O primeiro contato sempre diz de
          onde veio o contato.
        </p>
        <Variaveis lista={r.variaveisDisponiveis} />
        {r.roteiros.length === 0 ? (
          <p className="vazio">Nenhum roteiro cadastrado. Crie o primeiro em Novo roteiro.</p>
        ) : (
          <ul className="msg-lista">
            {r.roteiros.map((x) => (
              <li key={x.id} className="msg-item">
                <div className="msg-item-cabeca">
                  <h3 className="msg-item-titulo">{x.titulo}</h3>
                  {r.podeEditar && (
                    <span className="msg-item-acoes">
                      <button type="button" className="link" onClick={() => setForm({ tag: 'roteiro', roteiro: x })}>
                        Editar
                      </button>
                      {x.chave === null && (
                        <button type="button" className="link" onClick={() => void arquivar(x)}>
                          Excluir
                        </button>
                      )}
                    </span>
                  )}
                </div>
                {x.quando !== '' && <p className="nota">{x.quando}</p>}
                {x.mensagem !== '' ? (
                  <p className="msg-caixa">{x.mensagem}</p>
                ) : (
                  <p className="nota">Sem mensagem, só guia de conversa.</p>
                )}
                {x.passos.length > 0 && (
                  <ol className="msg-passos-lista">
                    {x.passos.map((p) => (
                      <li key={p}>{p}</li>
                    ))}
                  </ol>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {form?.tag === 'modelo' && (
        <FormModelo
          modelo={form.modelo}
          aoFechar={() => setForm(null)}
          aoSalvar={() => salvo(form.modelo === null ? 'Mensagem criada.' : 'Mensagem atualizada.', 'modelos')}
        />
      )}
      {form?.tag === 'roteiro' && (
        <FormRoteiro
          roteiro={form.roteiro}
          aoFechar={() => setForm(null)}
          aoSalvar={() => salvo(form.roteiro === null ? 'Roteiro criado.' : 'Roteiro atualizado.', 'roteiros')}
        />
      )}
      {form?.tag === 'pagamento' && (
        <FormPagamento config={c} aoFechar={() => setForm(null)} aoSalvar={() => salvo('Dados de pagamento salvos.', 'config')} />
      )}

      <Toast recado={recado} aoFechar={() => setRecado(null)} />
    </section>
  )
}

function Variaveis({ lista }: { lista: readonly string[] }) {
  return (
    <details className="msg-variaveis">
      <summary>Variáveis disponíveis</summary>
      <p className="msg-variaveis-lista">{lista.map((v) => `{${v}}`).join('  ')}</p>
    </details>
  )
}

/** Envia e devolve a mensagem de erro do servidor, ou `null` se deu certo. */
async function enviar(caminho: string, metodo: 'POST' | 'PATCH' | 'PUT', corpo: unknown): Promise<string | null> {
  try {
    await chamar(caminho, { method: metodo, body: JSON.stringify(corpo) })
    return null
  } catch (e) {
    return e instanceof ErroDaApi ? e.message : 'Não consegui salvar. Confira a conexão.'
  }
}

function FormModelo({
  modelo,
  aoFechar,
  aoSalvar,
}: {
  modelo: ModeloDeMensagem | null
  aoFechar: () => void
  aoSalvar: () => void
}) {
  const [titulo, setTitulo] = useState(modelo?.titulo ?? '')
  const [texto, setTexto] = useState(modelo?.texto ?? '')
  const [erro, setErro] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  const salvar = async (e: FormEvent) => {
    e.preventDefault()
    setEnviando(true)
    const falha =
      modelo === null
        ? await enviar('v1/carteira/mensagens/modelos', 'POST', { titulo, texto })
        : await enviar(`v1/carteira/mensagens/modelos/${modelo.chave}`, 'PATCH', { titulo, texto })
    setEnviando(false)
    if (falha === null) aoSalvar()
    else setErro(falha)
  }

  return (
    <Modal titulo={modelo === null ? 'Nova mensagem' : 'Editar mensagem'} aoFechar={aoFechar}>
      <form className="msg-form" onSubmit={(e) => void salvar(e)}>
        <label className="campo">
          Nome
          <input value={titulo} onChange={(e) => setTitulo(e.target.value)} required maxLength={120} />
        </label>
        <label className="campo">
          Texto
          <textarea className="msg-texto" rows={9} value={texto} onChange={(e) => setTexto(e.target.value)} required maxLength={4000} />
        </label>
        {erro !== null && (
          <p className="msg-erro" role="alert">
            {erro}
          </p>
        )}
        <div className="msg-acoes">
          <button type="button" className="btn ghost" onClick={aoFechar}>
            Cancelar
          </button>
          <button type="submit" className="btn" disabled={enviando}>
            {enviando ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

function FormRoteiro({
  roteiro,
  aoFechar,
  aoSalvar,
}: {
  roteiro: RoteiroComercial | null
  aoFechar: () => void
  aoSalvar: () => void
}) {
  const [titulo, setTitulo] = useState(roteiro?.titulo ?? '')
  const [quando, setQuando] = useState(roteiro?.quando ?? '')
  const [mensagem, setMensagem] = useState(roteiro?.mensagem ?? '')
  const [passos, setPassos] = useState((roteiro?.passos ?? []).join('\n'))
  const [erro, setErro] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  const salvar = async (e: FormEvent) => {
    e.preventDefault()
    setEnviando(true)
    const corpo = {
      titulo,
      quando,
      mensagem,
      passos: passos
        .split('\n')
        .map((p) => p.trim())
        .filter((p) => p !== ''),
    }
    const falha =
      roteiro === null
        ? await enviar('v1/carteira/mensagens/roteiros', 'POST', corpo)
        : await enviar(`v1/carteira/mensagens/roteiros/${roteiro.id}`, 'PATCH', corpo)
    setEnviando(false)
    if (falha === null) aoSalvar()
    else setErro(falha)
  }

  return (
    <Modal titulo={roteiro === null ? 'Novo roteiro' : 'Editar roteiro'} aoFechar={aoFechar}>
      <form className="msg-form" onSubmit={(e) => void salvar(e)}>
        <label className="campo">
          Nome do roteiro
          <input value={titulo} onChange={(e) => setTitulo(e.target.value)} required maxLength={120} />
        </label>
        <label className="campo">
          Quando usar
          <input value={quando} onChange={(e) => setQuando(e.target.value)} maxLength={200} />
        </label>
        <label className="campo">
          Mensagem de WhatsApp
          <textarea className="msg-texto" rows={7} value={mensagem} onChange={(e) => setMensagem(e.target.value)} maxLength={4000} />
        </label>
        <label className="campo">
          Passo a passo (um por linha)
          <textarea rows={6} value={passos} onChange={(e) => setPassos(e.target.value)} />
        </label>
        {erro !== null && (
          <p className="msg-erro" role="alert">
            {erro}
          </p>
        )}
        <div className="msg-acoes">
          <button type="button" className="btn ghost" onClick={aoFechar}>
            Cancelar
          </button>
          <button type="submit" className="btn" disabled={enviando}>
            {enviando ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

function FormPagamento({
  config,
  aoFechar,
  aoSalvar,
}: {
  config: ConfiguracaoDasMensagensSaida
  aoFechar: () => void
  aoSalvar: () => void
}) {
  const [chavePix, setChavePix] = useState(config.chavePix ?? '')
  const [favorecido, setFavorecido] = useState(config.favorecido ?? '')
  const [erro, setErro] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  const salvar = async (e: FormEvent) => {
    e.preventDefault()
    setEnviando(true)
    const falha = await enviar('v1/carteira/mensagens/configuracao/pagamento', 'PUT', {
      chavePix: chavePix.trim() === '' ? null : chavePix,
      favorecido: favorecido.trim() === '' ? null : favorecido,
    })
    setEnviando(false)
    if (falha === null) aoSalvar()
    else setErro(falha)
  }

  return (
    <Modal titulo="Dados de pagamento da Firmare" aoFechar={aoFechar}>
      <form className="msg-form" onSubmit={(e) => void salvar(e)}>
        <label className="campo">
          Chave Pix
          <input value={chavePix} onChange={(e) => setChavePix(e.target.value)} required maxLength={140} />
        </label>
        <label className="campo">
          Favorecido
          <input value={favorecido} onChange={(e) => setFavorecido(e.target.value)} maxLength={160} />
        </label>
        {erro !== null && (
          <p className="msg-erro" role="alert">
            {erro}
          </p>
        )}
        <div className="msg-acoes">
          <button type="button" className="btn ghost" onClick={aoFechar}>
            Cancelar
          </button>
          <button type="submit" className="btn" disabled={enviando}>
            {enviando ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
