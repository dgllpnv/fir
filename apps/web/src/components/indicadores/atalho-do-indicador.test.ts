import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { AtalhoDoIndicador, AtalhoParaIndicadores } from './atalho-do-indicador'

/**
 * O atalho de Equipe › Metas do mês, Visão do mês e Campanhas para o KPI
 * correspondente: aparece com o id do servidor e a permissão `indicadores`;
 * sem um dos dois, não há link (e ninguém cai em "Sem acesso").
 */
const ID = '0b6f3c1e-8a52-4d1f-9a0e-1f2b3c4d5e6f'
const html = (kpiId: string | null | undefined, podeIndicadores: boolean) =>
  renderToStaticMarkup(createElement(AtalhoDoIndicador, { kpiId, podeIndicadores }))

describe('AtalhoDoIndicador', () => {
  it('com o KPI e a permissão: "Acompanhar em Indicadores & Insights" leva ao detalhe', () => {
    const h = html(ID, true)
    expect(h).toContain(`href="/indicadores/${ID}"`)
    expect(h).toContain('Acompanhar em Indicadores &amp; Insights')
  })
  it('sem a permissão, ou sem KPI acompanhado, nada', () => {
    expect(html(ID, false)).toBe('')
    expect(html(null, true)).toBe('')
    expect(html(undefined, true)).toBe('')
  })
  it('Minhas metas: o atalho para a aba, só com a permissão', () => {
    const h = renderToStaticMarkup(createElement(AtalhoParaIndicadores, { podeIndicadores: true }))
    expect(h).toContain('href="/indicadores"')
    expect(h).toContain('Acompanhar em Indicadores &amp; Insights')
    expect(renderToStaticMarkup(createElement(AtalhoParaIndicadores, { podeIndicadores: false }))).toBe('')
  })
})
