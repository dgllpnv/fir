import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { cabecalhoDeAnexo, detectarTipo, nomeParaExibir } from './tipo-pelos-bytes'

const b = (s: string): Uint8Array => Buffer.from(s, 'latin1')
const cat = (...partes: (Uint8Array | number[])[]): Uint8Array =>
  Buffer.concat(partes.map((p) => Buffer.from(p as Uint8Array)))

/** Um ZIP mínimo (entradas "stored"), só com o que o detector lê. */
function zip(nomes: readonly string[]): Uint8Array {
  const locais: Buffer[] = []
  const centrais: Buffer[] = []
  let deslocamento = 0
  for (const n of nomes) {
    const nome = Buffer.from(n, 'utf8')
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(nome.length, 26)
    const corpo = Buffer.concat([local, nome])
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(nome.length, 28)
    central.writeUInt32LE(deslocamento, 42)
    centrais.push(Buffer.concat([central, nome]))
    locais.push(corpo)
    deslocamento += corpo.length
  }
  const diretorio = Buffer.concat(centrais)
  const fim = Buffer.alloc(22)
  fim.writeUInt32LE(0x06054b50, 0)
  fim.writeUInt16LE(nomes.length, 8)
  fim.writeUInt16LE(nomes.length, 10)
  fim.writeUInt32LE(diretorio.length, 12)
  fim.writeUInt32LE(deslocamento, 16)
  return Buffer.concat([...locais, diretorio, fim])
}

describe('detectarTipo — a lista de permissão pelos BYTES', () => {
  it.each([
    ['application/pdf', b('%PDF-1.7\n%âãÏÓ\n1 0 obj'), 'x.pdf'],
    ['image/png', cat([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], b('IHDR')), 'x.png'],
    ['image/jpeg', cat([0xff, 0xd8, 0xff, 0xe0], b('JFIF')), 'x.jpg'],
    ['image/gif', b('GIF89a\x01\x00'), 'x.gif'],
    ['image/webp', b('RIFF\x10\x00\x00\x00WEBPVP8 '), 'x.webp'],
    ['video/mp4', b('\x00\x00\x00\x18ftypisom\x00\x00\x02\x00'), 'x.mp4'],
    ['video/webm', cat([0x1a, 0x45, 0xdf, 0xa3], b('\x9fB\x86\x81\x01B\x82\x84webm')), 'x.webm'],
    ['text/plain', b('Reunião de segunda: revisar a agenda.\r\n'), 'notas.txt'],
    ['text/csv', b('nome;telefone\nAna;7199999\n'), 'lista.csv'],
    ['text/markdown', b('# Pauta\n\n- item\n'), 'pauta.md'],
  ] as const)('%s', (tipo, bytes, nome) => {
    expect(detectarTipo(bytes, nome)).toEqual({ aceito: true, tipo })
  })

  it('DOCX, XLSX e PPTX pelo diretório central do ZIP', () => {
    expect(detectarTipo(zip(['[Content_Types].xml', '_rels/.rels', 'word/document.xml']), 'a.docx')).toEqual({
      aceito: true,
      tipo: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    })
    expect(detectarTipo(zip(['[Content_Types].xml', 'xl/workbook.xml']), 'a.xlsx')).toEqual({
      aceito: true,
      tipo: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })
    expect(detectarTipo(zip(['[Content_Types].xml', 'ppt/presentation.xml']), 'a.pptx')).toEqual({
      aceito: true,
      tipo: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    })
  })

  it('a extensão não decide: um PDF chamado .txt continua PDF; um ZIP chamado .docx é recusado', () => {
    expect(detectarTipo(b('%PDF-1.4'), 'nota.txt')).toEqual({ aceito: true, tipo: 'application/pdf' })
    expect(detectarTipo(zip(['foto.jpg', 'outra.jpg']), 'contrato.docx')).toEqual({
      aceito: false,
      motivo: 'desconhecido',
    })
  })

  it('documento com macro (docm renomeado) é recusado', () => {
    expect(
      detectarTipo(zip(['[Content_Types].xml', 'word/document.xml', 'word/vbaProject.bin']), 'a.docx'),
    ).toEqual({ aceito: false, motivo: 'macro' })
  })

  it('ZIP truncado não é aceito', () => {
    const z = zip(['[Content_Types].xml', 'word/document.xml'])
    expect(detectarTipo(z.subarray(0, z.length - 5), 'a.docx').aceito).toBe(false)
  })

  it.each([
    ['svg', '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>', 'foto.png'],
    ['svg', '<?xml version="1.0"?>\n<svg>', 'imagem.svg'],
    ['svg', '\ufeff  <SVG >', 'x.txt'],
    ['html', '<!DOCTYPE html><html><body>oi</body></html>', 'nota.txt'],
    ['html', 'texto normal\n\n<script>fetch("/api")</script>', 'lista.csv'],
    ['html', '<iframe src="https://x">', 'pauta.md'],
  ] as const)('recusa %s mesmo com extensão de outro tipo (%s)', (motivo, conteudo, nome) => {
    expect(detectarTipo(Buffer.from(conteudo, 'utf8'), nome)).toEqual({ aceito: false, motivo })
  })

  it('recusa executáveis', () => {
    const pe = Buffer.alloc(128)
    pe.write('MZ', 0, 'latin1')
    expect(detectarTipo(pe, 'relatorio.pdf')).toEqual({ aceito: false, motivo: 'executavel' })
    expect(detectarTipo(cat([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0]), 'x.txt')).toEqual({
      aceito: false,
      motivo: 'executavel',
    })
    expect(detectarTipo(b('#!/bin/sh\nrm -rf /\n'), 'leia.txt')).toEqual({ aceito: false, motivo: 'executavel' })
  })

  it('um texto que só começa com "MZ" é texto', () => {
    expect(detectarTipo(Buffer.from('MZ Consultoria — ata da reunião\n', 'utf8'), 'ata.txt')).toEqual({
      aceito: true,
      tipo: 'text/plain',
    })
  })

  it('CSV em Windows-1252 (o que o Excel brasileiro exporta) é aceito', () => {
    expect(detectarTipo(Buffer.from([0x4a, 0x6f, 0xe3, 0x6f, 0x3b, 0x31, 0x0d, 0x0a]), 'x.csv')).toEqual({
      aceito: true,
      tipo: 'text/csv',
    })
  })

  it('binário desconhecido, UTF-16 e arquivo vazio são recusados', () => {
    expect(detectarTipo(cat([0x00, 0x01, 0x02, 0x03]), 'x.bin')).toEqual({ aceito: false, motivo: 'desconhecido' })
    expect(detectarTipo(Buffer.from('\ufeffoi', 'utf16le'), 'x.txt')).toEqual({
      aceito: false,
      motivo: 'desconhecido',
    })
    expect(detectarTipo(new Uint8Array(0), 'x.txt')).toEqual({ aceito: false, motivo: 'vazio' })
    // HEIC usa `ftyp` com outra marca — não é o MP4 da lista.
    expect(detectarTipo(b('\x00\x00\x00\x18ftypheic\x00\x00\x00\x00'), 'x.mp4').aceito).toBe(false)
  })

  it('propriedade: um arquivo aceito tem sempre um tipo da lista, e nenhum texto com <svg é aceito', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 512 }), fc.string(), (bytes, nome) => {
        const d = detectarTipo(bytes, nome)
        if (!d.aceito) return true
        return typeof d.tipo === 'string' && d.tipo.length > 0
      }),
    )
    fc.assert(
      fc.property(fc.string(), fc.string(), (antes, depois) => {
        const d = detectarTipo(Buffer.from(`${antes.replace(/[\x00-\x1f]/g, '')}<svg>${depois}`, 'utf8'), 'a.txt')
        return !d.aceito
      }),
    )
  })
})

