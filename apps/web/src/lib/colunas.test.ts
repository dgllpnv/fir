import { describe, expect, it } from 'vitest'
import { celula, mapear, normalizar, simOuNao } from './colunas'

/** A tabela do protótipo, na ordem dele — a ordem é parte da regra. */
const APELIDOS = [
  ['local', ['local', 'localizacao', 'armazenamento', 'sala', 'onde fica']],
  ['codigo', ['codigo', 'cod', 'sku', 'referencia', 'ref']],
  ['minimo', ['minimo', 'min']],
  ['custo', ['custo', 'preco', 'valor']],
  ['medida', ['unidade de medida', 'medida', 'unid', 'un']],
  ['categoria', ['categoria', 'grupo', 'classe', 'familia', 'tipo']],
  ['rot', ['rotatividade', 'giro']],
  ['val', ['validade', 'vencimento']],
  ['nome', ['nome', 'produto', 'descricao', 'item', 'material', 'insumo']],
] as const

const POSICIONAL = {
  nome: 0, categoria: 1, medida: 2, custo: 3, minimo: 4, rot: 5, val: 6, codigo: -1, local: -1,
}
const DO_CABECALHO = ['nome', 'produto', 'descricao', 'item', 'material', 'insumo']

const mapa = (t: readonly (readonly string[])[]) => {
  const r = mapear(t, APELIDOS, POSICIONAL, DO_CABECALHO)
  if ('erro' in r) throw new Error(r.erro)
  return r
}

describe('reconhecimento de colunas', () => {
  it('a planilha modelo é lida pelo cabeçalho', () => {
    const r = mapa([
      ['Código', 'Nome do item', 'Categoria', 'Unidade de medida', 'Custo unitário',
       'Estoque mínimo', 'Alta rotatividade', 'Controla validade', 'Local'],
      ['TIR5', 'Tirzepatida 5 mg', 'Injetáveis', 'ampola', '380', '10', 'sim', 'sim', 'Geladeira'],
    ])
    expect(r.primeira).toBe(2)
    const l = r.corpo[0]!
    expect(celula(l, r.indices, 'nome')).toBe('Tirzepatida 5 mg')
    expect(celula(l, r.indices, 'medida')).toBe('ampola')
    expect(celula(l, r.indices, 'codigo')).toBe('TIR5')
    expect(celula(l, r.indices, 'local')).toBe('Geladeira')
  })

  it('"Nome do item" não rouba a coluna de unidade, e "Unidade de medida" não rouba o nome', () => {
    // O caso que a ordem de COLS_IMPORT_EST protege: `nome` reivindica por
    // último porque `item` casaria dentro de outros títulos, e `medida`
    // reivindica antes porque `un` casaria dentro de "Nome do item".
    const r = mapa([['Nome do item', 'Unidade de medida'], ['Soro', 'ml']])
    expect(r.indices['nome']).toBe(0)
    expect(r.indices['medida']).toBe(1)
  })

  it('aceita a exportação de outro sistema, com títulos diferentes', () => {
    const r = mapa([
      ['SKU', 'Descrição do produto', 'Grupo', 'Unid', 'Preço', 'Mín'],
      ['A-1', 'Soro fisiológico 500 ml', 'Soros', 'frasco', '12,50', '4'],
    ])
    const l = r.corpo[0]!
    expect(celula(l, r.indices, 'codigo')).toBe('A-1')
    expect(celula(l, r.indices, 'nome')).toBe('Soro fisiológico 500 ml')
    expect(celula(l, r.indices, 'categoria')).toBe('Soros')
    expect(celula(l, r.indices, 'medida')).toBe('frasco')
    expect(celula(l, r.indices, 'custo')).toBe('12,50')
    expect(celula(l, r.indices, 'minimo')).toBe('4')
  })

  it('sem cabeçalho, cai na ordem do nosso modelo e NÃO descarta a primeira linha', () => {
    const r = mapa([['Soro', 'Soros', 'frasco'], ['Agulha', 'Descartáveis', 'un.']])
    expect(r.primeira).toBe(1)
    expect(r.corpo).toHaveLength(2)
    expect(celula(r.corpo[0]!, r.indices, 'nome')).toBe('Soro')
  })

  it('coluna ausente devolve vazio, não a célula vizinha', () => {
    const r = mapa([['Produto'], ['Soro']])
    expect(r.indices['custo']).toBe(-1)
    expect(celula(r.corpo[0]!, r.indices, 'custo')).toBe('')
  })

  it('planilha só com linhas em branco é um erro com nome', () => {
    expect(mapear([['', ''], ['']], APELIDOS, POSICIONAL, DO_CABECALHO)).toEqual({
      erro: 'Nenhuma linha encontrada na planilha.',
    })
  })

  it('normalizar tira acento, caixa e espaço repetido', () => {
    expect(normalizar('  Unidade   DE  Medida ')).toBe('unidade de medida')
    expect(normalizar('Validação')).toBe('validacao')
  })

  it('sim/não aceita o que a usuária realmente escreve', () => {
    for (const v of ['sim', 'SIM', 'S', 'x', '1', 'Verdadeiro']) expect(simOuNao(v)).toBe(true)
    for (const v of ['', 'não', 'nao', 'n', '0', 'talvez']) expect(simOuNao(v)).toBe(false)
  })
})
