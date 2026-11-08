'use client'

import type { DestinoDaMensagem, EnvioDeMensagemRegistradoSaida, MensagemMontadaSaida } from '@fir/contracts'
import { linkDoWhatsAppComTexto } from '@fir/domain'
import { type RefObject, useEffect, useId, useRef, useState } from 'react'
import { Carregando } from '@/components/estados'
import { Modal } from '@/components/modal'
import { chamar, ErroDaApi } from '@/lib/api'
import { diaCurto } from '@/lib/formato'

/**
 * **A MENSAGEM PRONTA DO WHATSAPP — um modal só, para todas as telas da
 * carteira** (G8 3A; protótipo `abrirMsg` L2602-2610, `painelRoteiro`
 * L2514-2525).
 *
 * O texto vem montado do SERVIDOR (`POST /v1/carteira/mensagens/montar`), com
 * a redação de valores aplicada antes: esta tela não preenche variável, não
 * sabe o que é Pix e não tem `if` sobre dinheiro (design.md §4). Ela só deixa
 * editar, copiar e abrir a conversa.
 *
 * **Abrir o WhatsApp não marca nada como enviado** (PP-6). O protótipo marcava
 * no clique do link (L2826); aqui o clique abre a conversa e a tela PERGUNTA
 * se a mensagem saiu. Só o "Sim" grava o fato — e o fato é "a pessoa disse
 * que enviou", nunca "foi entregue". Por isso a tela diz "marcada como
 * enviada", e não "entregue".
 *
 * Uso: `<MensagemWhatsApp destino={…} aoFechar={…} aoConfirmarEnvio={…} />`.
 * `aoConfirmarEnvio` é o gancho da tela que precisa do passo seguinte — o
 * lead abre o "Registrar contato" já preenchido (L9, L13).
 */

type Estado =
  | { readonly tag: 'carregando' }
  | { readonly tag: 'erro'; readonly mensagem: string }
  | { readonly tag: 'pronta'; readonly montada: MensagemMontadaSaida }

export function MensagemWhatsApp({
  destino,
  aoFechar,
  aoConfirmarEnvio,
}: {
  destino: DestinoDaMensagem
  aoFechar: () => void
  aoConfirmarEnvio?: (envio: EnvioDeMensagemRegistradoSaida) => void
}) {
  const [estado, setEstado] = useState<Estado>({ tag: 'carregando' })
  const [texto, setTexto] = useState('')
  const [perguntando, setPerguntando] = useState(false)
  const [gravando, setGravando] = useState(false)
  const [recado, setRecado] = useState<string | null>(null)
  const [marcadaNoDia, setMarcadaNoDia] = useState<string | null>(null)
  const [tentativa, setTentativa] = useState(0)
  const caixa = useRef<HTMLTextAreaElement>(null)
  const idDoTexto = useId()
  // Uma chave por modal aberto (A-14): o duplo toque em "Sim" grava uma vez.
  const chave = useRef<string>(crypto.randomUUID())
  // A identidade do destino, para não remontar a cada render de quem chama.
  const alvo = JSON.stringify(destino)

  useEffect(() => {
    let valeu = true
    setEstado({ tag: 'carregando' })
    chamar<MensagemMontadaSaida>('v1/carteira/mensagens/montar', {
      method: 'POST',
      body: JSON.stringify({ destino: JSON.parse(alvo) as unknown }),
    })
      .then((m) => {
        if (!valeu) return
        setEstado({ tag: 'pronta', montada: m })
        setTexto(m.texto)
        setMarcadaNoDia(m.ultimoEnvioConfirmado?.dia ?? null)
      })
      .catch((e: unknown) => {
        if (!valeu) return
        setEstado({
          tag: 'erro',
          mensagem: e instanceof ErroDaApi ? e.message : 'Não consegui falar com o servidor. Confira a conexão.',
        })
      })
    return () => {
      valeu = false
    }
  }, [alvo, tentativa])

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(texto)
      setRecado('Mensagem copiada.')
    } catch {
      caixa.current?.select()
      setRecado('Texto selecionado. Use Ctrl+C para copiar.')
    }
  }

  const marcarEnviada = async () => {
    setGravando(true)
    try {
      const envio = await chamar<EnvioDeMensagemRegistradoSaida>('v1/carteira/mensagens/envios', {
        method: 'POST',
        body: JSON.stringify({ chaveIdempotencia: chave.current, destino }),
      })
      setMarcadaNoDia(envio.envioConfirmadoNoDia)
      setPerguntando(false)
      setRecado('Marcada como enviada.')
      aoConfirmarEnvio?.(envio)
    } catch (e) {
      setRecado(e instanceof ErroDaApi ? e.message : 'Não consegui registrar. Tente de novo.')
    } finally {
      setGravando(false)
    }
  }

  const tituloDoModal = estado.tag === 'pronta' ? estado.montada.titulo : 'Mensagem pelo WhatsApp'

  return (
    <Modal titulo={tituloDoModal} aoFechar={aoFechar}>
      {estado.tag === 'carregando' && <Carregando linhas={4} />}

      {estado.tag === 'erro' && (
        <div className="msg-erro" role="alert">
          <p>{estado.mensagem}</p>
          <div className="msg-acoes">
            <button type="button" className="btn" onClick={() => setTentativa((n) => n + 1)}>
              Tentar de novo
            </button>
            <button type="button" className="btn ghost" onClick={aoFechar}>
              Fechar
            </button>
          </div>
        </div>
      )}

      {estado.tag === 'pronta' && (
        <Corpo
          montada={estado.montada}
          texto={texto}
          aoMudarTexto={setTexto}
          caixa={caixa}
          idDoTexto={idDoTexto}
          perguntando={perguntando}
          gravando={gravando}
          marcadaNoDia={marcadaNoDia}
          aoAbrirWhatsApp={() => setPerguntando(true)}
          aoCopiar={() => void copiar()}
          aoMarcar={() => void marcarEnviada()}
          aoNaoEnviei={() => setPerguntando(false)}
          aoFechar={aoFechar}
        />
      )}

      <p className="msg-recado" role="status" aria-live="polite">
        {recado ?? ''}
      </p>
    </Modal>
  )
}

