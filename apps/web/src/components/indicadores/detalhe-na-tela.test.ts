import type { MetaDeKpiNaSaida, SerieDoKpi } from '@fir/contracts'
import { describe, expect, it } from 'vitest'
import {
  ALTURA_DO_AGUARDANDO,
  alvoComparavel,
  atalhosDoPersonalizado,
  conferirPersonalizado,
  desenharBarras,
  enderecoDoRelatorio,
  larguraDoGrupo,
  leituraDoRitmoDiario,
  numeroDoGrupo,
  valorDoLancamento,
  desenharMeta,
  fonteNaTela,
  janelaDaMeta,
  janelaDosMeses,
  leituraDoPonto,
  textoDaProjecao,
} from './detalhe-na-tela'

const ID = '00000000-0000-4000-8000-000000000001'
const reais = (centavos: string | null, escala: number | null = null, pct: number | null = null) => ({
  unidade: 'reais' as const,
  emDinheiro: centavos,
  emNumero: null,
  percentualDaMeta: pct,
  escala,
})

const ponto = (dia: string, numero: ReturnType<typeof reais>, extra: Partial<{ diaAguardando: boolean; parcial: boolean }> = {}) => ({
  inicio: dia,
  fim: dia,
  parcial: extra.parcial ?? false,
  diaAguardando: extra.diaAguardando ?? false,
  numero,
})

const serie = (pontos: SerieDoKpi['pontos'], agrupamento: SerieDoKpi['agrupamento'] = 'dia', barrasSomamOTotal = true): SerieDoKpi => ({
  kpiId: ID,
  agrupamento,
  barrasSomamOTotal,
  pontos,
})

describe('as janelas dos botões', () => {
  it('3 e 12 meses começam no dia 1º e pedem mês (KPI mensal) ou semana (semanal)', () => {
    expect(janelaDosMeses(3, '2026-11-17', 'mensal')).toEqual({ de: '2026-09-01', ate: '2026-11-17', agrupamento: 'mes' })
    expect(janelaDosMeses(12, '2026-11-17', 'semanal')).toEqual({ de: '2025-12-01', ate: '2026-11-17', agrupamento: 'semana' })
  })

  it('período da meta corta em hoje; meta futura não tem série', () => {
    expect(janelaDaMeta({ inicio: '2026-11-01', prazo: '2026-11-30' }, '2026-11-17')).toEqual({ de: '2026-11-01', ate: '2026-11-17' })
    expect(janelaDaMeta({ inicio: '2026-10-01', prazo: '2026-10-31' }, '2026-11-17')).toEqual({ de: '2026-10-01', ate: '2026-10-31' })
    expect(janelaDaMeta({ inicio: '2026-12-01', prazo: '2026-12-31' }, '2026-11-17')).toBeNull()
  })

  it('personalizado recusa data futura e início depois do fim', () => {
    expect(conferirPersonalizado('2026-06-01', '2026-11-17', '2026-11-17')).toBeNull()
    expect(conferirPersonalizado('2026-06-01', '2026-11-18', '2026-11-17')).toBe('futuro')
    expect(conferirPersonalizado('2026-11-10', '2026-11-01', '2026-11-17')).toBe('invertido')
    expect(conferirPersonalizado('', '2026-11-01', '2026-11-17')).toBe('vazio')
  })

  it('os atalhos, nesta ordem, com o mês passado inteiro', () => {
    expect(atalhosDoPersonalizado('2026-03-10')).toEqual([
      { rotulo: 'Este mês', de: '2026-03-01', ate: '2026-03-10' },
      { rotulo: 'Mês passado', de: '2026-02-01', ate: '2026-02-28' },
      { rotulo: 'Últimos 6 meses', de: '2025-10-01', ate: '2026-03-10' },
      { rotulo: 'Este ano', de: '2026-01-01', ate: '2026-03-10' },
    ])
  })
})

