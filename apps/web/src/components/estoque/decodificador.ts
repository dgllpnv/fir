/**
 * **O DECODIFICADOR** — a imagem da câmera, ou a foto, virando o TEXTO do
 * código. É o único arquivo que conhece a biblioteca: o resto da tela recebe
 * uma string e a entrega a `interpretarCodigo`, do domínio.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUE ZXING, EMPACOTADO, E CARREGADO SÓ QUANDO SE ABRE O LEITOR
 *
 *  - **Empacotado, nunca CDN.** O protótipo carrega `html5-qrcode` de um CDN;
 *    script de terceiro numa página que mostra dado de saúde é a porta que
 *    D-E6/D-E7 deixaram fechada. Aqui o código vem do nosso próprio build, com
 *    a versão travada no `package.json` e o hash no `pnpm-lock.yaml`.
 *  - **`@zxing/browser` + `@zxing/library`, não `html5-qrcode`.** O
 *    `html5-qrcode` é uma casca de interface sobre a mesma ZXing, parada desde
 *    2023 e que desenha a própria tela (com botões e textos dela, em inglês).
 *    A ZXing lê os quatro formatos que a clínica encontra — QR da etiqueta,
 *    DataMatrix GS1 da caixa, EAN-13/EAN-8 e Code 128 — e nos deixa desenhar a
 *    interface da casa.
 *  - **Linha 0.21/0.1, e não a 0.23.** A 0.23 declara `engines: node >= 24`, e
 *    o build da web (local e o `Dockerfile`) é Node 22.
 *  - **`import()` dinâmico.** A biblioteca só desce quando alguém toca em "Ler
 *    código": quem abre o Estoque para conferir saldo não paga por ela.
 * ────────────────────────────────────────────────────────────────────────────
 */

import type { BrowserMultiFormatReader } from '@zxing/browser'

/** O que a tela precisa para parar a câmera — e só isso. */
export type CameraAberta = { readonly parar: () => void }

/**
 * Por que a câmera não abriu, em palavras de balcão.
 *
 * `sem-suporte` é o navegador sem `getUserMedia` (ou a página fora de HTTPS);
 * `negada` é a permissão recusada; `sem-camera` é o computador sem webcam.
 * Os três têm a mesma saída — foto ou digitação —, mas a frase muda, porque
 * "permita a câmera" para quem não tem câmera é instrução que não se cumpre.
 */
export type FalhaDaCamera = 'sem-suporte' | 'negada' | 'sem-camera' | 'outra'

let leitor: Promise<BrowserMultiFormatReader> | null = null

/** A biblioteca, carregada uma vez por aba e só quando o leitor abre. */
function carregarLeitor(): Promise<BrowserMultiFormatReader> {
  leitor ??= Promise.all([import('@zxing/browser'), import('@zxing/library')]).then(
    ([browser, lib]) => {
      const dicas = new Map<unknown, unknown>([
        [
          lib.DecodeHintType.POSSIBLE_FORMATS,
          [
            lib.BarcodeFormat.QR_CODE,
            lib.BarcodeFormat.DATA_MATRIX,
            lib.BarcodeFormat.EAN_13,
            lib.BarcodeFormat.EAN_8,
            lib.BarcodeFormat.UPC_A,
            lib.BarcodeFormat.CODE_128,
          ],
        ],
        [lib.DecodeHintType.TRY_HARDER, true],
        // Code 128 com FNC1 (GS1-128): sem esta dica o separador de grupo some
        // e o lote gruda no AI seguinte.
        [lib.DecodeHintType.ASSUME_GS1, true],
      ])
      // `as`: a assinatura da ZXing pede `Map<DecodeHintType, any>`, e o mapa
      // acima é exatamente isso, montado com as chaves do próprio enum.
      return new browser.BrowserMultiFormatReader(
        dicas as Map<import('@zxing/library').DecodeHintType, unknown>,
        { delayBetweenScanAttempts: 150, delayBetweenScanSuccess: 500 },
      )
    },
  )
  // Uma falha de rede no import não pode ficar guardada para sempre: a
  // próxima abertura tenta de novo.
  leitor.catch(() => {
    leitor = null
  })
  return leitor
}

/**
 * O texto como a ZXing o entrega, na forma que o domínio reconhece.
 *
 * No DataMatrix GS1 o primeiro símbolo é o FNC1, e a ZXing o traduz para o
 * separador de grupo (ASCII 29) **no início** do texto. O domínio espera o
 * identificador de simbologia `]d2` nessa posição — é o que o leitor USB manda
 * — e um GS solto na frente faria `01<gtin>17<validade>` não ser reconhecido.
 */
