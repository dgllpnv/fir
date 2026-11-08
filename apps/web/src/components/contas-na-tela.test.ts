import type { ContaNaLista, ListaDeContas } from '@fir/contracts'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { aplicarPagamento, gruposDeContas } from './contas-na-tela'

/**
 * **"Paguei" diz "pagamento registrado" e a conta não some de Contas a
 * pagar** (produção, 2026-11-08).
 *
 * O que estes testes seguram: depois do Paguei, a conta paga não está em
 * NENHUM grupo de abertas — no mesmo quadro do aviso, com o que o servidor
 * devolveu — e o grupo das pagas fica recolhido fora do modo filtrado, para a
 * linha paga não continuar na tela de pagar com o mesmo nome e o mesmo valor.
 */
const conta = (x: Partial<ContaNaLista> & { id: string }): ContaNaLista => ({
  descricao: 'Aluguel da sala',
  categoria: 'Ocupação',
  tipo: 'fixa',
  valor: '450000',
  vencimento: '2026-11-05',
  vencida: true,
  fornecedor: '',
  responsavelId: '00000000-0000-4000-8000-000000000001',
  responsavel: 'Beatriz',
  mensal: true,
  pagoEm: null,
  valorPago: null,
  formaPagamento: '',
  formaPrevista: 'Boleto',
  pagoPor: null,
  ...x,
})

const GRUPOS = { mes: '2026-11', limite: '2026-11-15', tituloDasPagas: 'Pagas em novembro' }
const abertasDe = (itens: readonly ContaNaLista[]) =>
  gruposDeContas({ itens, ...GRUPOS })
    .filter((g) => g.pagas !== true)
    .flatMap((g) => g.lista.map((c) => c.id))

describe('o Paguei tira a conta das abertas na hora', () => {
  const antes: ListaDeContas = {
    itens: [conta({ id: 'a' }), conta({ id: 'b', descricao: 'Internet', vencida: false, vencimento: '2026-11-10' })],
  }

  it('antes do pagamento, a conta está em Vencidas', () => {
    expect(abertasDe(antes.itens)).toContain('a')
  })

  it('com o resultado do servidor, sai das abertas e vai para as pagas', () => {
    const depois = aplicarPagamento(antes, {
      conta: conta({ id: 'a', pagoEm: '2026-11-08', valorPago: '450000', formaPagamento: 'Boleto' }),
      proxima: null,
    })
    expect(abertasDe(depois.itens)).not.toContain('a')
    expect(abertasDe(depois.itens)).toContain('b')
    const pagas = gruposDeContas({ itens: depois.itens, ...GRUPOS }).find((g) => g.pagas === true)
    expect(pagas?.lista.map((c) => c.id)).toEqual(['a'])
  })

  it('a mensal renovada entra em "Depois deste mês", e uma vez só', () => {
    const r = {
      conta: conta({ id: 'a', pagoEm: '2026-11-08', valorPago: '450000' }),
      proxima: conta({ id: 'c', vencimento: '2026-12-05', vencida: false }),
    }
    const depois = aplicarPagamento(aplicarPagamento(antes, r), r)
    expect(depois.itens.filter((c) => c.id === 'c')).toHaveLength(1)
    const depoisDoMes = gruposDeContas({ itens: depois.itens, ...GRUPOS }).find(
      (g) => g.titulo === 'Depois deste mês',
    )
    expect(depoisDoMes?.lista.map((c) => c.id)).toEqual(['c'])
  })

  it('o total do servidor sai — a tela não refaz a soma, a releitura traz o novo', () => {
    const comTotal: ListaDeContas = { ...antes, total: { valorPago: '0' } }
    const depois = aplicarPagamento(comTotal, { conta: conta({ id: 'a', pagoEm: '2026-11-08' }), proxima: null })
    expect(depois.total).toBeUndefined()
  })
})

describe('a tela de contas', () => {
  const AQUI = dirname(fileURLToPath(import.meta.url))
  const codigo = readFileSync(join(AQUI, 'tela-contas.tsx'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')

  it('aplica o resultado do Paguei na lista antes de reler', () => {
    expect(codigo).toMatch(/contas\.trocar\(\(l\) => aplicarPagamento\(l, r\)\)/)
  })

  it('a releitura depois do Paguei não troca a lista pelo esqueleto', () => {
    expect(codigo).toMatch(/contas\.carregando && !\(relendo && contas\.dados !== null\)/)
  })

  it('as pagas ficam recolhidas fora do modo "só pagas"', () => {
    expect(codigo).toMatch(/recolhido=\{g\.pagas === true && !soPagas\}/)
    expect(codigo).toContain('<details className="grupo grupo-recolhido">')
  })
})
