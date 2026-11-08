import type { ContaNaLista } from '@fir/contracts'
import { FORMA_NAO_INFORMADA, FORMAS_DE_SAIDA } from '@fir/domain'
import { describe, expect, it } from 'vitest'
import {
  caminhoDeContas,
  consultaDaApi,
  formaInicialDoPagamento,
  lerFiltroDeContas,
  opcoesDeForma,
} from './filtro-de-contas'

const conta = (p: Partial<ContaNaLista>): ContaNaLista => ({
  id: '00000000-0000-4000-8000-000000000001',
  descricao: 'Aluguel',
  categoria: 'Ocupação',
  tipo: 'fixa',
  valor: '100000',
  vencimento: '2026-11-10',
  vencida: false,
  fornecedor: '',
  responsavelId: '00000000-0000-4000-8000-000000000002',
  responsavel: 'Helena',
  mensal: true,
  pagoEm: null,
  valorPago: null,
  formaPagamento: '',
  formaPrevista: '',
  pagoPor: null,
  ...p,
})

describe('filtro de Contas pela URL', () => {
  it('lê os três campos válidos', () => {
    expect(lerFiltroDeContas({ situacao: 'pagas', mes: '2026-10', forma: 'Pix' })).toEqual({
      situacao: 'pagas',
      mes: '2026-10',
      forma: 'Pix',
    })
  })

  it('um campo torto cai para o padrão sem derrubar os outros', () => {
    expect(lerFiltroDeContas({ situacao: 'xpto', mes: '2026-13', forma: 'Pix' })).toEqual({
      situacao: 'todas',
      mes: null,
      forma: 'Pix',
    })
    expect(lerFiltroDeContas({ forma: '   ' }).forma).toBeNull()
    expect(lerFiltroDeContas({ forma: 'x'.repeat(31) }).forma).toBeNull()
  })

  it('aceita forma fora da lista — toda linha do bloco é filtrável', () => {
    expect(lerFiltroDeContas({ forma: 'Cheque' }).forma).toBe('Cheque')
  })

  it('o link da Visão do mês força pagas, o mês e a forma, com escape', () => {
    expect(caminhoDeContas({ situacao: 'pagas', mes: '2026-09', forma: 'Cartão de débito' })).toBe(
      '/contas?situacao=pagas&mes=2026-09&forma=Cart%C3%A3o+de+d%C3%A9bito',
    )
    expect(caminhoDeContas({})).toBe('/contas')
    expect(consultaDaApi({ situacao: 'todas', mes: null, forma: FORMA_NAO_INFORMADA })).toBe(
      '?forma=N%C3%A3o+informada',
    )
  })

  it('ida e volta: o que o link escreve é o que a página lê', () => {
    const url = new URL(
      caminhoDeContas({ situacao: 'pagas', mes: '2026-09', forma: 'Débito automático' }),
      'http://x',
    )
    expect(lerFiltroDeContas(Object.fromEntries(url.searchParams))).toEqual({
      situacao: 'pagas',
      mes: '2026-09',
      forma: 'Débito automático',
    })
  })
})

describe('opções do filtro por forma', () => {
  it('as 7 formas, "Não informada" e as gravadas fora da lista', () => {
    const op = opcoesDeForma(
      [
        conta({ pagoEm: '2026-11-02', formaPagamento: 'Cheque', formaPrevista: 'Boleto' }),
        conta({ formaPrevista: 'Pix' }),
        conta({ pagoEm: '2026-11-03', formaPagamento: '' }),
      ],
      null,
    )
    expect(op).toEqual([...FORMAS_DE_SAIDA, FORMA_NAO_INFORMADA, 'Cheque'])
  })

  it('a forma do filtro atual nunca some do select', () => {
    expect(opcoesDeForma([], 'Vale')).toContain('Vale')
    expect(opcoesDeForma([], 'Pix').filter((f) => f === 'Pix')).toHaveLength(1)
  })
})

describe('Paguei pré-preenchido', () => {
  it('vem com a prevista; sem prevista, "Não informada"', () => {
    expect(formaInicialDoPagamento('Boleto')).toBe('Boleto')
    expect(formaInicialDoPagamento('')).toBe('')
    expect(formaInicialDoPagamento('Cheque')).toBe('')
  })
})