describe('nomeParaExibir', () => {
  it('tira caminho, controle e direção bidirecional', () => {
    expect(nomeParaExibir('C:\\fakepath\\ata.pdf', 'application/pdf')).toBe('ata.pdf')
    expect(nomeParaExibir('../../etc/passwd.txt', 'text/plain')).toBe('passwd.txt')
    expect(nomeParaExibir('fatura\u202Efdp.pdf', 'application/pdf')).toBe('faturafdp.pdf')
    expect(nomeParaExibir('a\u0000b\nc.pdf', 'application/pdf')).toBe('abc.pdf')
  })

  it('a extensão fica COERENTE com o tipo detectado', () => {
    expect(nomeParaExibir('pagina.html', 'text/plain')).toBe('pagina.html.txt')
    expect(nomeParaExibir('foto.svg', 'image/png')).toBe('foto.svg.png')
    expect(nomeParaExibir('Foto.JPEG', 'image/jpeg')).toBe('Foto.JPEG')
    expect(nomeParaExibir('', 'application/pdf')).toBe('anexo.pdf')
    expect(nomeParaExibir('...', 'application/pdf')).toBe('anexo.pdf')
  })

  it('propriedade: até 200 pontos de código, sem barra nem controle, extensão coerente', () => {
    fc.assert(
      fc.property(fc.fullUnicodeString({ maxLength: 400 }), (bruto) => {
        const n = nomeParaExibir(bruto, 'application/pdf')
        return (
          Array.from(n).length <= 200 &&
          Array.from(n).length >= 5 &&
          !/[\\/\u0000-\u001f\u202a-\u202e]/.test(n) &&
          n.toLowerCase().endsWith('.pdf')
        )
      }),
    )
  })
})

describe('cabecalhoDeAnexo', () => {
  it('attachment, reserva ASCII sem aspas e filename* em UTF-8', () => {
    expect(cabecalhoDeAnexo('Ata de reunião "final".pdf')).toBe(
      `attachment; filename="Ata de reuniao _final_.pdf"; filename*=UTF-8''Ata%20de%20reuni%C3%A3o%20%22final%22.pdf`,
    )
  })

  it('propriedade: nada escapa das aspas nem quebra a linha', () => {
    fc.assert(
      fc.property(fc.fullUnicodeString({ maxLength: 200 }), (nome) => {
        const h = cabecalhoDeAnexo(nome)
        const reserva = /^attachment; filename="([^"]*)"; filename\*=UTF-8''([A-Za-z0-9%\-_.!~]*)$/.exec(h)
        return reserva !== null && !/[\r\n]/.test(h)
      }),
    )
  })
})
