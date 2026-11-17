import * as XLSX from 'xlsx'
import { describe, expect, it } from 'vitest'
import { lerTabela } from './planilha'

/**
 * T0 (appsec C18): o SheetJS saiu da 0.18.5 do npm (CVE-2023-30533, poluição
 * de protótipo na leitura; CVE-2024-22363, ReDoS) para o tarball oficial
 * 0.20.3, fixado por `integrity` no lockfile. `planilha.ts` não mudou: este
 * arquivo prova que a leitura de `.xlsx` de terceiros continua igual.
 */
describe('SheetJS 0.20.3', () => {
  it('a versão carregada é a do tarball oficial, não a do npm', () => {
    expect(XLSX.version).toBe('0.20.3')
  })

  it('um .xlsx gerado pela biblioteca volta pela importação, linha a linha', async () => {
    const livro = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(
      livro,
      XLSX.utils.aoa_to_sheet([
        ['Nome', 'Telefone', 'Origem'],
        ['José da Silva', '71999990000', 'Instagram'],
        ['  Ana  ', 7133330000, ''],
      ]),
      'Pacientes',
    )
    const bytes = XLSX.write(livro, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
    const arquivo = new File([bytes], 'lista.xlsx')
    expect(await lerTabela(arquivo, '')).toEqual([
      ['Nome', 'Telefone', 'Origem'],
      ['José da Silva', '71999990000', 'Instagram'],
      ['Ana', '7133330000', ''],
    ])
  })

  it('uma aba chamada __proto__ não polui Object.prototype (CVE-2023-30533)', async () => {
    const livro = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(livro, XLSX.utils.aoa_to_sheet([['a']]), '__proto__')
    const bytes = XLSX.write(livro, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
    await lerTabela(new File([bytes], 'x.xlsx'), '')
    expect(({} as Record<string, unknown>)['a']).toBeUndefined()
    expect(Object.prototype).not.toHaveProperty('!ref')
  })
})
