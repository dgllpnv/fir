import { describe, expect, it } from 'vitest'
import { LeitorDePlanilha, PlanilhaInvalida } from './leitor-de-planilha'
import { empacotar, escreverXlsx } from './xlsx-de-teste'

/**
 * **O LEITOR, CONTRA UM `.xlsx` DE VERDADE.**
 *
 * O arquivo é escrito por `xlsx-de-teste.ts` — ZIP com deflate, tabela de
 * strings compartilhada, células omitidas, linhas omitidas e abas fora da
 * ordem dos arquivos. Todo dado é INVENTADO; o que se reproduz das planilhas
 * reais é a **forma**, nunca o conteúdo.
 *
 * Cada `it` marcado com **MUTAÇÃO** diz qual mudança no código ele mata.
 */

const leitor = new LeitorDePlanilha()
const t = (texto: string) => ({ texto })
const n = (numero: string) => ({ numero })

describe('nome da aba, e QUAL arquivo é QUAL aba', () => {
  /**
   * **MUTAÇÃO:** ler as abas por `xl/worksheets/sheet{N}.xml` em ordem.
   *
   * `sheet1.xml` **não** é a primeira aba: o nome está em `workbook.xml`,
   * ligado ao arquivo por `r:id` → `workbook.xml.rels`. Nas três planilhas
   * reais a ordem dos arquivos difere da ordem das abas, e duas delas têm
   * `Config` como segunda aba. Pior: `Tarefas` e `Tarefas (cópia v15)` têm o
   * cabeçalho IDÊNTICO, então migrar a errada não daria erro nenhum — daria a
   * receita de antes da conversão da v16.
   */
  it('MUTAÇÃO · a aba vem do workbook + rels, nunca do número do arquivo', () => {
    const buf = escreverXlsx([
      { nome: 'Primeira', linhas: [[t('id')], [t('a')]] },
      { nome: 'Segunda', linhas: [[t('id')], [t('b')]] },
      { nome: 'Terceira', linhas: [[t('id')], [t('c')]] },
    ])
    const p = leitor.ler(buf)
    expect(p.abas.map((a) => a.nome)).toEqual(['Primeira', 'Segunda', 'Terceira'])
    expect(p.abas.map((a) => a.linhas[0]!.celulas[0]!.bruto)).toEqual(['a', 'b', 'c'])
  })

  it('o nome com acento e com parêntese atravessa intacto', () => {
    const p = leitor.ler(
      escreverXlsx([{ nome: 'Tarefas (cópia v15)', linhas: [[t('id')], [t('x')]] }]),
    )
    expect(p.abas[0]!.nome).toBe('Tarefas (cópia v15)')
  })
})

describe('a célula que não existe, e a linha que não existe', () => {
  /**
   * **MUTAÇÃO:** empilhar as células na ordem em que aparecem, ignorando `r=`.
   *
   * O XML OMITE a célula sem valor. Com a ordem, toda coluna depois do
   * primeiro vazio desloca uma posição — e aí `valor` passa a ler `obs`. É o
   * defeito mais caro possível num leitor de planilha, e ele não dá erro: dá
   * número no campo errado.
   */
  it('MUTAÇÃO · a posição vem do `r="P2"`, não da ordem dos `<c>`', () => {
    const p = leitor.ler(
      escreverXlsx([
        { nome: 'Aba', linhas: [[t('a'), t('b'), t('c'), t('d')], [t('1'), null, null, t('4')]] },
      ]),
    )
    const linha = p.abas[0]!.linhas[0]!
    expect(linha.celulas[0]!.bruto).toBe('1')
    expect(linha.celulas[1]!.bruto).toBe('')
    expect(linha.celulas[2]!.bruto).toBe('')
    expect(linha.celulas[3]!.bruto).toBe('4')
  })

  it('a linha pulada não desloca o número das seguintes', () => {
    const p = leitor.ler(
      escreverXlsx([
        { nome: 'Aba', linhas: [[t('id')], [t('x')], [t('y')]], pularLinha: 3 },
      ]),
    )
    expect(p.abas[0]!.linhas.map((l) => l.numero)).toEqual([2, 4])
  })

  it('a coluna final ausente não é erro — é vazio', () => {
    const p = leitor.ler(
      escreverXlsx([{ nome: 'Aba', linhas: [[t('a'), t('b'), t('c')], [t('1')]] }]),
    )
    expect(p.abas[0]!.linhas[0]!.celulas).toHaveLength(1)
  })
})