export function textoDaLeitura(bruto: string): string {
  return bruto.startsWith('\u001d') ? `]d2${bruto.slice(1)}` : bruto
}

/**
 * A câmera ao vivo, a traseira quando houver (`facingMode: environment`).
 *
 * `aoLer` é chamado a cada leitura; quem chama decide parar.
 *
 * **O `parar` vale em QUALQUER fase, inclusive antes de a câmera terminar de
 * abrir** — e é por isso que ele é devolvido na hora, não depois da promessa.
 * Medido no teste de navegador: a pessoa lia pela foto (ou fechava o leitor)
 * enquanto a câmera ainda abria; o vídeo já tinha saído da tela, a ZXing
 * esperava o `play()` dele por até cinco segundos, e durante esse tempo a luz
 * da câmera ficava acesa. Aqui o stream é pedido por nós, guardado assim que
 * chega, e `parar` desliga as faixas dele na hora — a luz apagando é a prova,
 * para a pessoa, de que a ferramenta soltou a câmera.
 */
export function abrirCamera(
  video: HTMLVideoElement,
  aoLer: (texto: string) => void,
): CameraAberta & { readonly pronta: Promise<void> } {
  let parado = false
  let stream: MediaStream | null = null
  let controles: { stop: () => void } | null = null

  const desligar = () => {
    controles?.stop()
    if (stream !== null) for (const t of stream.getTracks()) t.stop()
    video.srcObject = null
  }

  const pronta = (async () => {
    if (typeof navigator === 'undefined' || navigator.mediaDevices?.getUserMedia === undefined) {
      throw new ErroDaCamera('sem-suporte')
    }
    // A biblioteca ANTES da câmera: se o download falhar, a câmera nem acende.
    const r = await carregarLeitor()
    if (parado) return
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
        audio: false,
      })
    } catch (e) {
      throw new ErroDaCamera(falhaDe(e))
    }
    if (parado) {
      desligar()
      return
    }
    try {
      controles = await r.decodeFromStream(stream, video, (resultado) => {
        if (resultado !== undefined && !parado) aoLer(textoDaLeitura(resultado.getText()))
      })
    } catch (e) {
      desligar()
      if (parado) return
      throw new ErroDaCamera(falhaDe(e))
    }
    if (parado) desligar()
  })()

  return {
    pronta,
    parar: () => {
      parado = true
      desligar()
    },
  }
}

/**
 * Lê o código de uma FOTO.
 *
 * A foto do celular tem 12 megapixels, e a ZXing em JavaScript leva segundos
 * nesse tamanho; reduzida a 1600 px no lado maior, o código de uma caixa
 * fotografada de perto continua com módulos de sobra. Se a reduzida não ler, a
 * original ainda tem uma chance — o código pequeno numa foto de longe.
 *
 * `null` = não achou código. Nunca lança por "não achou": isso é o caso
 * comum, e a tela responde com a frase, não com erro.
 */
export async function lerDaFoto(arquivo: Blob): Promise<string | null> {
  const r = await carregarLeitor()
  const imagem = await createImageBitmap(arquivo)
  try {
    const maior = Math.max(imagem.width, imagem.height)
    const escalas = maior > 1600 ? [1600 / maior, 1] : [1]
    for (const escala of escalas) {
      const tela = document.createElement('canvas')
      tela.width = Math.max(1, Math.round(imagem.width * escala))
      tela.height = Math.max(1, Math.round(imagem.height * escala))
      const ctx = tela.getContext('2d')
      if (ctx === null) return null
      ctx.drawImage(imagem, 0, 0, tela.width, tela.height)
      try {
        return textoDaLeitura(r.decodeFromCanvas(tela).getText())
      } catch {
        // NotFound/Checksum/Format: tenta a próxima escala.
      }
    }
    return null
  } finally {
    imagem.close()
  }
}

export class ErroDaCamera extends Error {
  constructor(readonly falha: FalhaDaCamera) {
    super(falha)
  }
}

function falhaDe(e: unknown): FalhaDaCamera {
  const nome = e instanceof Error ? e.name : ''
  if (nome === 'NotAllowedError' || nome === 'SecurityError') return 'negada'
  if (nome === 'NotFoundError' || nome === 'OverconstrainedError') return 'sem-camera'
  return 'outra'
}
