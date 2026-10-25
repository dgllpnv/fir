import { formatarDinheiro } from '@fir/ui'
import { describe, expect, it } from 'vitest'
import { centavosDoTexto, textoDeCentavos } from './dinheiro-digitado'

describe('o que a recepção digita vira centavos inteiros', () => {
  it('lê as três formas que o balcão produz', () => {
    expect(centavosDoTexto('450,00')).toBe(45000n)
    expect(centavosDoTexto('1.234,56')).toBe(123456n)
    expect(centavosDoTexto('450')).toBe(45000n)
    expect(centavosDoTexto('450.00')).toBe(45000n)
    expect(centavosDoTexto(' 19,99 ')).toBe(1999n)
  })

  it('NÃO perde o centavo onde o ponto flutuante perderia', () => {
    // `19.99 * 100` é 1998.9999999999998 em JavaScript. Esta é a assinatura
    // que a regra 1 do CLAUDE.md barra, e o lugar mais provável de ela voltar
    // é um campo de valor numa tela.
    expect(centavosDoTexto('19,99')).toBe(1999n)
    expect(centavosDoTexto('0,07')).toBe(7n)
    expect(centavosDoTexto('1.000.000,01')).toBe(100000001n)
  })

  it('recusa o que não é valor, em vez de converter em silêncio', () => {
    for (const ruim of ['', 'abc', '1,234', '1,2,3', '-50', '1..2', ',50', 'R$ 450']) {
      expect(centavosDoTexto(ruim), ruim).toBeNull()
    }
  })

  it('o texto volta a ser o mesmo valor — ida e volta sem perda', () => {
    for (const centavos of [0n, 7n, 1999n, 45000n, 123456n, 90071992547409919n]) {
      expect(centavosDoTexto(textoDeCentavos(centavos))).toBe(centavos)
    }
  })

  it('o que foi digitado aqui é o que o formatador central mostra', () => {
    // A ponta a ponta do dinheiro na tela: digitado → centavos → formatado.
    expect(formatarDinheiro(centavosDoTexto('1.234,56'))).toBe('R$ 1.234,56')
    expect(formatarDinheiro(centavosDoTexto('0,07'))).toBe('R$ 0,07')
  })
})
