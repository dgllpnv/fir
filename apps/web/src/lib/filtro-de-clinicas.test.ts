import { describe, expect, it } from 'vitest'
import { filtrarClinicas, type ClinicaEscolhivel } from './filtro-de-clinicas'

const c = (codigo: string, nome: string, ativa = true): ClinicaEscolhivel => ({
  id: `id-${codigo}`,
  codigo,
  nome,
  ativa,
})

const QUATRO = [
  c('institutorp', 'Instituto RP'),
  c('drasuzanalima', 'Dra. Suzana Lima'),
  c('drajoicefraga', 'Dra. Joice Fraga'),
  c('raphaella', 'Raphaella Estética Avançada'),
]

const codigos = (lista: readonly ClinicaEscolhivel[]) => lista.map((x) => x.codigo)

describe('busca por digitação dentro do seletor', () => {
  it('sem termo, devolve tudo em ordem de nome', () => {
    // Quarenta clínicas numa lista sem ordem é uma lista que não se usa.
    expect(codigos(filtrarClinicas(QUATRO, ''))).toEqual([
      'drajoicefraga',
      'drasuzanalima',
      'institutorp',
      'raphaella',
    ])
  })

  it('casa por CÓDIGO e por NOME — a recepção sabe um, o dono sabe o outro', () => {
    expect(codigos(filtrarClinicas(QUATRO, 'rapha'))).toEqual(['raphaella'])
    expect(codigos(filtrarClinicas(QUATRO, 'Estética'))).toEqual(['raphaella'])
  })

  it('ignora acento e caixa nos dois lados', () => {
    // Ninguém digita "Estética" com acento numa busca com o telefone na mão.
    expect(codigos(filtrarClinicas(QUATRO, 'estetica'))).toEqual(['raphaella'])
    expect(codigos(filtrarClinicas(QUATRO, 'JOICE'))).toEqual(['drajoicefraga'])
    expect(codigos(filtrarClinicas([c('clinica', 'Clínica Acão')], 'acao'))).toEqual(['clinica'])
  })

  it('casa no MEIO da palavra — o prefixo sozinho perderia "suzana"', () => {
    expect(codigos(filtrarClinicas(QUATRO, 'suzana'))).toEqual(['drasuzanalima'])
  })

  it('quem COMEÇA com o termo vem primeiro', () => {
    // "dra" casa com duas pelo início e com nada pelo meio; a que o dono
    // procurou digitando "ra" é a que começa com "ra".
    const lista = [c('praia', 'Clínica da Praia'), c('raphaella', 'Raphaella')]
    expect(codigos(filtrarClinicas(lista, 'ra'))).toEqual(['raphaella', 'praia'])
  })

  it('termo que não casa com ninguém devolve lista vazia', () => {
    expect(filtrarClinicas(QUATRO, 'zzz')).toEqual([])
  })

  it('espaço em volta do termo não muda nada', () => {
    expect(codigos(filtrarClinicas(QUATRO, '  rapha '))).toEqual(['raphaella'])
  })

  it('clínica DESATIVADA continua na lista — o painel é o único lugar que a vê', () => {
    // Esconder aqui faria o operador procurar por uma clínica que ele mesmo
    // desativou e concluir que ela foi apagada.
    const lista = [c('viva', 'Clínica Viva'), c('fora', 'Clínica Fora', false)]
    expect(codigos(filtrarClinicas(lista, 'clinica'))).toEqual(['fora', 'viva'])
  })
})
