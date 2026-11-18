import type { KpiDaClinicaNaCarteira } from '@fir/contracts'
import { describe, expect, it } from 'vitest'
import { seloDoKpiNaCarteira } from './indicadores-da-clinica'

const kpi = (k: Partial<KpiDaClinicaNaCarteira>): KpiDaClinicaNaCarteira => ({
  kpiRef: '0b6f3c1e-8a52-4d1f-9a0e-1f2b3c4d5e6f',
  chave: null,
  nome: 'Faturamento da estética',
  pilar: 'Financeiro',
  unidade: 'reais',
  atual: { emDinheiro: null, emNumero: null },
  alvo: null,
  prazo: null,
  situacao: null,
  percentualDaMeta: null,
  inicioDaProximaMeta: null,
  ...k,
})

/**
 * O selo da ficha do Cliente Firmare fala como o cartão do KPI na tela
 * Indicadores (`textoDoSelo`): só com meta futura, "Meta a partir de dez/2026"
 * — "Sem meta" soava como se ninguém a tivesse definido.
 */
describe('o selo do KPI na carteira', () => {
  it('sem meta vigente e com a próxima já definida: "Meta a partir de <mmm/aaaa>"', () => {
    expect(seloDoKpiNaCarteira(kpi({ inicioDaProximaMeta: '2026-12-01' }))).toEqual({
      tom: 'neutro',
      texto: 'Meta a partir de dez/2026',
    })
  })

  it('sem meta nenhuma: "Sem meta"', () => {
    expect(seloDoKpiNaCarteira(kpi({})).texto).toBe('Sem meta')
  })

  it('com meta vigente, a situação dela', () => {
    expect(seloDoKpiNaCarteira(kpi({ prazo: '2026-11-30', situacao: 'abaixo' })).tom).toBe('mau')
  })
})
