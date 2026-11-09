import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { interpretarCodigo } from '@fir/domain'
import { describe, expect, it } from 'vitest'
import { textoDaLeitura } from './decodificador'
import { etiquetaDeOutraClinica, gtinParaExibir, itemDoCodigo } from './item-do-codigo'

const AQUI = dirname(fileURLToPath(import.meta.url))
const fonte = (arquivo: string) => readFileSync(join(AQUI, arquivo), 'utf8')

describe('textoDaLeitura — o que a ZXing entrega, na forma que o domínio lê', () => {
  it('o FNC1 inicial do DataMatrix GS1 (GS no começo) vira `]d2`, e a validade sai', () => {
    // É assim que a ZXing devolve a caixa do medicamento: o FNC1 da primeira
    // posição traduzido para ASCII 29. Sem a troca, o domínio não reconhece o
    // `01<gtin>` e a caixa vira "código desconhecido".
    const bruto = '\u001d01078912345678951727060010LT2026A'
    expect(interpretarCodigo(bruto).tipo).toBe('desconhecido')
    expect(interpretarCodigo(textoDaLeitura(bruto))).toEqual({
      tipo: 'medicamento',
      gtin: '07891234567895',
      // Dia `00` = último dia do mês (regra do GS1, que o protótipo erra).
      validade: '2027-06-30',
      lote: 'LT2026A',
    })
  })

  it('o GS NO MEIO (fim do lote variável) fica como está — é o domínio que o lê', () => {
    const bruto = '\u001d01078912345678951012AB\u001d17270630'
    const c = interpretarCodigo(textoDaLeitura(bruto))
    expect(c).toMatchObject({ tipo: 'medicamento', lote: '12AB', validade: '2027-06-30' })
  })

  it('EAN, QR da etiqueta e o que o leitor USB já manda com `]d2` passam intactos', () => {
    for (const t of ['7891234567895', 'FRMEST:demo:abc', ']d20107891234567895']) {
      expect(textoDaLeitura(t)).toBe(t)
    }
  })
})

describe('itemDoCodigo — o mesmo achar nos três leitores', () => {
  const itens = [
    { id: 'a', gtin: '07891234567895', codigoQr: 'FRMEST:demo:a' },
    { id: 'b', gtin: '', codigoQr: 'FRMEST:demo:b' },
  ]
  it('EAN-13 lido acha o item gravado em 14 dígitos', () => {
    expect(itemDoCodigo(itens, interpretarCodigo('7891234567895'))?.id).toBe('a')
  })
  it('item SEM código nunca casa — nem com um código de catorze zeros', () => {
    expect(itemDoCodigo(itens, interpretarCodigo('00000000'))).toBeNull()
  })
  it('a etiqueta acha pelo id; o desconhecido não acha nada', () => {
    expect(itemDoCodigo(itens, interpretarCodigo('FRMEST:demo:b'))?.id).toBe('b')
    expect(itemDoCodigo(itens, interpretarCodigo('qualquer coisa'))).toBeNull()
  })
  it('etiqueta de OUTRA clínica: não acha nada, MESMO com um id que existe aqui (AB-A4-3)', () => {
    const alheia = interpretarCodigo('FRMEST:vizinha:b')
    expect(etiquetaDeOutraClinica(itens, alheia)).toBe(true)
    expect(itemDoCodigo(itens, alheia)).toBeNull()
    // A desta clínica e a sem código (protótipo) seguem pelo id.
    expect(etiquetaDeOutraClinica(itens, interpretarCodigo('FRMEST:demo:b'))).toBe(false)
    expect(itemDoCodigo(itens, interpretarCodigo('FRMEST::b'))?.id).toBe('b')
    // Catálogo vazio: não há como saber, e não há o que achar.
    expect(etiquetaDeOutraClinica([], alheia)).toBe(false)
  })
  it('o GTIN aparece como está impresso na caixa (EAN-13)', () => {
    expect(gtinParaExibir('07891234567895')).toBe('7891234567895')
    expect(gtinParaExibir('17891234567892')).toBe('17891234567892')
  })
})

describe('a biblioteca é EMPACOTADA e carregada sob demanda', () => {
  it('nenhum arquivo do estoque carrega script de CDN', () => {
    for (const f of ['decodificador.ts', 'captura-de-codigo.tsx', 'etiquetas.tsx']) {
      expect(fonte(f)).not.toMatch(/https?:\/\/(cdn|unpkg|jsdelivr)/)
    }
  })
  it('a ZXing só entra por `import()` dinâmico — nenhum import estático de valor', () => {
    const d = fonte('decodificador.ts')
    expect(d).toContain("import('@zxing/browser')")
    // O único import estático é de TIPO, que some no build.
    expect(d).not.toMatch(/^import (?!type)[^\n]*@zxing/m)
    for (const f of ['captura-de-codigo.tsx', 'leitor-de-codigo.tsx', 'formulario-de-item.tsx']) {
      expect(fonte(f)).not.toContain('@zxing')
    }
  })
  it('a câmera é solta no cleanup do efeito, não só no botão Fechar', () => {
    expect(fonte('captura-de-codigo.tsx')).toMatch(/return \(\) => \{\s*vivo = false\s*cam\.parar\(\)/)
    // E o `parar` desliga as faixas do stream que NÓS pedimos — não espera a
    // volta do laço da ZXing, que pode levar segundos.
    expect(fonte('decodificador.ts')).toMatch(/for \(const t of stream\.getTracks\(\)\) t\.stop\(\)/)
  })
})
