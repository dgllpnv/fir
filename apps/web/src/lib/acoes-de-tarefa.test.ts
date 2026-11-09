import { describe, expect, it } from 'vitest'
import { valorDoFechamento } from './acoes-de-tarefa'

/**
 * O valor do "Fechou" que vai para a pergunta de possível duplicidade (D-21).
 *
 * Defeito em produção até 2026-11-09: a expressão era `/^d+$/`, e todo valor
 * de centavos virava `null` — a pergunta saía sem o valor que a pessoa digitou.
 */
describe('valorDoFechamento', () => {
  it('lê os centavos em texto do recebimento', () => {
    expect(valorDoFechamento({ acao: 'fechar', recebimento: { valor: '100000' } })).toBe(100000n)
    expect(valorDoFechamento({ acao: 'fechar', recebimento: { valor: '1' } })).toBe(1n)
  })

  it('o que não é centavos inteiros não vira valor', () => {
    expect(valorDoFechamento({ acao: 'fechar', recebimento: { valor: 'd' } })).toBeNull()
    expect(valorDoFechamento({ acao: 'fechar', recebimento: { valor: '1000.50' } })).toBeNull()
    expect(valorDoFechamento({ acao: 'fechar', recebimento: { valor: 1000 } })).toBeNull()
    expect(valorDoFechamento({ acao: 'followUp' })).toBeNull()
  })
})
