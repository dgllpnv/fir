import type { KpiNaReuniao, MetaDeKpiNaSaida, ReuniaoDeIndicadores } from '@fir/contracts'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { precisaPerguntar, rotuloDoContador, textoDoContador } from './fora-da-aba'
import { ConteudoDoSlide } from './reuniao-modo'
import { indiceVizinho, resumoDaCapa, slidesDaReuniao, textoDaSemana, tituloDoSlide } from './reuniao-na-tela'

/**
 * O Modo reunião escolhe e ordena o que o servidor mandou (1.9 F), e o
 * contador do menu decide só quando perguntar e como escrever. Os casos que
 * importam: a ordem dos slides, a frase da capa montada só de contagens
 * (appsec C8) e a resposta redigida sem `valores` — nenhum "R$" na TV.
 */

const DINHEIRO = /R\$|\d+,\d{2}/
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

const reais = (emDinheiro: string | null, percentualDaMeta: number | null) => ({
  unidade: 'reais' as const,
  emDinheiro,
  emNumero: null,
  percentualDaMeta,
  escala: null,
})

function meta(situacao: MetaDeKpiNaSaida['situacao'], redigida: boolean, n = 1): MetaDeKpiNaSaida {
  return {
    id: id(100 + n),
    kpiId: id(n),
    tipo: 'mes',
    inicio: '2026-11-01',
    prazo: '2026-11-30',
    alvo: reais(redigida ? null : '12000000', 100),
    partida: reais(redigida ? null : '0', null),
    medidaPor: 'fir',
    responsavelId: null,
    atual: reais(redigida ? null : '5400000', 45),
    ritmo: reais(redigida ? null : '7000000', 58),
    situacao,
    progresso: 45,
    projecao: null,
    motivoSemProjecao: null,
  }
}

function kpi(n: number, nome: string, situacao: MetaDeKpiNaSaida['situacao'] | null, redigido = false): KpiNaReuniao {
  return {
    id: id(n),
    nome,
    pilar: 'Financeiro',
    unidade: 'reais',
    direcao: 'maior',
    periodo: { de: '2026-11-01', ate: '2026-11-17' },
    atual: reais(redigido ? null : '5400000', situacao === null ? null : 45),
    anterior: null,
    variacao: { tipo: 'relativa', percentual: -12 },
    diasAguardando: 1,
    metaVigente: situacao === null ? null : meta(situacao, redigido, n),
  }
}

function reuniao(redigida = false): ReuniaoDeIndicadores {
  return {
    hoje: '2026-11-17',
    semana: { de: '2026-11-16', ate: '2026-11-22' },
    capa: { clinica: 'Clínica Demo', okrsAtivos: 2, metas: 5, abaixo: 2, atencao: 1, noRitmo: 1, atingidas: 1 },
    okrs: [
      {
        id: id(50),
        objetivo: 'Agenda previsível',
        periodo: { inicio: '2026-10-01', fim: '2026-12-31' },
        progresso: 40,
        situacao: 'abaixo',
        resultadosChave: [{ id: id(60), kpi: { id: id(1), nome: 'Faturamento conferido', unidade: 'reais' }, metaDoKr: meta('abaixo', redigida) }],
      },
      {
        id: id(51),
        objetivo: 'Equipe estável',
        periodo: { inicio: '2026-10-01', fim: '2026-12-31' },
        progresso: 85,
        situacao: 'no_ritmo',
        resultadosChave: [],
      },
    ],
    saude: [
      kpi(2, 'Ticket médio', 'atencao', redigida),
      kpi(3, 'Conversão', 'no_ritmo', redigida),
      kpi(4, 'Despesas', 'abaixo', redigida),
      kpi(5, 'NPS', null, redigida),
    ],
    planosDeAcao: [
      {
        id: id(70),
        descricao: 'Ligar para os orçamentos\nde outubro',
        kpi: { id: id(4), nome: 'Despesas' },
        prazo: '2026-11-24',
        status: 'aberta',
        responsavel: 'Helena',
      },
    ],
  }
}