function Corpo({
  montada,
  texto,
  aoMudarTexto,
  caixa,
  idDoTexto,
  perguntando,
  gravando,
  marcadaNoDia,
  aoAbrirWhatsApp,
  aoCopiar,
  aoMarcar,
  aoNaoEnviei,
  aoFechar,
}: {
  montada: MensagemMontadaSaida
  texto: string
  aoMudarTexto: (t: string) => void
  caixa: RefObject<HTMLTextAreaElement | null>
  idDoTexto: string
  perguntando: boolean
  gravando: boolean
  marcadaNoDia: string | null
  aoAbrirWhatsApp: () => void
  aoCopiar: () => void
  aoMarcar: () => void
  aoNaoEnviei: () => void
  aoFechar: () => void
}) {
  const semMensagem = montada.texto === ''
  // O link sai do texto EDITADO (L2826), montado pela mesma função de domínio
  // que valida o telefone e codifica o texto (A-14).
  const link = montada.telefone === null || semMensagem ? null : linkDoWhatsAppComTexto(montada.telefone, texto)

  return (
    <>
      <p className="msg-para">
        Para <strong>{montada.para}</strong>
        {marcadaNoDia !== null && <span className="msg-marcada"> · marcada como enviada em {diaCurto(marcadaNoDia)}</span>}
      </p>

      {montada.avisos.length > 0 && (
        <ul className="msg-avisos">
          {montada.avisos.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      )}

      {!semMensagem && (
        <label className="campo msg-campo" htmlFor={idDoTexto}>
          Texto da mensagem
          <textarea
            id={idDoTexto}
            ref={caixa}
            className="msg-texto"
            rows={9}
            value={texto}
            onChange={(e) => aoMudarTexto(e.target.value)}
          />
        </label>
      )}

      {montada.passos.length > 0 && (
        <details className="msg-passos">
          <summary>Passo a passo</summary>
          <ol>
            {montada.passos.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ol>
        </details>
      )}

      {perguntando ? (
        <div className="msg-pergunta" role="group" aria-label="Confirmar o envio">
          <p>
            Você enviou a mensagem no WhatsApp? Abrir a conversa não confirma o envio: marque só se ela saiu.
          </p>
          <div className="msg-acoes">
            <button type="button" className="btn ghost" onClick={aoNaoEnviei}>
              Ainda não
            </button>
            <button type="button" className="btn" onClick={aoMarcar} disabled={gravando}>
              {gravando ? 'Marcando…' : 'Sim, marcar como enviada'}
            </button>
          </div>
        </div>
      ) : (
        <div className="msg-acoes">
          {link !== null && (
            <a className="btn" href={link} target="_blank" rel="noopener noreferrer" onClick={aoAbrirWhatsApp}>
              Abrir no WhatsApp
            </a>
          )}
          {!semMensagem && (
            <button type="button" className="btn ghost" onClick={aoCopiar}>
              Copiar
            </button>
          )}
          {!semMensagem && !montada.restrita && (
            <button type="button" className="btn ghost" onClick={aoMarcar} disabled={gravando}>
              Marcar como enviada
            </button>
          )}
          <button type="button" className="link msg-fechar" onClick={aoFechar}>
            Fechar
          </button>
        </div>
      )}
    </>
  )
}
