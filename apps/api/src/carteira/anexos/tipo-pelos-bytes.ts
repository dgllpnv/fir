import type { TipoDeAnexo } from '@fir/contracts'

/**
 * O TIPO DE UM ANEXO, DECIDIDO PELOS BYTES (gate appsec A-13).
 *
 * Nem a extensão nem o `Content-Type` do navegador entram na decisão: os dois
 * são escritos por quem envia. A extensão só desempata DENTRO da família
 * texto (`.csv` → `text/csv`), que não tem assinatura — e ali o resultado é
 * sempre um tipo inerte.
 *
 * Função pura, sem I/O: recebe o arquivo inteiro (≤ 20 MB, já contado no
 * stream) porque o DOCX/XLSX/PPTX só se reconhece pelo diretório central do
 * ZIP, que mora no FIM do arquivo.
 *
 * SVG e HTML são recusados com motivo próprio, e não só "por não estarem na
 * lista": o `accept="image/*"` do protótipo deixa SVG passar, e SVG servido
 * inline é XSS armazenado. O download ainda sai com `attachment`, `nosniff` e
 * `CSP: sandbox` — esta é a primeira camada, não a única.
 */

export type MotivoDeRecusa = 'vazio' | 'svg' | 'html' | 'executavel' | 'macro' | 'desconhecido'

export type Deteccao =
  | { readonly aceito: true; readonly tipo: TipoDeAnexo }
  | { readonly aceito: false; readonly motivo: MotivoDeRecusa }

const comeca = (b: Uint8Array, assinatura: readonly number[], deslocamento = 0): boolean =>
  b.length >= deslocamento + assinatura.length &&
  assinatura.every((x, i) => b[deslocamento + i] === x)

const ascii = (s: string): number[] => [...s].map((c) => c.charCodeAt(0))

const MIME_DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const MIME_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const MIME_PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation'

/** Executáveis conhecidos — recusa com motivo, antes de qualquer outra regra. */
const EXECUTAVEIS: readonly (readonly number[])[] = [
  [0x7f, 0x45, 0x4c, 0x46], // ELF
  [0xfe, 0xed, 0xfa, 0xce],
  [0xfe, 0xed, 0xfa, 0xcf],
  [0xce, 0xfa, 0xed, 0xfe],
  [0xcf, 0xfa, 0xed, 0xfe], // Mach-O
  [0xca, 0xfe, 0xba, 0xbe], // Mach-O universal / classe Java
  [0x00, 0x61, 0x73, 0x6d], // WebAssembly
]

/**
 * As marcas de MP4 aceitas (`ftyp`). Lista fechada: `ftyp` sozinho também
 * abre HEIC, QuickTime e 3GP, que não são o que o protótipo aceita.
 */
const MARCAS_MP4: ReadonlySet<string> = new Set([
  'isom', 'iso2', 'iso3', 'iso4', 'iso5', 'iso6', 'mp41', 'mp42', 'mp71', 'avc1', 'M4V ', 'dash', 'MSNV', 'mmp4',
])

