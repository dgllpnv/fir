import { describe, expect, it } from 'vitest'
import { textoDoCsv } from './planilha'

const bytes = (b: number[]) => new Uint8Array(b).buffer

describe('texto do CSV', () => {
  it('lê UTF-8 sem BOM sem estragar os acentos', () => {
    // "Responsável" em UTF-8: á = C3 A1
    const b = [...Buffer.from('Responsável;José', 'utf8')]
    expect(textoDoCsv(bytes(b))).toBe('Responsável;José')
  })

  it('tira o BOM do UTF-8 do Excel', () => {
    const b = [0xef, 0xbb, 0xbf, ...Buffer.from('Nome', 'utf8')]
    expect(textoDoCsv(bytes(b))).toBe('Nome')
  })

  it('cai para Windows-1252 quando não é UTF-8 (CSV do Excel brasileiro)', () => {
    // "José" em Windows-1252: é = E9, byte solto que não é UTF-8 válido
    expect(textoDoCsv(bytes([0x4a, 0x6f, 0x73, 0xe9]))).toBe('José')
  })
})
