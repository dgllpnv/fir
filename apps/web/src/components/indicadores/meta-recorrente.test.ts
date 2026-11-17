import type { MetaDeKpiNaSaida } from '@fir/contracts'
import { describe, expect, it } from 'vitest'
import { corpoDaMetaEditada, corpoDaMetaNova, estadoInicialDaMeta, janelaDoEstado, validarEstadoDaMeta } from './campos-da-meta'
import { daSerie, proximaDaSerie } from './detalhe-na-tela'

/**
 * A meta "Todo mês (recorrente)" da D.3 (I-24): um mês civil inteiro, o
 * primeiro da série; cada mês parte do zero — a rota recusa partida (422) —
 * e os meses seguintes o servidor cria sozinho. A tela só monta o corpo.
 */

const ID = '00000000-0000-4000-8000-000000000001'
const SERIE = '00000000-0000-4000-8000-0000000000aa'
const nota = (n: string | null) => ({ unidade: 'nota' as const, emDinheiro: null, emNumero: n, percentualDaMeta: null, escala: null })
// Um KPI que NÃO soma: a partida dele é editável nos outros tipos, e é aí que a série tem de travá-la.
const kpi = { id: ID, unidade: 'nota' as const, agregacao: 'posicao' as const, responsavelId: null, atual: nota('850') }

describe('meta recorrente no formulário', () => {
  const estado = { ...estadoInicialDaMeta(kpi, null, '2026-11-17'), tipo: 'recorrente' as const, mes: '2027-02', alvo: '9', partida: '8,5' }

  it('é o mês civil inteiro, inclusive fevereiro curto', () => {
    expect(janelaDoEstado(estado)).toEqual({ inicio: '2027-02-01', prazo: '2027-02-28' })
  })

  it('não manda partida, mesmo com o campo preenchido: cada mês parte do zero', () => {
    expect(corpoDaMetaNova(kpi, estado)).toEqual({
      kpiId: ID,
      tipo: 'recorrente',
      inicio: '2027-02-01',
      prazo: '2027-02-28',
      alvo: '900',
      responsavelId: null,
    })
    expect(corpoDaMetaEditada(kpi, estado)).not.toHaveProperty('partida')
    // No tipo "Do mês" do mesmo KPI, a partida digitada vai.
    expect(corpoDaMetaNova(kpi, { ...estado, tipo: 'mes' })).toHaveProperty('partida', '850')
  })

  it('pede o mês, e não acusa a partida que não será enviada', () => {
    expect(validarEstadoDaMeta({ ...estado, mes: '' }, kpi)).toEqual({ mes: 'Escolha o mês.' })
    expect(validarEstadoDaMeta({ ...estado, partida: 'abc' }, kpi)).toEqual({})
  })

  it('reabre como recorrente a meta que veio da série', () => {
    const m = { ...metaBase('2026-11-01', '2026-11-30'), tipo: 'recorrente' as const, serieId: SERIE }
    expect(estadoInicialDaMeta(kpi, m, '2026-11-17')).toMatchObject({ tipo: 'recorrente', mes: '2026-11' })
  })
})

function metaBase(inicio: string, prazo: string, id = ID): MetaDeKpiNaSaida {
  return {
    id,
    kpiId: ID,
    tipo: 'mes',
    inicio,
    prazo,
    alvo: nota('900'),
    partida: nota('0'),
    medidaPor: 'fir',
    responsavelId: null,
    serieId: null,
    atual: nota('850'),
    ritmo: nota('500'),
    situacao: 'no_ritmo',
    progresso: 94,
    projecao: null,
    motivoSemProjecao: null,
  }
}

describe('a série no detalhe do KPI', () => {
  const daSerieEm = (inicio: string, prazo: string, id: string) => ({ ...metaBase(inicio, prazo, id), tipo: 'recorrente' as const, serieId: SERIE })
  const nov = daSerieEm('2026-11-01', '2026-11-30', '00000000-0000-4000-8000-000000000011')
  const dez = daSerieEm('2026-12-01', '2026-12-31', '00000000-0000-4000-8000-000000000012')
  const out = daSerieEm('2026-10-01', '2026-10-31', '00000000-0000-4000-8000-000000000010')
  const avulsa = metaBase('2027-01-01', '2027-01-31', '00000000-0000-4000-8000-000000000013')

  it('o serieId do servidor diz quem é da série; ausente ou nulo, não é', () => {
    expect(daSerie(nov)).toBe(true)
    expect(daSerie(avulsa)).toBe(false)
    expect(daSerie({})).toBe(false)
  })

  it('o próximo mês é o da MESMA série, depois da vigente', () => {
    expect(proximaDaSerie([out, dez, nov, avulsa], nov)?.id).toBe(dez.id)
    expect(proximaDaSerie([out, nov], nov)).toBeNull()
    expect(proximaDaSerie([avulsa], avulsa)).toBeNull()
    expect(proximaDaSerie([nov, dez], null)).toBeNull()
  })
})
