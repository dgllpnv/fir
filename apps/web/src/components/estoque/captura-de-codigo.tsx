'use client'

import { type CodigoLido, interpretarCodigo } from '@fir/domain'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Modal } from '../modal'
import { abrirCamera, ErroDaCamera, type FalhaDaCamera, lerDaFoto } from './decodificador'

/**
 * **A captura do código — os três caminhos do protótipo** (`abrirLeitor`):
 *
 *  1. **câmera ao vivo**, a traseira (`facingMode: environment`), que abre
 *     sozinha quando o navegador deixa;
 *  2. **"Tirar foto do código"** — `<input capture="environment">`, que
 *     funciona em qualquer celular, inclusive onde a câmera ao vivo não abre
 *     (permissão negada, navegador embutido de aplicativo);
 *  3. **o campo de texto**, onde o leitor de código de barras USB digita e dá
 *     Enter, ou onde se digita o número embaixo do código.
 *
 * O que sai daqui é um {@link CodigoLido} — a interpretação é do domínio. Quem
 * chama decide o que fazer com ele (achar o item, preencher o cadastro).
 *
 * **A câmera fecha sempre**: ao ler, ao tocar em Fechar, no Esc, quando a
 * ABA FICA OCULTA (S-17: a recepcionista troca de aba ou bloqueia o celular
 * com o leitor aberto) e quando o componente sai da tela por qualquer outro
 * motivo — o `parar` está no `cleanup` do efeito, não só no botão. Oculta, ela
 * não religa sozinha ao voltar: a pessoa toca em "Ligar a câmera".
 */
