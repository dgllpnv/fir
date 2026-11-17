import * as XLSX from 'xlsx'
import { describe, expect, it } from 'vitest'
import { type CelulaDaPlanilha, montarCsv, montarXlsx, textoPerigoso } from './planilha'

/**
 * **`csv-xlsx-sem-formula`** (T8; appsec C17). O conjunto ampliado do ticket:
 * cada uma destas é uma célula que o Excel ou o LibreOffice executariam, ou
 * que partiria a linha e deixaria a metade de trás começar com `=`.
 */
const ATAQUES = ['=cmd()', '+1', '-2+3', '@SUM(A1)', '\t=1', '" ;=1', 'linha um\r\n=2', '  =HYPERLINK("http://x")', '\r=1']

const texto = (valor: string): CelulaDaPlanilha => ({ tipo: 'texto', valor })
const numero = (valor: string): CelulaDaPlanilha => ({ tipo: 'numero', valor })

/** Um leitor RFC 4180 mínimo, independente do que é testado: separa campos e desfaz as aspas. */
function lerCsv(csv: string): string[][] {
  const linhas: string[][] = []
  let campo = ''
  let linha: string[] = []
  let aspas = false
  for (let i = 0; i < csv.length; i++) {
    const c = csv[i]!
    if (aspas) {
      if (c === '"' && csv[i + 1] === '"') {
        campo += '"'
        i++
      } else if (c === '"') aspas = false
      else campo += c
    } else if (c === '"') aspas = true
    else if (c === ';') {
      linha.push(campo)
      campo = ''
    } else if (c === '\r' && csv[i + 1] === '\n') {
      linha.push(campo)
      linhas.push(linha)
      linha = []
      campo = ''
      i++
    } else campo += c
  }
  return linhas
}

describe('csv-xlsx-sem-formula', () => {
  it('reconhece todo ataque que COMEÇA com fórmula; os do meio da célula são das aspas', () => {
    const doMeio = ['" ;=1', 'linha um\r\n=2']
    for (const a of ATAQUES.filter((x) => !doMeio.includes(x))) expect(textoPerigoso(a), JSON.stringify(a)).toBe(true)
    for (const ok of ['Maria', 'Uso em paciente', '2026-11-17', ...doMeio]) expect(textoPerigoso(ok), ok).toBe(false)
  })

  it('CSV: começa com BOM, e nenhuma célula de texto lida de volta começa com um caractere de fórmula', () => {
    const csv = montarCsv({ nomeDaAba: 'x', linhas: [ATAQUES.map(texto)] })
    expect(csv.startsWith('﻿')).toBe(true)
    const [linha] = lerCsv(csv.slice(1))
    expect(linha).toHaveLength(ATAQUES.length)
    linha!.forEach((celula, i) => {
      expect(/^[=+\-@\t\r]/.test(celula), `célula ${i}: ${JSON.stringify(celula)}`).toBe(false)
      // O conteúdo é o mesmo, só com o apóstrofo na frente do que era perigoso.
      const original = ATAQUES[i]!
      expect(celula).toBe(textoPerigoso(original) ? `'${original}` : original)
    })
  })

  it('CSV: `" ;=1` fica numa célula só — a aspa e o separador não partem a linha', () => {
    const csv = montarCsv({ nomeDaAba: 'x', linhas: [[texto('a'), texto('" ;=1'), texto('b')]] })
    expect(lerCsv(csv.slice(1))).toEqual([['a', '" ;=1', 'b']])
    expect(csv).toContain('""" ;=1"')
  })

  it('CSV: a quebra de linha dentro da célula fica dentro das aspas', () => {
    const csv = montarCsv({ nomeDaAba: 'x', linhas: [[texto('linha um\r\n=2')], [texto('fim')]] })
    expect(lerCsv(csv.slice(1))).toEqual([['linha um\r\n=2'], ['fim']])
  })

  it('CSV: número formatado por nós sai como número, sem apóstrofo', () => {
    const csv = montarCsv({ nomeDaAba: 'x', linhas: [[numero('-R$ 5,00'), numero('12')]] })
    expect(lerCsv(csv.slice(1))).toEqual([['-R$ 5,00', '12']])
  })

  it('XLSX: relido, toda célula é `t: "s"`, sem `f` e sem hyperlink — com o texto intacto', async () => {
    const bytes = await montarXlsx({ nomeDaAba: 'Recebimentos', linhas: [ATAQUES.map(texto), [numero('R$ 1,00')]] })
    const livro = XLSX.read(bytes, { type: 'array', cellFormula: true, cellHTML: false })
    const folha = livro.Sheets[livro.SheetNames[0]!]!
    const celulas = Object.entries(folha).filter(([k]) => !k.startsWith('!'))
    expect(celulas).toHaveLength(ATAQUES.length + 1)
    for (const [ref, c] of celulas) {
      const cel = c as XLSX.CellObject
      expect(cel.t, ref).toBe('s')
      expect(cel.f, ref).toBeUndefined()
      expect(cel.l, ref).toBeUndefined()
    }
    expect((folha['A1'] as XLSX.CellObject).v).toBe('=cmd()')
    expect((folha['A2'] as XLSX.CellObject).v).toBe('R$ 1,00')
  })
})
