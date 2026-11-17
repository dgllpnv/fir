import { CATALOGO_DE_KPIS } from '@fir/domain'
import { describe, expect, it } from 'vitest'
import { lerParametrosDoKpi, PARAMETROS_DO_CATALOGO } from './indicadores'

describe('parâmetros do catálogo (appsec C6)', () => {
  it('um schema por chave, com exatamente os parâmetros que o catálogo declara', () => {
    expect(Object.keys(PARAMETROS_DO_CATALOGO).sort()).toEqual(CATALOGO_DE_KPIS.map((k) => k.chave).sort())
    for (const k of CATALOGO_DE_KPIS) {
      const s = PARAMETROS_DO_CATALOGO[k.chave]
      expect(Object.keys(s.shape).sort(), k.chave).toEqual([...k.parametros].sort())
    }
  })

  it('chave extra é recusada (.strict()); o padrão vazio passa', () => {
    expect(lerParametrosDoKpi('ticket_medio', { x: 1 }).success).toBe(false)
    expect(lerParametrosDoKpi('ticket_medio', {}).success).toBe(true)
    expect(lerParametrosDoKpi('ticket_medio', undefined).success).toBe(true)
    expect(lerParametrosDoKpi('novos_pacientes', { origem: 'Instagram', campanhaId: 'x' }).success).toBe(false)
  })

  it('resultado_de_campanha exige campanhaId uuid', () => {
    expect(lerParametrosDoKpi('resultado_de_campanha', {}).success).toBe(false)
    expect(lerParametrosDoKpi('resultado_de_campanha', { campanhaId: 'nao-e-uuid' }).success).toBe(false)
    expect(lerParametrosDoKpi('resultado_de_campanha', { campanhaId: '6f1c1f9e-2a3b-4c5d-8e9f-0a1b2c3d4e5f' }).success).toBe(true)
  })
})
