import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { AguardandoFechamento } from './tela-visao-do-mes'

/**
 * Visão do mês — os dias aguardando o fechamento do caixa. O mesmo defeito do
 * relatório 8: a contagem incluía hoje e o valor não, e a tela escrevia
 * "R$ 0,00 aguardando fechamento do caixa em 1 dia". O dinheiro de hoje é o
 * esperado da gaveta (regra 6): nunca há valor ao lado de hoje.
 */
const texto = (v: {
  aguardandoFechamento: string | null
  diasAnterioresAguardandoFechamento: number
  hojeAguardandoFechamento: boolean
}): string =>
  renderToStaticMarkup(createElement(AguardandoFechamento, { v: { ...v, kpiDaMetaId: null }, podeIndicadores: false }))
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

describe('Visão do mês — aguardando o fechamento do caixa', () => {
  it('só hoje: diz que hoje aguarda, sem valor nenhum', () => {
    const t = texto({ aguardandoFechamento: '0', diasAnterioresAguardandoFechamento: 0, hojeAguardandoFechamento: true })
    expect(t).toBe('Hoje aguarda o fechamento do caixa, fora da meta até fechar.')
  })

  it('dias anteriores e hoje: o valor é só dos anteriores, e hoje vem à parte', () => {
    const t = texto({ aguardandoFechamento: '400000', diasAnterioresAguardandoFechamento: 1, hojeAguardandoFechamento: true })
    expect(t).toMatch(
      /^R\$\s4\.000,00 aguardando fechamento do caixa em 1 dia, fora da meta até fechar\. Hoje também aguarda o fechamento\.$/,
    )
  })

  it('só dias anteriores: a frase de sempre, sem hoje', () => {
    const t = texto({ aguardandoFechamento: '400000', diasAnterioresAguardandoFechamento: 2, hojeAguardandoFechamento: false })
    expect(t).toMatch(/^R\$\s4\.000,00 aguardando fechamento do caixa em 2 dias, fora da meta até fechar\.$/)
  })

  it('sem `valores` (valor redigido): nunca R$', () => {
    const t = texto({ aguardandoFechamento: null, diasAnterioresAguardandoFechamento: 2, hojeAguardandoFechamento: true })
    expect(t).toBe('Aguardando fechamento do caixa em 2 dias, fora da meta até fechar. Hoje também aguarda o fechamento.')
    const soHoje = texto({ aguardandoFechamento: null, diasAnterioresAguardandoFechamento: 0, hojeAguardandoFechamento: true })
    expect(soHoje).toBe('Hoje aguarda o fechamento do caixa, fora da meta até fechar.')
    expect(t + soHoje).not.toMatch(/R\$|\d+,\d{2}/)
  })

  it('nada aguardando e sem link: nada', () => {
    expect(texto({ aguardandoFechamento: '0', diasAnterioresAguardandoFechamento: 0, hojeAguardandoFechamento: false })).toBe('')
  })
})