describe('as barras', () => {
  it('dia aguardando (números c.10): barra clara de altura fixa, sem valor na leitura', () => {
    const s = serie([
      ponto('2026-11-01', reais('10000')),
      ponto('2026-11-02', reais('40000')),
      ponto('2026-11-03', reais(null), { diaAguardando: true }),
    ])
    const d = desenharBarras(s, null)
    expect(d?.modo).toBe('valor')
    const ag = d?.barras[2]
    expect(ag?.tipo).toBe('aguardando')
    expect(ag?.ate).toBeCloseTo(ALTURA_DO_AGUARDANDO)
    expect(ag?.leitura).toBe('03/11: aguardando fechamento do caixa')
    expect(d?.barras[1]?.ate).toBe(1)
  })

  it('mês inteiro sem dado e hoje aguardando: a barra clara aparece do mesmo jeito', () => {
    const s = serie([ponto('2026-11-01', reais(null)), ponto('2026-11-02', reais(null), { diaAguardando: true })])
    expect(desenharBarras(s, null)?.barras.map((b) => b.tipo)).toEqual(['sem_dado', 'aguardando'])
    expect(desenharBarras(serie([ponto('2026-11-01', reais(null))]), null)).toBeNull()
  })

  it('sem `valores`: desenha pela escala e nenhuma leitura tem R$', () => {
    const s = serie(
      [ponto('2026-06-01', reais(null, 50)), ponto('2026-07-01', reais(null, 100)), ponto('2026-08-01', reais(null, 80), { parcial: true })],
      'mes',
    )
    const d = desenharBarras(s, 120000n)
    expect(d?.modo).toBe('escala')
    expect(d?.alvo).toBeNull()
    expect(d?.barras.map((b) => b.tipo)).toEqual(['cheia', 'cheia', 'parcial'])
    for (const b of d?.barras ?? []) expect(b.leitura).not.toMatch(/R\$/)
  })

  it('com valor e alvo comparável, a régua do alvo entra na escala', () => {
    const s = serie([ponto('2026-10-01', reais('5000000')), ponto('2026-11-01', reais('2500000'), { parcial: true })], 'mes')
    const d = desenharBarras(s, 10000000n)
    expect(d?.alvo).toBe(1)
    expect(d?.barras[0]?.ate).toBe(0.5)
  })

  it('o alvo de um mês não se compara com a barra de um dia, num KPI que soma', () => {
    expect(alvoComparavel('soma', 'dia', { tipo: 'mes' })).toBe(false)
    expect(alvoComparavel('soma', 'mes', { tipo: 'mes' })).toBe(true)
    expect(alvoComparavel('soma', 'mes', { tipo: 'ate_data' })).toBe(false)
    expect(alvoComparavel('taxa', 'dia', { tipo: 'ate_data' })).toBe(true)
    expect(alvoComparavel('taxa', 'mes', null)).toBe(false)
  })

  it('a leitura sai do formatador central', () => {
    expect(leituraDoPonto(ponto('2026-11-05', reais('320000')), 'dia')).toMatch(/^05\/11: R\$\s?3\.200,00$/)
  })
})

const meta = (sobre: Partial<MetaDeKpiNaSaida> = {}): MetaDeKpiNaSaida => ({
  id: ID,
  kpiId: ID,
  tipo: 'mes',
  inicio: '2026-11-01',
  prazo: '2026-11-30',
  alvo: reais('12000000', null, 100),
  partida: reais('0', null, 0),
  medidaPor: 'fir',
  responsavelId: null,
  atual: reais('4000000', null, 33),
  ritmo: reais('6000000', null, 50),
  situacao: 'abaixo',
  progresso: 33,
  projecao: reais('10400000', null, 87),
  motivoSemProjecao: null,
  ...sobre,
})

