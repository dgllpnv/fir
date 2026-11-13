import { describe, expect, it } from 'vitest'
import {
  abasDaFicha,
  fechouXdeY,
  MARCA_DO_ITEM,
  proximaAba,
  ROTULO_DA_SITUACAO,
} from './orcamentos-do-paciente'

describe('orçamentos do paciente', () => {
  it('o selo usa os nomes unificados', () => {
    expect(ROTULO_DA_SITUACAO.parcial).toBe('Orçamento parcialmente fechado')
    expect(ROTULO_DA_SITUACAO.aberto).toBe('Aberto')
  })
  it('fechou X de Y, com singular e sem detalhamento', () => {
    expect(fechouXdeY(2, 3)).toBe('fechou 2 de 3 procedimentos')
    expect(fechouXdeY(1, 1)).toBe('fechou 1 de 1 procedimento')
    expect(fechouXdeY(null, 3)).toBe('sem detalhamento')
    expect(fechouXdeY(undefined, undefined)).toBe('sem detalhamento')
  })
  it('toda marca de item tem texto', () => {
    for (const m of Object.values(MARCA_DO_ITEM)) expect(m.texto.length).toBeGreaterThan(0)
  })
  it('sem jornada só existe o Histórico', () => {
    expect(abasDaFicha(false)).toEqual(['historico'])
    expect(abasDaFicha(true)).toEqual(['historico', 'orcamentos'])
  })
  it('setas circulam, Home/End vão às pontas', () => {
    const a = abasDaFicha(true)
    expect(proximaAba(a, 'historico', 'ArrowRight')).toBe('orcamentos')
    expect(proximaAba(a, 'orcamentos', 'ArrowRight')).toBe('historico')
    expect(proximaAba(a, 'historico', 'ArrowLeft')).toBe('orcamentos')
    expect(proximaAba(a, 'orcamentos', 'Home')).toBe('historico')
    expect(proximaAba(a, 'historico', 'End')).toBe('orcamentos')
    expect(proximaAba(a, 'historico', 'x')).toBeNull()
  })
})
