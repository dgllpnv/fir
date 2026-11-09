/**
 * A MÍDIA DO TESTE DE NAVEGADOR DO LEITOR — gerada aqui, a cada execução.
 *
 * Nada de imagem binária versionada: o EAN-13 é montado à mão (tabelas L/G/R
 * e a paridade pelo primeiro dígito), o DataMatrix GS1 sai do codificador da
 * própria ZXing que a tela usa para ler, e o PNG e o Y4M são escritos com
 * `node:zlib` e bytes crus. Quem quiser saber o que a câmera falsa mostra lê
 * este arquivo, não um blob.
 *
 * O Y4M é o "vídeo" que o Chromium entrega como câmera
 * (`--use-file-for-fake-video-capture`): a mesma imagem repetida, em loop.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deflateSync } from 'node:zlib'
import { BarcodeFormat, DataMatrixWriter } from '@zxing/library'

export const PASTA_DA_MIDIA = join(tmpdir(), 'fir-e2e-leitor')

const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011']
const inverter = (p: string) => [...p].map((b) => (b === '0' ? '1' : '0')).join('')
const G = L.map((p) => [...inverter(p)].reverse().join(''))
const R = L.map(inverter)
const PARIDADE = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL']

/** O dígito verificador do EAN-13. */
export function ean13(doze: string): string {
  let soma = 0
  for (let i = 0; i < 12; i++) soma += Number(doze[i]) * (i % 2 === 0 ? 1 : 3)
  return doze + String((10 - (soma % 10)) % 10)
}

function barrasEan13(codigo: string): string {
  const p = PARIDADE[Number(codigo[0])]!
  let b = '101'
  for (let i = 1; i <= 6; i++) b += (p[i - 1] === 'L' ? L : G)[Number(codigo[i])]!
  b += '01010'
  for (let i = 7; i <= 12; i++) b += R[Number(codigo[i])]!
  return b + '101'
}

type Quadro = { largura: number; altura: number; px: Uint8Array }

/** Matriz booleana em pixels cinza (0 = preto), centrada num quadro branco. */
function rasterizar(
  preto: (x: number, y: number) => boolean,
  w: number,
  h: number,
  escala: number,
  largura: number,
  altura: number,
): Quadro {
  const px = new Uint8Array(largura * altura).fill(255)
  const ox = Math.floor((largura - w * escala) / 2)
  const oy = Math.floor((altura - h * escala) / 2)
  for (let y = 0; y < h * escala; y++) {
    for (let x = 0; x < w * escala; x++) {
      if (preto(Math.floor(x / escala), Math.floor(y / escala))) px[(oy + y) * largura + ox + x] = 0
    }
  }
  return { largura, altura, px }
}

const TABELA_CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
function crc32(b: Buffer): number {
  let c = 0xffffffff
  for (const byte of b) c = TABELA_CRC[(c ^ byte) & 0xff]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function blocoPng(tipo: string, dados: Buffer): Buffer {
  const tam = Buffer.alloc(4)
  tam.writeUInt32BE(dados.length)
  const corpo = Buffer.concat([Buffer.from(tipo, 'ascii'), dados])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(corpo))
  return Buffer.concat([tam, corpo, crc])
}

/** PNG em escala de cinza, 8 bits, sem filtro. */
function png({ largura, altura, px }: Quadro): Buffer {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(largura, 0)
  ihdr.writeUInt32BE(altura, 4)
  ihdr[8] = 8 // profundidade
  ihdr[9] = 0 // cinza
  const linhas = Buffer.alloc((largura + 1) * altura)
  for (let y = 0; y < altura; y++) {
    linhas[y * (largura + 1)] = 0
    Buffer.from(px.buffer, px.byteOffset + y * largura, largura).copy(linhas, y * (largura + 1) + 1)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    blocoPng('IHDR', ihdr),
    blocoPng('IDAT', deflateSync(linhas)),
    blocoPng('IEND', Buffer.alloc(0)),
  ])
}

/** Y4M 4:2:0 com o quadro repetido — o formato que o Chromium aceita como câmera. */
function y4m({ largura, altura, px }: Quadro, quadros: number): Buffer {
  const croma = Buffer.alloc((largura / 2) * (altura / 2) * 2, 128)
  const partes: Buffer[] = [Buffer.from(`YUV4MPEG2 W${largura} H${altura} F10:1 Ip A1:1 C420jpeg\n`)]
  for (let i = 0; i < quadros; i++) partes.push(Buffer.from('FRAME\n'), Buffer.from(px), croma)
  return Buffer.concat(partes)
}

/** O EAN da caixa do item de teste, e um código que nenhum item tem. */
export const CAIXA = ean13('789123456789')
export const OUTRA = ean13('400638133393')
/** DataMatrix GS1: (01) GTIN-14 · (17) validade com DIA 00 = último do mês · (10) lote. */
export const GS1 = `010${CAIXA}17270600` + '10LT2026A'

export type Midia = {
  /** Câmera falsa mostrando o EAN da caixa: a leitura ao vivo acontece sozinha. */
  cameraComEan: string
  /** Câmera falsa em branco: liga, mas nunca lê — para medir Fechar, Esc e aba oculta. */
  cameraEmBranco: string
  fotoDoEan: string
  fotoDoDataMatrix: string
}

/**
 * Escreve os arquivos (idempotente) e devolve os caminhos. Síncrono de
 * propósito: o caminho do vídeo entra nos argumentos do navegador, que o
 * Playwright lê quando o arquivo de teste é carregado.
 */
export function gerarMidia(): Midia {
  mkdirSync(PASTA_DA_MIDIA, { recursive: true })
  const bits = barrasEan13(CAIXA)
  const m: Midia = {
    cameraComEan: join(PASTA_DA_MIDIA, 'camera-ean.y4m'),
    cameraEmBranco: join(PASTA_DA_MIDIA, 'camera-em-branco.y4m'),
    fotoDoEan: join(PASTA_DA_MIDIA, 'ean-caixa.png'),
    fotoDoDataMatrix: join(PASTA_DA_MIDIA, 'datamatrix-caixa.png'),
  }
  writeFileSync(m.cameraComEan, y4m(rasterizar((x) => bits[x] === '1', bits.length, 60, 4, 640, 480), 10))
  writeFileSync(m.cameraEmBranco, y4m(rasterizar(() => false, 1, 1, 1, 320, 240), 10))
  writeFileSync(m.fotoDoEan, png(rasterizar((x) => bits[x] === '1', bits.length, 50, 3, bits.length * 3 + 60, 220)))
  const dm = new DataMatrixWriter().encode(GS1, BarcodeFormat.DATA_MATRIX, 0, 0, new Map())
  writeFileSync(
    m.fotoDoDataMatrix,
    png(
      rasterizar(
        (x, y) => dm.get(x, y),
        dm.getWidth(),
        dm.getHeight(),
        10,
        dm.getWidth() * 10 + 80,
        dm.getHeight() * 10 + 80,
      ),
    ),
  )
  return m
}