describe('slidesDaReuniao', () => {
  it('capa, um por OKR na ordem do servidor, KPIs de saúde em vermelho e amarelo (vermelho antes), planos no fim', () => {
    const s = slidesDaReuniao(reuniao())
    expect(s.map(tituloDoSlide)).toEqual([
      'Capa',
      'Agenda previsível',
      'Equipe estável',
      'Despesas',
      'Ticket médio',
      'Planos de ação da semana',
    ])
  })

  it('sem OKR nem KPI em alerta ainda tem capa e planos', () => {
    const r = { ...reuniao(), okrs: [], saude: [kpi(3, 'Conversão', 'no_ritmo')] }
    expect(slidesDaReuniao(r).map((x) => x.tipo)).toEqual(['capa', 'planos'])
  })
})

describe('a capa', () => {
  it('"2 OKRs · 63% · 2 metas em vermelho" — média pela função do domínio, só contagens', () => {
    expect(resumoDaCapa(reuniao())).toBe('2 OKRs · 63% · 2 metas em vermelho')
  })

  it('singular, sem média quando nenhum OKR tem progresso, e o zero escrito', () => {
    const r = reuniao()
    expect(
      resumoDaCapa({
        capa: { ...r.capa, okrsAtivos: 1, abaixo: 0 },
        okrs: [{ ...r.okrs[0]!, progresso: null }],
      }),
    ).toBe('1 OKR · nenhuma meta em vermelho')
    expect(resumoDaCapa({ capa: { ...r.capa, abaixo: 1 }, okrs: [] })).toBe('2 OKRs · 1 meta em vermelho')
  })

  it('a semana que o servidor mediu', () => {
    expect(textoDaSemana({ de: '2026-11-16', ate: '2026-11-22' })).toBe('Semana de 16/11 a 22/11')
  })
})

describe('sem `valores` (emDinheiro apagado pela redação), nenhum R$ em nenhum slide', () => {
  const r = reuniao(true)
  for (const slide of slidesDaReuniao(r)) {
    it(`slide ${tituloDoSlide(slide)}`, () => {
      const html = renderToStaticMarkup(createElement(ConteudoDoSlide, { slide, r, aoPlano: () => undefined }))
      expect(html).not.toMatch(DINHEIRO)
    })
  }

  it('o KPI em reais mostra o percentual da meta que o servidor deixou', () => {
    const slide = slidesDaReuniao(r).find((s) => s.tipo === 'kpi')!
    const html = renderToStaticMarkup(createElement(ConteudoDoSlide, { slide, r, aoPlano: () => undefined }))
    expect(html).toContain('45% da meta')
  })
})

describe('com `valores`', () => {
  it('o KPI em reais mostra o valor e a meta pelo formatador central', () => {
    const r = reuniao(false)
    const slide = slidesDaReuniao(r).find((s) => s.tipo === 'kpi')!
    const html = renderToStaticMarkup(createElement(ConteudoDoSlide, { slide, r, aoPlano: () => undefined }))
    expect(html).toMatch(/R\$\s?54\.000,00/)
    expect(html).toMatch(/de R\$\s?120\.000,00/)
  })

  it('o plano aparece como foi digitado, com o responsável', () => {
    const r = reuniao(false)
    const html = renderToStaticMarkup(createElement(ConteudoDoSlide, { slide: { tipo: 'planos' }, r, aoPlano: () => undefined }))
    expect(html).toContain('Ligar para os orçamentos\nde outubro')
    expect(html).toContain('Helena')
  })
})

describe('indiceVizinho', () => {
  it('anda um e para nas pontas', () => {
    expect(indiceVizinho(0, 5, -1)).toBe(0)
    expect(indiceVizinho(0, 5, 1)).toBe(1)
    expect(indiceVizinho(4, 5, 1)).toBe(4)
    expect(indiceVizinho(0, 0, 1)).toBe(0)
  })
})

describe('o contador do menu', () => {
  it('some no zero e no desconhecido; 99+ acima de 99', () => {
    expect(textoDoContador(null)).toBeNull()
    expect(textoDoContador(0)).toBeNull()
    expect(textoDoContador(3)).toBe('3')
    expect(textoDoContador(120)).toBe('99+')
    expect(rotuloDoContador(1)).toBe('1 meta abaixo do ritmo')
    expect(rotuloDoContador(2)).toBe('2 metas abaixo do ritmo')
  })

  it('não pergunta de novo antes do respiro', () => {
    expect(precisaPerguntar(null, 1_000, 60_000)).toBe(true)
    expect(precisaPerguntar(1_000, 30_000, 60_000)).toBe(false)
    expect(precisaPerguntar(1_000, 61_000, 60_000)).toBe(true)
  })
})