export function CapturaDeCodigo({
  titulo,
  aoLer,
  aoFechar,
}: {
  titulo: string
  aoLer: (c: CodigoLido) => void
  aoFechar: () => void
}) {
  const video = useRef<HTMLVideoElement>(null)
  const foto = useRef<HTMLInputElement>(null)
  const campo = useRef<HTMLInputElement>(null)
  const idDoCampo = useId()
  const [camera, setCamera] = useState<EstadoDaCamera>('abrindo')
  /** Cada valor é uma abertura da câmera; "Ligar a câmera" soma um. */
  const [abertura, setAbertura] = useState(0)
  const [lendoFoto, setLendoFoto] = useState(false)
  const [recado, setRecado] = useState<string | null>(null)
  const [texto, setTexto] = useState('')

  // A leitura entrega UMA vez: a câmera lê o mesmo código várias vezes por
  // segundo, e a segunda entrega abriria o formulário duas vezes.
  const entregue = useRef(false)
  const aoLerAtual = useRef(aoLer)
  aoLerAtual.current = aoLer
  const entregar = (bruto: string) => {
    const t = bruto.trim()
    if (t === '' || entregue.current) return
    entregue.current = true
    aoLerAtual.current(interpretarCodigo(t))
  }
  const entregarAtual = useRef(entregar)
  entregarAtual.current = entregar
  // Estável: o `Modal` refaz o efeito do foco quando `aoFechar` muda, e uma
  // função nova a cada pintura do pai tiraria o foco do campo no meio da
  // digitação.
  const aoFecharAtual = useRef(aoFechar)
  aoFecharAtual.current = aoFechar
  const fechar = useCallback(() => aoFecharAtual.current(), [])

  useEffect(() => {
    const v = video.current
    if (v === null) return
    let vivo = true
    // O `parar` existe desde já: se a tela sair enquanto a câmera ainda abre
    // (a foto leu primeiro, Esc, Fechar), ela é solta na hora.
    const cam = abrirCamera(v, (t) => entregarAtual.current(t))
    cam.pronta
      .then(() => {
        if (vivo) setCamera('ao-vivo')
      })
      .catch((e: unknown) => {
        if (vivo) setCamera(e instanceof ErroDaCamera ? e.falha : 'outra')
      })
    // A aba oculta solta a câmera (S-17). Sem isto, o leitor esquecido aberto
    // numa aba de fundo deixa a câmera do balcão ligada o dia inteiro.
    const aoMudarVisibilidade = () => {
      if (!document.hidden || !vivo) return
      vivo = false
      cam.parar()
      setCamera('pausada')
    }
    document.addEventListener('visibilitychange', aoMudarVisibilidade)
    return () => {
      vivo = false
      cam.parar()
      document.removeEventListener('visibilitychange', aoMudarVisibilidade)
    }
  }, [abertura])

  // Com mouse (o computador do balcão, onde fica o leitor USB), o foco vai
  // para o campo: o leitor digita ali sem ninguém tocar em nada. No celular,
  // não — o teclado subiria por cima da câmera.
  useEffect(() => {
    if (!window.matchMedia('(pointer: fine)').matches) return
    const t = setTimeout(() => campo.current?.focus(), 0)
    return () => clearTimeout(t)
  }, [])

  async function aoEscolherFoto(arquivo: File | undefined): Promise<void> {
    if (arquivo === undefined) return
    setLendoFoto(true)
    setRecado('Lendo a foto…')
    try {
      const lido = await lerDaFoto(arquivo)
      if (lido === null) {
        setRecado(
          'Não foi possível ler o código nesta foto. Tente de novo, mais perto e com boa luz, ou digite o código.',
        )
        return
      }
      setRecado(null)
      entregar(lido)
    } catch {
      setRecado('Não consegui abrir esta foto. Tente de novo, ou digite o código.')
    } finally {
      setLendoFoto(false)
      // Sem limpar, escolher a MESMA foto de novo não dispara `change`.
      if (foto.current !== null) foto.current.value = ''
    }
  }

  const falhou = camera !== 'abrindo' && camera !== 'ao-vivo'

  /*
    PORTAL para o `body`, e `stopPropagation` no envio do campo — as duas
    coisas, porque cada uma fecha uma porta diferente. O leitor abre DE DENTRO
    do formulário de entrada/saída e do cadastro: sem o portal, o `<form>` do
    campo ficaria aninhado no `<form>` de fora (HTML inválido); e o evento
    sintético do React atravessa portais pela árvore de componentes, então sem
    o `stopPropagation` o Enter do leitor USB enviaria TAMBÉM o formulário de
    fora — no cadastro, salvaria o item pela metade.
  */
  return createPortal(
    <Modal titulo={titulo} aoFechar={fechar}>
      {falhou ? null : (
        <div className="leitor-camera" data-estado={camera}>
          <video ref={video} muted playsInline aria-label="Imagem da câmera" />
          <span className="mira" />
        </div>
      )}

      <p className="nota" aria-live="polite" style={{ margin: 0 }}>
        {recado ?? FRASE_DA_CAMERA[camera]}
      </p>

      <div className="botoes">
        <button
          type="button"
          className="btn"
          disabled={lendoFoto}
          onClick={() => foto.current?.click()}
        >
          {lendoFoto ? 'Lendo a foto…' : 'Tirar foto do código'}
        </button>
        {camera === 'pausada' ? (
          <button
            type="button"
            className="btn ghost"
            onClick={() => {
              setCamera('abrindo')
              setAbertura((n) => n + 1)
            }}
          >
            Ligar a câmera
          </button>
        ) : null}
        <button type="button" className="btn ghost" onClick={fechar}>
          Fechar
        </button>
      </div>
      <input
        ref={foto}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        aria-label="Foto do código"
        onChange={(e) => void aoEscolherFoto(e.target.files?.[0])}
      />

      <form
        className="leitor-digitado"
        onSubmit={(e) => {
          e.preventDefault()
          e.stopPropagation()
          entregar(texto)
        }}
      >
        <div className="campo">
          <label htmlFor={idDoCampo}>Ou digite o código (o leitor USB digita aqui)</label>
          <div className="leitor-digitado-linha">
            <input
              id={idDoCampo}
              ref={campo}
              type="text"
              autoComplete="off"
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              placeholder="Ex.: 7891234567895"
            />
            <button type="submit" className="btn ghost" disabled={texto.trim() === ''}>
              Usar código
            </button>
          </div>
        </div>
      </form>
    </Modal>,
    document.body,
  )
}

type EstadoDaCamera = 'abrindo' | 'ao-vivo' | 'pausada' | FalhaDaCamera

const FRASE_DA_CAMERA: Record<EstadoDaCamera, string> = {
  abrindo: 'Abrindo a câmera…',
  pausada:
    'A câmera foi desligada quando esta aba saiu da tela. Toque em “Ligar a câmera” para ler de novo.',
  'ao-vivo':
    'Aponte a câmera para a etiqueta da ferramenta ou para o código da caixa do medicamento.',
  'sem-suporte':
    'Este navegador não abre a câmera ao vivo. Use “Tirar foto do código”, que funciona em qualquer celular, ou digite o código.',
  negada:
    'A câmera não foi permitida. Use “Tirar foto do código”, ou permita a câmera nas configurações do navegador e abra o leitor de novo.',
  'sem-camera':
    'Nenhuma câmera encontrada neste aparelho. Passe o leitor de código de barras no campo abaixo, digite o código ou escolha uma foto.',
  outra:
    'A câmera ao vivo não abriu aqui. Use “Tirar foto do código”: funciona em qualquer celular.',
}
