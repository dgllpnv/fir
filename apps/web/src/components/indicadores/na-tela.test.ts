import type { KpiNaLista, MetaDeKpiNaSaida, PreviaDaMeta } from '@fir/contracts'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { CartaoDoKpi } from './cartao-do-kpi'
import {
  fraseDaPrevia,
  menorUnidadeDoTexto,
  numeroDoCartao,
  okrNoPeriodo,
  ordenarPorSituacao,
  rotuloDaComparacao,
  textoDaMenorUnidade,
  textoDaVariacao,
  trimestresAte,
} from './na-tela'

/**
 * A tela de Indicadores escreve o que o servidor mandou. Os casos que
 * importam são os da redação: sem `valores`, o servidor apaga `emDinheiro`
 * (I-34) — e a tela tem de desenhar o percentual da meta, nunca um "R$", sem
 * nenhum `if` de permissão. Aqui a resposta redigida é montada à mão, igual à
 * que o `RedacaoInterceptor` entrega.
 */

const UUID = '11111111-1111-4111-8111-111111111111'
const DINHEIRO = /R\$|\d+,\d{2}/

const reais = (emDinheiro: string | null, percentualDaMeta: number | null = null) => ({
  unidade: 'reais' as const,
  emDinheiro,
  emNumero: null,
  percentualDaMeta,
  escala: null,
})

function meta(redigida: boolean): MetaDeKpiNaSaida {
  return {
    id: UUID,
    kpiId: UUID,
    tipo: 'mes',
    inicio: '2026-11-01',
    prazo: '2026-11-30',
    alvo: reais(redigida ? null : '12000000', 100),
    partida: reais(redigida ? null : '0'),
    medidaPor: 'fir',
    responsavelId: null,
    atual: reais(redigida ? null : '9360000', 78),
    ritmo: reais(redigida ? null : '8000000', 67),
    situacao: 'no_ritmo',
    progresso: 78,
    projecao: null,
    motivoSemProjecao: null,
  }
}

function kpi(redigido: boolean): KpiNaLista {
  return {
    id: UUID,
    okrIds: [],
    origem: 'catalogo',
    chave: 'faturamento_conferido',
    nome: 'Faturamento conferido',
    pilar: 'Financeiro',
    unidade: 'reais',
    direcao: 'maior',
    agregacao: 'soma',
    frequencia: 'mensal',
    parametros: {},
    responsavelId: null,
    periodo: { de: '2026-11-01', ate: '2026-11-17' },
    atual: reais(redigido ? null : '9360000', 78),
    anterior: reais(redigido ? null : '8000000'),
    variacao: { tipo: 'relativa', percentual: 12 },
    diasAguardando: 0,
    motivoSemValor: null,
    metaVigente: meta(redigido),
  }
}

describe('o cartão do KPI sem `valores` (1.10 item 6)', () => {
  it('mostra só o percentual da meta, sem nenhum R$', () => {
    const k = kpi(true)
    const html = renderToStaticMarkup(
      createElement(CartaoDoKpi, { kpi: k, meta: k.metaVigente, atual: k.atual, serie: null, acoes: [] }),
    )
    expect(html).toContain('78% da meta')
    expect(html).not.toMatch(DINHEIRO)
    // A comparação continua: a variação é relativa, não é dinheiro.
    expect(html).toContain('▲ 12% vs. mesmo dia de outubro')
  })

  it('com `valores`, o valor e "de R$ …" da meta', () => {
    const k = kpi(false)
    const html = renderToStaticMarkup(
      createElement(CartaoDoKpi, { kpi: k, meta: k.metaVigente, atual: k.atual, serie: null, acoes: [] }),
    )
    expect(html).toContain('R$')
    expect(html).toContain('93.600,00')
    expect(html).toContain('de R$')
    expect(html).not.toContain('da meta</strong>')
  })

  it('"Despesas fixas sobre o recebido" leva a dica própria (números c.5)', () => {
    const k: KpiNaLista = {
      ...kpi(false),
      chave: 'despesas_fixas_sobre_recebido',
      nome: 'Despesas fixas sobre o recebido',
      unidade: 'percentual',
      direcao: 'menor',
      agregacao: 'taxa',
      atual: { unidade: 'percentual', emDinheiro: null, emNumero: '3550', percentualDaMeta: null, escala: null },
      metaVigente: null,
    }
    const html = renderToStaticMarkup(createElement(CartaoDoKpi, { kpi: k, meta: null, atual: k.atual, serie: null, acoes: [] }))
    expect(html).toContain('Como é calculado: Despesas fixas sobre o recebido')
    expect(html).toContain('35,5%')
    expect(html).toContain('Sem meta')
  })
})

