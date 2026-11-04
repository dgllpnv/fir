import { describe, expect, it } from 'vitest'
import { conferirPlanilhaDeItens, corpoDaImportacao, LIMITE_DE_ITENS } from './itens-importados'

const MODELO = [
  ['Código', 'Nome do item', 'Categoria', 'Unidade de medida', 'Custo unitário',
   'Estoque mínimo', 'Alta rotatividade', 'Controla validade', 'Local'],
]
const CADASTRADOS = [
  { nome: 'Soro fisiológico 500 ml', codigo: 'SF500' },
  { nome: 'Agulha 13x4,5', codigo: '' },
]

const conferir = (t: readonly (readonly string[])[], c = CADASTRADOS) => {
  const r = conferirPlanilhaDeItens(t, c)
  if ('erro' in r) throw new Error(r.erro)
  return r
}

describe('conferência da planilha de itens', () => {
  it('a modelo preenchida vira uma linha nova, com custo em centavos', () => {
    const r = conferir([
      ...MODELO,
      ['TIR5', 'Tirzepatida ampola 5 mg', 'Injetáveis', 'ampola', '380,00', '10', 'sim', 'sim',
       'Geladeira da enfermagem'],
    ])
    expect(r).toMatchObject({ novos: 1, existentes: 0, fora: 0 })
    expect(r.linhas[0]).toMatchObject({
      numero: 2,
      nome: 'Tirzepatida ampola 5 mg',
      codigo: 'TIR5',
      custo: '38000',
      minimo: '10000',
      altaRotatividade: true,
      controlaValidade: true,
      situacao: 'novo',
      avisos: [],
    })
  })

  it('custo NUNCA vira float: 1.250,50 são 125050 centavos', () => {
    // Regra 1. O legado faz `Math.round(x * 100) / 100`; aqui o caminho é
    // texto → centavos, e o número de ponto flutuante não existe em lugar
    // nenhum do percurso.
    const r = conferir([...MODELO, ['', 'Caro', '', '', '1.250,50', '', '', '', '']])
    expect(r.linhas[0]!.custo).toBe('125050')
  })

  it('custo ilegível fica em branco e é AVISADO — não entra como zero', () => {
    // Zero é um preço. "Não reconheci" não é zero, e um item de 380 reais que
    // entrasse com custo zero sumiria do valor em estoque sem avisar.
    const r = conferir([...MODELO, ['', 'Soro novo', '', '', 'quatrocentos', '', '', '', '']])
    expect(r.linhas[0]!.custo).toBeNull()
    expect(r.linhas[0]!.avisos).toContain('custo não reconhecido, vai em branco')
    expect(r.linhas[0]!.situacao).toBe('novo')
  })

  it('item que já existe pelo CÓDIGO é marcado, com o nome cadastrado', () => {
    const r = conferir([...MODELO, ['SF500', 'Soro fisiologico 500ml (outro nome)', '', '', '', '', '', '', '']])
    expect(r).toMatchObject({ novos: 0, existentes: 1 })
    expect(r.linhas[0]!.existente).toBe('Soro fisiológico 500 ml')
  })

  it('item que já existe pelo NOME casa sem acento e sem caixa', () => {
    const r = conferir([...MODELO, ['', 'AGULHA 13X4,5', '', '', '', '', '', '', '']])
    expect(r.linhas[0]!.situacao).toBe('existe')
  })

  it('linha sem nome fica FORA, e o número dela aponta a linha da planilha', () => {
    const r = conferir([...MODELO, ['X1', '', '', '', '', '', '', '', ''], ['', 'Soro novo']])
    expect(r.fora).toBe(1)
    expect(r.linhas[0]).toMatchObject({ numero: 2, situacao: 'fora', avisos: ['sem nome do item'] })
  })

  it('repetido DENTRO do arquivo fica fora: a segunda linha não sobrescreve a primeira calada', () => {
    const r = conferir([
      ...MODELO,
      ['TIR5', 'Tirzepatida 5 mg', '', '', '380', '', '', '', ''],
      ['TIR5', 'Tirzepatida cinco', '', '', '999', '', '', '', ''],
    ])
    expect(r).toMatchObject({ novos: 1, fora: 1 })
    expect(r.linhas[1]!.avisos).toContain('repetido na lista')
    expect(corpoDaImportacao(r)).toHaveLength(1)
    expect(corpoDaImportacao(r)[0]!.custo).toBe('38000')
  })

  it('coluna de validade AUSENTE vale sim; presente e vazia vale não', () => {
    // A diferença medida no protótipo: `undefined ? true : !!valor`. Uma
    // planilha sem a coluna não está dizendo "não controle a validade" de um
    // medicamento — está calada, e o padrão seguro é controlar.
    const semColuna = conferir([['Produto'], ['Tirzepatida']])
    expect(semColuna.linhas[0]!.controlaValidade).toBe(true)

    const comColunaVazia = conferir([...MODELO, ['', 'Tirzepatida', '', '', '', '', '', '', '']])
    expect(comColunaVazia.linhas[0]!.controlaValidade).toBe(false)
  })

  it('o corpo enviado carrega só o que não ficou fora', () => {
    const r = conferir([...MODELO, ['', '', '', '', '', '', '', '', ''], ['', 'Soro novo']])
    expect(corpoDaImportacao(r).map((l) => l.nome)).toEqual(['Soro novo'])
  })

  it('acima do limite é erro com saída, não um envio que o servidor recusa', () => {
    const muitas = Array.from({ length: LIMITE_DE_ITENS + 1 }, (_, i) => ['', `Item ${i}`])
    expect(conferirPlanilhaDeItens([...MODELO, ...muitas], [])).toEqual({
      erro: `A lista passa de ${LIMITE_DE_ITENS} itens. Divida a planilha em partes.`,
    })
  })

  it('cabeçalho irreconhecível NÃO é erro: a primeira coluna vira o nome, e a conferência mostra', () => {
    // Medido no protótipo: sem um título que pareça nome (`nome`, `produto`,
    // `descrição`…), `temCab` é falso e a tabela inteira entra como dados na
    // ordem do modelo — inclusive a linha de títulos. É deliberado: é o que
    // faz "copiei só as linhas, sem o cabeçalho" funcionar.
    //
    // O preço é este: uma planilha de colunas estranhas entra com itens
    // chamados "Custo" e "10". Quem pega isso é a ETAPA DE CONFERÊNCIA — a
    // usuária vê a tabela antes de confirmar, e é para isso que ela existe.
    // Transformar em erro quebraria a colagem sem cabeçalho, que é o caminho
    // curto da recepção.
    const r = conferir([['Custo', 'Mínimo'], ['10', '2']], [])
    expect(r.novos).toBe(2)
    expect(r.linhas.map((l) => l.nome)).toEqual(['Custo', '10'])
  })

  it('sem NENHUMA coluna de nome possível, erro com caminho de saída', () => {
    // `nome: -1` só acontece quando o cabeçalho FOI reconhecido e, ainda
    // assim, nenhuma coluna casou com nome — uma planilha com título de item
    // numa coluna que outra chave reivindicou antes.
    expect(conferirPlanilhaDeItens([[], []], [])).toMatchObject({
      erro: expect.stringContaining('Nenhuma linha encontrada'),
    })
  })
})
