import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  deCompraParaMedida,
  deMedidaParaUso,
  deUsoParaMedida,
  Quantidade,
  type Fatores,
} from './quantidade.js'
import { ehErro, exigir } from './resultado.js'

// 1 caixa = 4 ampolas · 1 ampola = 5 mg
const AMPOLA: Fatores = { compraParaMedida: 4000n, medidaParaUso: 5000n }
const q = (s: string, u = 'ampola') => exigir(Quantidade.deTexto(s, u))

describe('Quantidade — leitura', () => {
  it('guarda milésimos da medida', () => {
    expect(q('1').milesimos).toBe(1000n)
    expect(q('0,25').milesimos).toBe(250n)
    expect(q('2,5').milesimos).toBe(2500n)
    expect(q('').milesimos).toBe(0n)
  })

  it('recusa mais de três casas e valor negativo', () => {
    expect(ehErro(Quantidade.deTexto('1,2345', 'ampola'))).toBe(true)
    expect(ehErro(Quantidade.deTexto('-1', 'ampola'))).toBe(true)
  })

  it('formata sem zeros à direita', () => {
    expect(q('1').formatar()).toBe('1 ampola')
    expect(q('0,25').formatar()).toBe('0,25 ampola')
    expect(q('2,5').formatar()).toBe('2,5 ampola')
  })
})

describe('Quantidade — aritmética', () => {
  it('soma quantidades da mesma unidade', () => {
    expect(exigir(q('1').mais(q('0,5'))).milesimos).toBe(1500n)
  })

  it('somar unidades diferentes é erro, não conversão silenciosa', () => {
    const r = q('1', 'ampola').mais(q('1', 'mg'))
    expect(ehErro(r)).toBe(true)
    if (ehErro(r)) expect(r.erro.codigo).toBe('UnidadesIncompativeis')
  })
})

describe('Quantidade — conversão', () => {
  it('1 caixa vira 4 ampolas', () => {
    expect(exigir(deCompraParaMedida(q('1', 'caixa'), AMPOLA, 'ampola')).milesimos).toBe(4000n)
  })

  it('1 ampola vira 5 mg', () => {
    expect(exigir(deMedidaParaUso(q('1'), AMPOLA, 'mg')).milesimos).toBe(5000n)
  })

  it('2,5 mg vira meia ampola', () => {
    expect(exigir(deUsoParaMedida(q('2,5', 'mg'), AMPOLA, 'ampola')).milesimos).toBe(500n)
  })

  it('conversão inexata é recusada, não arredondada', () => {
    // 1 mg com 1 ampola = 3 mg: 1/3 de ampola não é representável em milésimos.
    const tres: Fatores = { compraParaMedida: 1000n, medidaParaUso: 3000n }
    const r = deUsoParaMedida(q('1', 'mg'), tres, 'ampola')
    expect(ehErro(r)).toBe(true)
    if (ehErro(r)) expect(r.erro.codigo).toBe('ConversaoInexata')
  })

  it('converter ida e volta devolve exatamente o original', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 1_000_000n }),
        fc.integer({ min: 1, max: 100 }),
        (mil, fator) => {
          const f: Fatores = { compraParaMedida: 1000n, medidaParaUso: BigInt(fator) * 1000n }
          const medida = Quantidade.deMilesimos(mil, 'ampola')
          const uso = deMedidaParaUso(medida, f, 'mg')
          if (uso.tipo === 'erro') return
          const volta = deUsoParaMedida(uso.valor, f, 'ampola')
          expect(exigir(volta).milesimos).toBe(mil)
        },
      ),
    )
  })
})
