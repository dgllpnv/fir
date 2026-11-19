import { ResultadoDoRelatorio } from '@fir/contracts'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ResumoDoRelatorio } from './resumo-do-relatorio'

/**
 * O resumo do relatório 8 (recebimentos) e os dias aguardando o fechamento do
 * caixa. O dinheiro de HOJE nunca atravessa (regra 6): o servidor o deixa fora
 * de `total` e de `aguardandoFechamento`, e diz só `hojeAguardando`. A tela não
 * pode pôr valor nenhum ao lado de hoje — "Mais R$ 0,00 em 1 dia" foi o defeito
 * visto em produção, e um valor ali seria o esperado da gaveta.
 */

const reais = (centavos: string | null) => ({
  unidade: 'reais' as const,
  emDinheiro: centavos,
  emNumero: null,
  percentualDaMeta: null,
  escala: null,
})

const resultado = (resumo: {
  aguardandoFechamento: string | null
  diasAnterioresAguardando: number
  hojeAguardando: boolean
  total?: string | null
}) => {
  const total = resumo.total === undefined ? '38000' : resumo.total
  return ResultadoDoRelatorio.parse({
    relatorio: 'recebimentos',
    classe: 'pessoal',
    cabecalho: { titulo: 'Recebimentos', filtrosEmTexto: [] },
    colunas: [],
    linhas: [],
    // Sem `valores`, o servidor não manda soma nenhuma (a coluna não sai).
    somas: total === null ? [] : [{ coluna: 'valor', rotulo: 'Total', valor: total }],
    resumo: {
      recebimentos: 3,
      total: reais(total),
      porForma: [],
      porTipo: [],
      aguardandoFechamento: resumo.aguardandoFechamento,
      diasAnterioresAguardando: resumo.diasAnterioresAguardando,
      hojeAguardando: resumo.hojeAguardando,
    },
    truncado: false,
  })
}

const html = (r: ReturnType<typeof resultado>): string =>
  renderToStaticMarkup(createElement(ResumoDoRelatorio, { resultado: r }))
    // O texto, sem as tags: a frase pode atravessar um <b>.
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')

describe('relatório 8 — os dias aguardando o fechamento do caixa', () => {
  it('só hoje aguardando: diz que hoje aguarda, SEM valor nenhum', () => {
    const t = html(resultado({ aguardandoFechamento: '0', diasAnterioresAguardando: 0, hojeAguardando: true }))
    expect(t).toContain('Hoje aguarda o fechamento do caixa')
    expect(t).not.toContain('R$ 0,00')
    expect(t).not.toMatch(/Mais R\$/)
    expect(t).not.toMatch(/em 1 dia/)
  })

  it('dias anteriores e hoje: o valor é só dos anteriores, e hoje aparece à parte, sem valor', () => {
    const t = html(resultado({ aguardandoFechamento: '7000', diasAnterioresAguardando: 1, hojeAguardando: true }))
    expect(t).toMatch(/Mais R\$\s70,00 em 1 dia aguardando o fechamento do caixa/)
    expect(t).toContain('Hoje também aguarda o fechamento')
    // Um R$ só na linha do aguardando (o outro é o total do período).
    expect(t.match(/R\$/g)).toHaveLength(2)
  })

  it('só dias anteriores: a frase de sempre, sem falar de hoje', () => {
    const t = html(resultado({ aguardandoFechamento: '7000', diasAnterioresAguardando: 2, hojeAguardando: false }))
    expect(t).toMatch(/Mais R\$\s70,00 em 2 dias aguardando o fechamento do caixa/)
    expect(t).not.toContain('Hoje')
  })

  it('sem `valores`: a contagem dos anteriores e hoje à parte, sem R$', () => {
    const t = html(resultado({ aguardandoFechamento: null, diasAnterioresAguardando: 2, hojeAguardando: true, total: null }))
    expect(t).toContain('2 dias aguardam o fechamento do caixa')
    expect(t).toContain('Hoje também aguarda o fechamento')
    expect(t).not.toMatch(/R\$|\d+,\d{2}/)
    const soHoje = html(resultado({ aguardandoFechamento: null, diasAnterioresAguardando: 0, hojeAguardando: true, total: null }))
    expect(soHoje).toContain('Hoje aguarda o fechamento do caixa')
    expect(soHoje).not.toMatch(/R\$|\d+,\d{2}/)
  })

  it('nada aguardando: nenhum aviso', () => {
    const t = html(resultado({ aguardandoFechamento: '0', diasAnterioresAguardando: 0, hojeAguardando: false }))
    expect(t).not.toContain('aguard')
  })
})

describe('a faixa de resumo com as somas do servidor (backlog 1.8)', () => {
  const pacientes = (somas: { coluna: string; rotulo: string; valor: string | null }[]) =>
    ResultadoDoRelatorio.parse({
      relatorio: 'pacientes-sem-atendimento',
      classe: 'pessoal',
      cabecalho: { titulo: 'Pacientes sem atendimento', filtrosEmTexto: [] },
      colunas: [],
      linhas: [],
      somas,
      resumo: { pacientes: 148 },
      truncado: false,
    })

  it('"148 pacientes · LTV somado R$ 312.400,00", pelo formatador central', () => {
    const t = html(pacientes([{ coluna: 'ltv', rotulo: 'LTV somado', valor: '31240000' }]))
    expect(t).toMatch(/148 pacientes · LTV somado R\$\s312\.400,00/)
  })

  it('sem somas (sem `valores`), só a contagem e nenhum R$', () => {
    const t = html(pacientes([]))
    expect(t).toContain('148 pacientes')
    expect(t).not.toMatch(/R\$|somado/)
  })
})
