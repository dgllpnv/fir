import { describe, expect, it } from 'vitest'
import { assuntoLegivel } from './rotulos'

/**
 * As tabelas de Indicadores & Insights que a trilha grava (0098, 0104) saem em
 * Atividades com o nome do glossário (CONTEXT.md), nunca como o banco as chama
 * — "lancamentos de kpi" foi o que a validação em produção encontrou.
 */
describe('Atividades: as tabelas de Indicadores & Insights têm nome de gente', () => {
  const esperado: Readonly<Record<string, string>> = {
    kpis: 'KPIs',
    lancamentos_de_kpi: 'Lançamentos de KPI',
    metas_de_kpi: 'Metas de KPI',
    series_de_meta: 'Metas recorrentes de KPI',
    fotografias_de_kpi: 'Fotografias diárias de KPI',
    okrs: 'OKRs',
    resultados_chave: 'Resultados-chave',
    relatorios_favoritos: 'Relatórios favoritos',
  }

  for (const [tabela, rotulo] of Object.entries(esperado)) {
    it(tabela, () => {
      expect(assuntoLegivel(tabela)).toBe(rotulo)
    })
  }

  it('o que não está na tabela continua aparecendo, sem sublinhado', () => {
    expect(assuntoLegivel('tabela_nova')).toBe('tabela nova')
  })
})
