import { describe, expect, it } from 'vitest'
import { milesimosDoTexto, textoDeMilesimos } from './quantidade'

/**
 * O campo de quantidade do balcão.
 *
 * A LEITURA é do domínio (`Quantidade.deTexto`, com property-based test lá) —
 * o que este arquivo mede é a única diferença de contrato que a tela
 * introduz: **campo vazio é `null`, não zero**. Zero é uma informação (a
 * prateleira vazia), e confundir os dois faria a contagem em branco virar
 * "contei e não achei nada".
 */
describe('milesimosDoTexto', () => {
  it('delega ao domínio: inteiro, vírgula, ponto e milhar', () => {
    expect(milesimosDoTexto('2')).toBe(2_000n)
    expect(milesimosDoTexto('2,5')).toBe(2_500n)
    expect(milesimosDoTexto('2.5')).toBe(2_500n)
    expect(milesimosDoTexto('0,25')).toBe(250n)
    expect(milesimosDoTexto('1.250,5')).toBe(1_250_500n)
  })

  it('VAZIO é `null`, e ZERO é zero — são coisas diferentes', () => {
    expect(milesimosDoTexto('')).toBeNull()
    expect(milesimosDoTexto('   ')).toBeNull()
    // `Quantidade.deTexto('')` devolve zero, que é o certo para o domínio; a
    // tela precisa distinguir "não informei" de "achei zero".
    expect(milesimosDoTexto('0')).toBe(0n)
  })

  it('o que não é quantidade é `null` — nunca zero em silêncio', () => {
    for (const x of ['-1', 'abc', '2,5,5', '1/2', '2,0001']) {
      expect(milesimosDoTexto(x), x).toBeNull()
    }
  })

  it('a ida e a volta pelo texto preservam o número', () => {
    for (const m of [0n, 1n, 250n, 1_000n, 2_500n, 1_250_500n]) {
      expect(milesimosDoTexto(textoDeMilesimos(m))).toBe(m)
    }
  })

  it('textoDeMilesimos não deixa zero à direita', () => {
    expect(textoDeMilesimos('2500')).toBe('2,5')
    expect(textoDeMilesimos('4000')).toBe('4')
    expect(textoDeMilesimos(null)).toBe('')
  })
})
