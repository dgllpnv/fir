import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { somarDias } from '../relogio'
import { prazoDoKr } from './okr'

/** O prazo próprio do KR (backlog 1.9 D.2): padrão é o fim do período, e fica dentro dele. */
const OUTUBRO = { inicio: '2026-10-01', fim: '2026-10-31' }

describe('prazoDoKr', () => {
  it('sem pedido e sem KR: o fim do período', () => {
    expect(prazoDoKr(OUTUBRO, undefined, null)).toEqual({ tipo: 'ok', valor: '2026-10-31' })
  })

  it('com pedido: ele, bordas inclusivas; fora, erro', () => {
    expect(prazoDoKr(OUTUBRO, '2026-10-15', null)).toEqual({ tipo: 'ok', valor: '2026-10-15' })
    expect(prazoDoKr(OUTUBRO, '2026-10-01', null)).toEqual({ tipo: 'ok', valor: '2026-10-01' })
    expect(prazoDoKr(OUTUBRO, '2026-10-31', null)).toEqual({ tipo: 'ok', valor: '2026-10-31' })
    for (const fora of ['2026-09-30', '2026-11-01']) {
      const r = prazoDoKr(OUTUBRO, fora, null)
      expect(r.tipo === 'erro' && r.erro.codigo).toBe('PrazoDoKrForaDoPeriodo')
    }
    const r = prazoDoKr(OUTUBRO, '2026-02-30', null)
    expect(r.tipo === 'erro' && r.erro.codigo).toBe('DataInvalida')
  })

  it('KR existente sem pedido: o prazo próprio fica; o que era o fim acompanha o fim novo', () => {
    const novo = { inicio: '2026-10-01', fim: '2026-11-30' }
    expect(prazoDoKr(novo, undefined, { prazo: '2026-10-15', fimAnterior: '2026-10-31' })).toEqual({ tipo: 'ok', valor: '2026-10-15' })
    expect(prazoDoKr(novo, undefined, { prazo: '2026-10-31', fimAnterior: '2026-10-31' })).toEqual({ tipo: 'ok', valor: '2026-11-30' })
    // O próprio que fica fora do período novo é erro — nunca puxado para dentro.
    const r = prazoDoKr({ inicio: '2026-10-20', fim: '2026-11-30' }, undefined, { prazo: '2026-10-15', fimAnterior: '2026-10-31' })
    expect(r.tipo === 'erro' && r.erro.codigo).toBe('PrazoDoKrForaDoPeriodo')
  })

  it('propriedade: todo prazo aceito está em [início, fim]; todo dia do período é aceito', () => {
    const dia = fc.integer({ min: 0, max: 3000 }).map((n) => somarDias('2024-01-01', n))
    fc.assert(
      fc.property(dia, fc.integer({ min: 0, max: 400 }), fc.integer({ min: -30, max: 430 }), (inicio, dur, desloc) => {
        const p = { inicio, fim: somarDias(inicio, dur) }
        const pedido = somarDias(inicio, desloc)
        const r = prazoDoKr(p, pedido, null)
        const dentro = desloc >= 0 && desloc <= dur
        expect(r.tipo).toBe(dentro ? 'ok' : 'erro')
        if (r.tipo === 'ok') expect(r.valor >= p.inicio && r.valor <= p.fim).toBe(true)
      }),
    )
  })
})