describe('as quatro linhas do período da meta', () => {
  it('com valores: o real é o acumulado, o ritmo passa pelo "onde deveria estar hoje"', () => {
    const s = serie([ponto('2026-11-01', reais('1000000')), ponto('2026-11-02', reais('3000000'))])
    const d = desenharMeta(meta(), s, 'soma', '2026-11-17')
    expect(d.modo).toBe('valor')
    expect(d.real.length).toBe(3)
    expect(d.ritmo.length).toBe(3)
    expect(d.projecao.length).toBe(2)
    expect(d.projecao[1]?.x).toBe(1)
  })

  it('sem valores: percentual da meta, sem R$ em nenhuma leitura', () => {
    const semReais = meta({
      alvo: reais(null, null, null),
      partida: reais(null, null, 0),
      atual: reais(null, null, 33),
      ritmo: reais(null, null, 50),
      projecao: reais(null, null, 87),
    })
    const s = serie([ponto('2026-11-01', reais(null, 25)), ponto('2026-11-02', reais(null, 100)), ponto('2026-11-03', reais(null), { diaAguardando: true })])
    const d = desenharMeta(semReais, s, 'soma', '2026-11-17')
    expect(d.modo).toBe('percentual')
    expect(d.aguardando.length).toBe(1)
    for (const l of d.leituras) expect(l.texto).not.toMatch(/R\$/)
    expect(textoDaProjecao(semReais)).toEqual({ numero: '87% da meta', nota: null })
  })

  it('a projeção com valores diz o valor e o percentual', () => {
    const t = textoDaProjecao(meta())
    expect(t.numero).toMatch(/^R\$\s?104\.000,00$/)
    expect(t.nota).toBe('87% da meta')
  })
})

it('a fonte perde a referência interna da spec e guarda o resto', () => {
  expect(fonteNaTela('Recebimentos dos dias com caixa fechado (I-9)')).toBe('Recebimentos dos dias com caixa fechado')
  expect(fonteNaTela('Análise do estoque (as barras não somam o total)')).toBe('Análise do estoque (as barras não somam o total)')
})

describe('o ritmo diário da meta no dia a dia', () => {
  it('com valores: a linha fica na régua das barras, em reais', () => {
    const s = { ...serie([ponto('2026-11-01', reais('10000')), ponto('2026-11-02', reais('40000'))]), ritmoDiario: reais('20000', 50, 1) }
    const d = desenharBarras(s, null)
    expect(d?.ritmo).toBe(0.5)
    expect(leituraDoRitmoDiario(s.ritmoDiario)).toMatch(/^Ritmo diário da meta: R\$\s?200,00 por dia útil$/)
  })

  it('sem valores: a linha sai da escala e a leitura do percentual, sem R$', () => {
    const s = { ...serie([ponto('2026-11-01', reais(null, 25)), ponto('2026-11-02', reais(null, 100))]), ritmoDiario: reais(null, 50, 1) }
    const d = desenharBarras(s, null)
    expect(d?.modo).toBe('escala')
    expect(d?.ritmo).toBe(0.5)
    expect(leituraDoRitmoDiario(s.ritmoDiario)).toBe('Ritmo diário da meta: 1% da meta por dia útil')
  })

  it('sem ritmo do servidor, sem linha', () => {
    expect(desenharBarras(serie([ponto('2026-11-01', reais('1'))]), null)?.ritmo).toBeNull()
  })
})

describe('a composição e os lançamentos', () => {
  it('o grupo mostra o valor; sem valores, a altura relativa ao bloco — nunca R$', () => {
    expect(numeroDoGrupo(reais('150000', 100))).toMatch(/^R\$\s?1\.500,00$/)
    expect(numeroDoGrupo(reais(null, 40))).toBe('40%')
    expect(larguraDoGrupo(reais(null, 40))).toBe('40%')
    expect(larguraDoGrupo(reais(null, null))).toBe('0%')
  })

  it('"Ver recebimentos" abre o relatório filtrado, só pela URL', () => {
    expect(enderecoDoRelatorio({ chave: 'recebimentos', de: '2026-11-01', ate: '2026-11-17' })).toBe(
      '/indicadores/relatorios?relatorio=recebimentos&de=2026-11-01&ate=2026-11-17',
    )
  })

  it('o lançamento em reais sem valores sai "—"; nas outras unidades, o número', () => {
    expect(valorDoLancamento('reais', { emDinheiro: null, emNumero: null })).toBe('—')
    expect(valorDoLancamento('nota', { emDinheiro: null, emNumero: '850' })).toBe('8,5')
  })
})
