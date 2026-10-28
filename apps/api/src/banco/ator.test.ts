import { describe, expect, it } from 'vitest'
import {
  PREFIXO_OPERADOR,
  SISTEMA,
  atorEmColunas,
  atorParaOBanco,
  operadorIdDeFonteConfiavel,
  pessoaIdDeFonteConfiavel,
  type OperadorId,
  type PessoaId,
} from './ator'

/**
 * O vocabulário do ator, agora com TRÊS habitantes.
 *
 * O que estes testes protegem é uma propriedade de TOTALIDADE:
 * `atorParaOBanco` e `atorEmColunas` precisam distinguir pessoa, operador e
 * sistema **em tempo de execução**. Uma marca de tipo só existe para o
 * compilador — duas marcas sobre `string` seriam indistinguíveis em execução,
 * e a tradução viraria palpite.
 */
describe('os três atores não se confundem', () => {
  it('um OperadorId não é um PessoaId para o compilador', () => {
    // @ts-expect-error — um operador não assina a trilha como pessoa
    const p: PessoaId = operadorIdDeFonteConfiavel('11111111-1111-4111-8111-111111111111')
    expect(p).toBeDefined()
  })

  it('um PessoaId não é um OperadorId para o compilador', () => {
    // @ts-expect-error — e o contrário também não
    const o: OperadorId = pessoaIdDeFonteConfiavel('22222222-2222-4222-8222-222222222222')
    expect(o).toBeDefined()
  })
})

describe('atorParaOBanco', () => {
  it('traduz operador para a sentinela que a trigger da 0013 entende', () => {
    expect(atorParaOBanco(operadorIdDeFonteConfiavel('abc-123'))).toBe('operador:abc-123')
    expect(PREFIXO_OPERADOR).toBe('operador:')
  })

  it('continua traduzindo pessoa e sistema como antes', () => {
    expect(atorParaOBanco(pessoaIdDeFonteConfiavel('abc-123'))).toBe('abc-123')
    expect(atorParaOBanco(SISTEMA)).toBe('sistema')
  })

  it('os três valores gravados são distintos entre si', () => {
    // A prova de que a tradução é injetora: se dois atores produzissem a
    // mesma string, a trilha passaria a atribuir a ação ao errado.
    const tres = [
      atorParaOBanco(pessoaIdDeFonteConfiavel('x')),
      atorParaOBanco(operadorIdDeFonteConfiavel('x')),
      atorParaOBanco(SISTEMA),
    ]
    expect(new Set(tres).size).toBe(3)
  })
})

describe('atorEmColunas conhece os três tipos', () => {
  it.each([
    [SISTEMA, { tipo: 'sistema', id: null }],
    [pessoaIdDeFonteConfiavel('p'), { tipo: 'pessoa', id: 'p' }],
    [operadorIdDeFonteConfiavel('o'), { tipo: 'operador', id: 'o' }],
  ] as const)('%o vira %o', (ator, esperado) => {
    expect(atorEmColunas(ator)).toEqual(esperado)
  })
})
