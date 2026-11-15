import { describe, expect, it } from 'vitest'
import { ConsultaDeOutrasEntradas, LancarOutraEntrada, PartesAcimaDaDivida, RegistrarRecebimento } from './index'

const base = {
  requisicaoId: '5b1f6c0e-6b0e-4b8e-9b0e-0f9f3c1a2b3c',
  pacienteId: '5b1f6c0e-6b0e-4b8e-9b0e-0f9f3c1a2b3d',
  em: '2026-10-24',
  ref: 'consulta',
  valor: '50000',
}

describe('partes do pagamento no contrato', () => {
  const ok = [
    { forma: 'Pix', valor: '30000' },
    { forma: 'Dinheiro', valor: '20000' },
  ]
  it('aceita partes que somam o valor', () => {
    expect(RegistrarRecebimento.safeParse({ ...base, partes: ok }).success).toBe(true)
  })
  it('recusa soma errada, forma junto com partes, promissoria misturada e mais de 5', () => {
    expect(RegistrarRecebimento.safeParse({ ...base, partes: [ok[0]] }).success).toBe(false)
    expect(RegistrarRecebimento.safeParse({ ...base, forma: 'Pix', partes: ok }).success).toBe(false)
    expect(
      RegistrarRecebimento.safeParse({
        ...base,
        partes: [ok[0], { forma: 'Nota promissória', valor: '20000' }],
      }).success,
    ).toBe(false)
    const seis = Array.from({ length: 6 }, (_, i) => ({ forma: `F${i}`, valor: '1' }))
    expect(RegistrarRecebimento.safeParse({ ...base, valor: '6', partes: seis }).success).toBe(false)
  })
})

describe('outra entrada no contrato', () => {
  const e = {
    requisicaoId: base.requisicaoId,
    categoriaId: base.pacienteId,
    em: '2026-10-24',
    valor: '7000',
    forma: 'Pix',
  }
  it('aceita as quatro formas da gaveta e recusa promissoria e valor zero', () => {
    expect(LancarOutraEntrada.safeParse(e).success).toBe(true)
    expect(LancarOutraEntrada.safeParse({ ...e, forma: 'Nota promissória' }).success).toBe(false)
    expect(LancarOutraEntrada.safeParse({ ...e, valor: '0' }).success).toBe(false)
  })
})

describe('consulta de outras entradas', () => {
  it('incluirEstornadas=false na query string é FALSE (z.coerce.boolean daria true)', () => {
    const f = ConsultaDeOutrasEntradas.parse({ incluirEstornadas: 'false' })
    expect(f.incluirEstornadas).toBe(false)
    expect(ConsultaDeOutrasEntradas.parse({ incluirEstornadas: 'true' }).incluirEstornadas).toBe(true)
    expect(ConsultaDeOutrasEntradas.safeParse({ incluirEstornadas: 'talvez' }).success).toBe(false)
  })
})

describe('409 PARTES_ACIMA_DA_DIVIDA', () => {
  it('com e sem `devido`; nada além disso', () => {
    const base = { statusCode: 409, codigo: 'PARTES_ACIMA_DA_DIVIDA', message: 'x' }
    expect(PartesAcimaDaDivida.safeParse(base).success).toBe(true)
    expect(PartesAcimaDaDivida.safeParse({ ...base, devido: '40000' }).success).toBe(true)
    expect(PartesAcimaDaDivida.safeParse({ ...base, partes: [] }).success).toBe(false)
  })
})