function binarioConhecido(b: Uint8Array): TipoDeAnexo | null {
  if (comeca(b, ascii('%PDF-'))) return 'application/pdf'
  if (comeca(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png'
  if (comeca(b, [0xff, 0xd8, 0xff])) return 'image/jpeg'
  if (comeca(b, ascii('GIF87a')) || comeca(b, ascii('GIF89a'))) return 'image/gif'
  if (comeca(b, ascii('RIFF')) && comeca(b, ascii('WEBP'), 8)) return 'image/webp'
  if (comeca(b, ascii('ftyp'), 4) && b.length >= 12) {
    const marca = String.fromCharCode(b[8]!, b[9]!, b[10]!, b[11]!)
    return MARCAS_MP4.has(marca) ? 'video/mp4' : null
  }
  if (comeca(b, [0x1a, 0x45, 0xdf, 0xa3])) {
    // EBML também é Matroska (.mkv); o DocType `webm` mora no cabeçalho.
    const cabeca = Buffer.from(b.subarray(0, Math.min(b.length, 64))).toString('latin1')
    return cabeca.includes('webm') ? 'video/webm' : null
  }
  return null
}

const u16 = (b: Uint8Array, i: number): number => b[i]! | (b[i + 1]! << 8)
const u32 = (b: Uint8Array, i: number): number => (b[i]! | (b[i + 1]! << 8) | (b[i + 2]! << 16) | (b[i + 3]! << 24)) >>> 0

/**
 * Os nomes do diretório central de um ZIP, ou `null` se não for um ZIP bem
 * formado. ZIP64 (marcadores `0xFFFF`/`0xFFFFFFFF`) é recusado: um documento
 * do Office de até 20 MB nunca precisa dele.
 */
function nomesDoZip(b: Uint8Array): string[] | null {
  const MIN_EOCD = 22
  if (b.length < MIN_EOCD) return null
  const limite = Math.max(0, b.length - MIN_EOCD - 0xffff)
  let eocd = -1
  for (let i = b.length - MIN_EOCD; i >= limite; i--) {
    if (b[i] === 0x50 && b[i + 1] === 0x4b && b[i + 2] === 0x05 && b[i + 3] === 0x06) {
      eocd = i
      break
    }
  }
  if (eocd < 0) return null
  const total = u16(b, eocd + 10)
  const tamanhoDoDiretorio = u32(b, eocd + 12)
  const inicio = u32(b, eocd + 16)
  if (total === 0xffff || tamanhoDoDiretorio === 0xffffffff || inicio === 0xffffffff) return null
  if (inicio + tamanhoDoDiretorio > eocd) return null

  const nomes: string[] = []
  let p = inicio
  for (let n = 0; n < total; n++) {
    if (p + 46 > eocd || u32(b, p) !== 0x02014b50) return null
    const tamNome = u16(b, p + 28)
    const tamExtra = u16(b, p + 30)
    const tamComentario = u16(b, p + 32)
    if (p + 46 + tamNome > eocd) return null
    nomes.push(Buffer.from(b.subarray(p + 46, p + 46 + tamNome)).toString('utf8'))
    p += 46 + tamNome + tamExtra + tamComentario
  }
  return nomes
}

function office(b: Uint8Array): Deteccao {
  const nomes = nomesDoZip(b)
  if (nomes === null) return { aceito: false, motivo: 'desconhecido' }
  const tem = (n: string): boolean => nomes.includes(n)
  // Macro (VBA) não vive em .docx/.xlsx/.pptx legítimos — só nos `*m`, que
  // não estão na lista. Um "docx" com `vbaProject.bin` é um docm renomeado.
  if (nomes.some((n) => n.toLowerCase().endsWith('vbaproject.bin'))) return { aceito: false, motivo: 'macro' }
  if (!tem('[Content_Types].xml')) return { aceito: false, motivo: 'desconhecido' }
  const candidatos: TipoDeAnexo[] = []
  if (tem('word/document.xml')) candidatos.push(MIME_DOCX)
  if (tem('xl/workbook.xml')) candidatos.push(MIME_XLSX)
  if (tem('ppt/presentation.xml')) candidatos.push(MIME_PPTX)
  // Zero é um ZIP qualquer; dois é ambíguo de propósito. Os dois ficam de fora.
  return candidatos.length === 1 ? { aceito: true, tipo: candidatos[0]! } : { aceito: false, motivo: 'desconhecido' }
}

/**
 * Marcação que um navegador ou um visualizador trataria como documento ativo.
 * Procurada no arquivo inteiro, e não só no começo: o sniffing do navegador
 * olha os primeiros 512 bytes, mas um visualizador local não.
 */
const MARCACAO_SVG = /<\s*svg[\s>/]/i
const MARCACAO_HTML =
  /<\s*(?:!doctype\s+html|html|head|body|script|iframe|frame|frameset|object|embed|meta|link|style|form|img|a|base|xml|\?xml|math)[\s>/]/i

function texto(b: Uint8Array, extensao: string): Deteccao {
  // Bytes de controle (fora TAB, LF, VT, FF, CR e o SUB do fim de arquivo do
  // DOS) dizem "binário". UTF-16 cai aqui pelos NUL. Latin-1/Windows-1252 —
  // o CSV que o Excel brasileiro exporta — passa, porque não tem controle.
  for (let i = 0; i < b.length; i++) {
    const x = b[i]!
    if (x < 0x20 && x !== 0x09 && x !== 0x0a && x !== 0x0b && x !== 0x0c && x !== 0x0d && x !== 0x1a) {
      return { aceito: false, motivo: 'desconhecido' }
    }
    if (x === 0x7f) return { aceito: false, motivo: 'desconhecido' }
  }
  // `latin1` decodifica qualquer byte sem falhar, e as marcações procuradas
  // são ASCII — o resultado é o mesmo para UTF-8 e para Windows-1252.
  const conteudo = Buffer.from(b).toString('latin1').replace(/^\u00ef\u00bb\u00bf/, '')
  if (MARCACAO_SVG.test(conteudo)) return { aceito: false, motivo: 'svg' }
  if (MARCACAO_HTML.test(conteudo)) return { aceito: false, motivo: 'html' }
  if (conteudo.trimStart().startsWith('#!')) return { aceito: false, motivo: 'executavel' }
  if (extensao === 'csv') return { aceito: true, tipo: 'text/csv' }
  if (extensao === 'md' || extensao === 'markdown') return { aceito: true, tipo: 'text/markdown' }
  return { aceito: true, tipo: 'text/plain' }
}

const extensaoDe = (nome: string): string => {
  const ponto = nome.lastIndexOf('.')
  return ponto < 0 ? '' : nome.slice(ponto + 1).toLowerCase()
}

export function detectarTipo(bytes: Uint8Array, nomeOriginal: string): Deteccao {
  if (bytes.length === 0) return { aceito: false, motivo: 'vazio' }
  if (EXECUTAVEIS.some((s) => comeca(bytes, s))) return { aceito: false, motivo: 'executavel' }
  // PE/DOS (Windows). `MZ` sozinho também começa um texto ("MZ Consultoria"),
  // e o cabeçalho de um executável de verdade tem NUL nos primeiros 64 bytes.
  if (comeca(bytes, ascii('MZ')) && bytes.subarray(0, 64).includes(0)) return { aceito: false, motivo: 'executavel' }

  const binario = binarioConhecido(bytes)
  if (binario !== null) return { aceito: true, tipo: binario }

  if (comeca(bytes, [0x50, 0x4b, 0x03, 0x04])) return office(bytes)

  return texto(bytes, extensaoDe(nomeOriginal))
}

/** A extensão canônica de cada tipo, e as que também valem para ele. */
const EXTENSOES: Readonly<Record<TipoDeAnexo, readonly string[]>> = {
  'application/pdf': ['pdf'],
  'image/png': ['png'],
  'image/jpeg': ['jpg', 'jpeg', 'jpe', 'jfif'],
  'image/webp': ['webp'],
  'image/gif': ['gif'],
  [MIME_DOCX]: ['docx'],
  [MIME_XLSX]: ['xlsx'],
  [MIME_PPTX]: ['pptx'],
  'text/plain': ['txt', 'text', 'log'],
  'text/csv': ['csv'],
  'text/markdown': ['md', 'markdown'],
  'video/mp4': ['mp4', 'm4v'],
  'video/webm': ['webm'],
}

const TAMANHO_MAXIMO_DO_NOME = 200

/** Por ponto de código, não por unidade UTF-16 — é o que o `length()` do Postgres conta. */
const cortar = (s: string, max: number): string => Array.from(s).slice(0, max).join('')

/**
 * O nome que o usuário deu, pronto para EXIBIR e para o `Content-Disposition`
 * — nunca para o disco (lá o nome é o UUID).
 *
 * - tira o caminho (`C:\fakepath\x.pdf`, `../../x.pdf`);
 * - tira caractere de controle e os de direção bidirecional (o truque
 *   `fatura\u202Efdp.exe`, que se lê "fatura exe.pdf");
 * - garante a extensão COERENTE com o tipo detectado: um texto chamado
 *   `pagina.html` vira `pagina.html.txt`. Quem baixa e dá dois cliques abre
 *   com o programa do tipo real, nunca com o navegador.
 */
export function nomeParaExibir(bruto: string, tipo: TipoDeAnexo): string {
  let nome = bruto.normalize('NFC')
  nome = nome.split(/[\\/]/).pop() ?? ''
  nome = nome.replace(/[\u0000-\u001f\u007f-\u009f\u061c\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, '')
  nome = nome.trim().replace(/^\.+/, '').trim()

  const aceitas = EXTENSOES[tipo]
  const canonica = aceitas[0]!
  const ext = extensaoDe(nome)
  const coerente = nome !== '' && aceitas.includes(ext)
  const base = nome === '' ? 'anexo' : coerente ? nome.slice(0, nome.length - ext.length - 1) : nome
  const sufixo = coerente ? nome.slice(nome.length - ext.length - 1) : `.${canonica}`
  return `${cortar(base, TAMANHO_MAXIMO_DO_NOME - Array.from(sufixo).length) || 'anexo'}${sufixo}`
}

/**
 * `Content-Disposition: attachment` com `filename` ASCII de reserva e
 * `filename*` em UTF-8 (RFC 6266 / RFC 5987). Nada do nome escapa das aspas:
 * `"`, `\`, `;` e qualquer byte fora do ASCII imprimível viram `_` na
 * reserva, e a forma estendida é percent-codificada por inteiro.
 */
export function cabecalhoDeAnexo(nome: string): string {
  const reserva = nome
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7e]/g, '_')
    .replace(/["\\;]/g, '_')
  const estendido = encodeURIComponent(nome).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  )
  return `attachment; filename="${reserva}"; filename*=UTF-8''${estendido}`
}
