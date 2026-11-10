import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { umPorClinica, umaPorCampanhaEMes } from './um-por-clinica'

const linha = fc.record({
  id: fc.uuid(),
  clinica_id: fc.option(fc.constantFrom('c1', 'c2', 'c3', 'c4'), { nil: null }),
  conta_na_receita: fc.boolean(),
})

describe('umPorClinica', () => {
  it('uma linha por clínica; linhas sem clínica ficam todas', () => {
    fc.assert(
      fc.property(fc.array(linha, { maxLength: 30 }), (linhas) => {
        const r = umPorClinica(linhas)
        const clinicas = new Set(linhas.flatMap((l) => (l.clinica_id === null ? [] : [l.clinica_id])))
        expect(r.filter((l) => l.clinica_id !== null)).toHaveLength(clinicas.size)
        expect(r.filter((l) => l.clinica_id === null)).toHaveLength(linhas.filter((l) => l.clinica_id === null).length)
      }),
    )
  })

  it('prefere quem conta na receita, e é idempotente', () => {
    fc.assert(
      fc.property(fc.array(linha, { maxLength: 30 }), (linhas) => {
        const r = umPorClinica(linhas)
        for (const l of r) {
          if (l.clinica_id === null) continue
          const temPagador = linhas.some((x) => x.clinica_id === l.clinica_id && x.conta_na_receita)
          expect(l.conta_na_receita).toBe(temPagador)
        }
        expect(umPorClinica(r)).toEqual(r)
      }),
    )
  })

  it('uma clínica em 1, 2 e 3 grupos conta igual a cada uma em 1 grupo', () => {
    const base = [
      { clinica_id: 'x', conta_na_receita: true, m: 100n },
      { clinica_id: 'y', conta_na_receita: true, m: 200n },
      { clinica_id: 'z', conta_na_receita: true, m: 300n },
    ]
    const varios = [
      ...base,
      { clinica_id: 'y', conta_na_receita: false, m: 999n },
      { clinica_id: 'z', conta_na_receita: false, m: 888n },
      { clinica_id: 'z', conta_na_receita: false, m: 777n },
    ]
    const soma = (ls: typeof base) => umPorClinica(ls).filter((l) => l.conta_na_receita).reduce((s, l) => s + l.m, 0n)
    expect(umPorClinica(varios)).toHaveLength(3)
    expect(soma(varios)).toBe(soma(base))
  })
})

describe('umaPorCampanhaEMes', () => {
  const l = (origem: string | null, mes: string, conta: boolean, id: string) => ({
    id,
    campanha_origem_id: origem,
    mes,
    dono_conta_na_receita: conta,
  })
  it('a mesma campanha e mês em dois clientes entra uma vez, a do pagador', () => {
    const r = umaPorCampanhaEMes([l('k', '2026-11-01', false, 'q'), l('k', '2026-11-01', true, 'p'), l('k', '2026-10-01', false, 'q2')])
    expect(r.map((x) => x.id).sort()).toEqual(['p', 'q2'])
  })
  it('manual não deduplica', () => {
    expect(umaPorCampanhaEMes([l(null, '2026-11-01', false, 'a'), l(null, '2026-11-01', false, 'b')])).toHaveLength(2)
  })
})