describe('a frase da prévia D.3 é montada na tela (appsec C8)', () => {
  const previa = (redigida: boolean): PreviaDaMeta => ({
    prazo: '2026-12-31',
    diasUteis: 23,
    ritmoPorDiaUtil: reais(redigida ? null : '521739'),
    atualPorDiaUtil: reais(redigida ? null : '410000'),
  })

  it('com `valores`: alvo, ritmo e o de hoje, pelo formatador central', () => {
    expect(fraseDaPrevia(previa(false), { unidade: 'reais', valor: 12000000n })).toBe(
      'Para chegar a R$ 120.000,00 em 31/12, o ritmo esperado é de R$ 5.217,39 por dia útil. Hoje a clínica está em R$ 4.100,00 por dia útil.',
    )
  })

  it('sem `valores` não sai trecho em reais — nem o alvo digitado', () => {
    const frase = fraseDaPrevia(previa(true), { unidade: 'reais', valor: 12000000n })
    expect(frase).not.toMatch(DINHEIRO)
    expect(frase).toBe('Até 31/12 são 23 dias úteis.')
  })

  it('em unidade que não é dinheiro, a frase sai inteira', () => {
    const p: PreviaDaMeta = {
      prazo: '2026-12-31',
      diasUteis: 1,
      ritmoPorDiaUtil: { unidade: 'quantidade', emDinheiro: null, emNumero: '150', percentualDaMeta: null, escala: null },
      atualPorDiaUtil: { unidade: 'quantidade', emDinheiro: null, emNumero: null, percentualDaMeta: null, escala: null },
    }
    expect(fraseDaPrevia(p, { unidade: 'quantidade', valor: 3000n })).toBe(
      'Para chegar a 30 em 31/12, o ritmo esperado é de 1,5 por dia útil.',
    )
  })
})

describe('textos do cartão', () => {
  it('sem valor e sem percentual é um traço, nunca zero', () => {
    expect(numeroDoCartao(reais(null)).texto).toBe('—')
  })

  it('a cor da variação segue a DIREÇÃO do KPI', () => {
    expect(textoDaVariacao({ tipo: 'relativa', percentual: 8 }, 'maior')).toEqual({ texto: '▲ 8%', tom: 'ok' })
    expect(textoDaVariacao({ tipo: 'relativa', percentual: 8 }, 'menor')).toEqual({ texto: '▲ 8%', tom: 'mau' })
    expect(textoDaVariacao({ tipo: 'pontos', emCentesimos: '-250' }, 'maior')).toEqual({ texto: '▼ 2,5 p.p.', tom: 'mau' })
    expect(textoDaVariacao({ tipo: 'novo' }, 'maior')?.texto).toBe('novo')
  })

  it('o rótulo da comparação: mesmo dia do mês anterior em quem soma, semana anterior no semanal', () => {
    const base = { chave: null, periodo: { de: '2027-01-01', ate: '2027-01-17' } }
    expect(rotuloDaComparacao({ ...base, frequencia: 'mensal', agregacao: 'soma' })).toBe('vs. mesmo dia de dezembro')
    expect(rotuloDaComparacao({ ...base, frequencia: 'mensal', agregacao: 'taxa' })).toBe('vs. dezembro')
    expect(rotuloDaComparacao({ ...base, frequencia: 'semanal', agregacao: 'taxa' })).toBe('vs. semana anterior')
  })

  it('Saúde da clínica: vermelho, amarelo, verde; sem meta por último', () => {
    const m = (situacao: MetaDeKpiNaSaida['situacao']) => ({ ...meta(false), situacao })
    const xs = [
      { nome: 'a', metaVigente: null },
      { nome: 'b', metaVigente: m('no_ritmo') },
      { nome: 'c', metaVigente: m('abaixo') },
      { nome: 'd', metaVigente: m('atencao') },
    ]
    expect(ordenarPorSituacao(xs).map((x) => x.nome)).toEqual(['c', 'd', 'b', 'a'])
  })
})

describe('o que se digita → a menor unidade, sem ponto flutuante', () => {
  it('reais e centésimos pela leitura de dígitos', () => {
    expect(menorUnidadeDoTexto('reais', '120.000,00')).toBe(12000000n)
    expect(menorUnidadeDoTexto('reais', 'R$ 19,99')).toBe(1999n)
    expect(menorUnidadeDoTexto('percentual', '35,5')).toBe(3550n)
    expect(menorUnidadeDoTexto('nota', '9,2')).toBe(920n)
    expect(menorUnidadeDoTexto('quantidade', 'trinta')).toBeNull()
    expect(menorUnidadeDoTexto('quantidade', '')).toBeNull()
  })

  it('horas em minutos, pela escala da unidade', () => {
    expect(menorUnidadeDoTexto('horas', '12:30')).toBe(750n)
    expect(menorUnidadeDoTexto('horas', '12h')).toBe(720n)
    expect(menorUnidadeDoTexto('horas', '1:75')).toBeNull()
  })

  it('ida e volta: o texto do campo relido dá o mesmo inteiro', () => {
    for (const v of [0n, 1n, 99n, 1999n, 12000000n]) {
      expect(menorUnidadeDoTexto('reais', textoDaMenorUnidade('reais', v))).toBe(v)
      expect(menorUnidadeDoTexto('horas', textoDaMenorUnidade('horas', v))).toBe(v)
    }
  })
})

describe('período', () => {
  it('o filtro oferece o trimestre de hoje e os anteriores, nunca o futuro', () => {
    expect(trimestresAte('2026-11-17', 3).map((t) => [t.inicio, t.fim])).toEqual([
      ['2026-10-01', '2026-12-31'],
      ['2026-07-01', '2026-09-30'],
      ['2026-04-01', '2026-06-30'],
    ])
  })

  it('o OKR aparece no trimestre que o toca', () => {
    const t = { inicio: '2026-10-01', fim: '2026-12-31' }
    expect(okrNoPeriodo({ periodo: { tipo: 'datas', inicio: '2026-09-15', fim: '2026-10-01' } }, t)).toBe(true)
    expect(okrNoPeriodo({ periodo: { tipo: 'trimestre', inicio: '2027-01-01', fim: '2027-03-31' } }, t)).toBe(false)
  })
})