describe('a tabela de strings compartilhada', () => {
  /**
   * **MUTAÇÃO:** ler só o primeiro `<t>` de cada `<si>`.
   *
   * Um `<si>` pode ter vários `<t>` quando o texto tem formatação parcial
   * (metade em negrito). Com só o primeiro, o nome da paciente chega cortado —
   * e o nome cortado passa por toda validação de tamanho.
   */
  it('MUTAÇÃO · um `<si>` com vários `<t>` é UM texto, concatenado', () => {
    // `escreverXlsx` parte o PRIMEIRO texto indexado em dois `<t>`.
    const p = leitor.ler(escreverXlsx([{ nome: 'Aba', linhas: [[t('Procedimento Alfa')]] }]))
    expect(p.abas[0]!.cabecalho[0]).toBe('Procedimento Alfa')
  })

  it('índice fora da tabela é RECUSA, nunca string vazia', () => {
    // A aba aponta para a string 99; a tabela tem uma. Uma string vazia aqui
    // faria o NOME de uma paciente desaparecer sem erro nenhum.
    const quebrado = empacotar({
      'xl/workbook.xml':
        '<workbook xmlns:r="x"><sheets><sheet name="Aba" sheetId="1" r:id="rId1"/></sheets></workbook>',
      'xl/_rels/workbook.xml.rels':
        '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
      'xl/sharedStrings.xml': '<sst><si><t>id</t></si></sst>',
      'xl/worksheets/sheet1.xml':
        '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c></row>' +
        '<row r="2"><c r="A2" t="s"><v>99</v></c></row></sheetData></worksheet>',
    })
    expect(() => leitor.ler(quebrado)).toThrow(PlanilhaInvalida)
  })
})

describe('o LITERAL do número atravessa, e nada o converte aqui', () => {
  /**
   * **MUTAÇÃO:** devolver `Number(bruto)` em vez do literal.
   *
   * É o que toda biblioteca de planilha faz, e é por isso que nenhuma delas
   * serve: `1250.50` passa a ser um `double`, e a conversão para centavos
   * perde a única informação exata que o arquivo tinha. O leitor devolve
   * `string`; quem interpreta é `@fir/domain/migracao/celula`.
   */
  it('MUTAÇÃO · a célula numérica volta como STRING, com o literal intacto', () => {
    const p = leitor.ler(
      escreverXlsx([
        {
          nome: 'Aba',
          linhas: [[t('valor')], [n('1250.50')], [n('450.0')], [n('12.299999999999999')]],
        },
      ]),
    )
    const brutos = p.abas[0]!.linhas.map((l) => l.celulas[0]!)
    expect(brutos.map((c) => c.bruto)).toEqual(['1250.50', '450.0', '12.299999999999999'])
    expect(brutos.map((c) => c.tipo)).toEqual(['n', 'n', 'n'])
    expect(brutos.every((c) => typeof c.bruto === 'string')).toBe(true)
  })
})

describe('arquivo que não é planilha', () => {
  it('bytes aleatórios recusam', () => {
    expect(() => leitor.ler(Buffer.from('não sou um zip'))).toThrow(PlanilhaInvalida)
  })

  it('zip sem `xl/workbook.xml` recusa com a razão', () => {
    expect(() => leitor.ler(empacotar({ 'qualquer.txt': 'oi' }))).toThrow(/workbook/)
  })

  it('aba que aponta para um arquivo que não está no pacote recusa, nomeando a aba', () => {
    const quebrado = empacotar({
      'xl/workbook.xml':
        '<workbook xmlns:r="x"><sheets><sheet name="Tarefas" sheetId="1" r:id="rId1"/></sheets></workbook>',
      'xl/_rels/workbook.xml.rels':
        '<Relationships><Relationship Id="rId1" Target="worksheets/sumiu.xml"/></Relationships>',
    })
    expect(() => leitor.ler(quebrado)).toThrow(/Tarefas/)
  })

  it('célula de tipo desconhecido recusa, nomeando a aba', () => {
    const quebrado = empacotar({
      'xl/workbook.xml':
        '<workbook xmlns:r="x"><sheets><sheet name="Tarefas" sheetId="1" r:id="rId1"/></sheets></workbook>',
      'xl/_rels/workbook.xml.rels':
        '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
      'xl/worksheets/sheet1.xml':
        '<worksheet><sheetData><row r="1"><c r="A1" t="zz"><v>1</v></c></row></sheetData></worksheet>',
    })
    expect(() => leitor.ler(quebrado)).toThrow(/Tarefas/)
  })

  it('buffer vazio recusa', () => {
    expect(() => leitor.ler(Buffer.alloc(0))).toThrow(PlanilhaInvalida)
  })
})
