import { gtinCanonico } from '@fir/domain'
import { describe, expect, it } from 'vitest'
import { CodigoDeBarras, EditarItemEstoque, LigarCodigoItem, SalvarItemEstoque } from './estoque'

/**
 * O CÓDIGO DE BARRAS DA CAIXA tem dois caminhos de gravação — ligar pela
 * leitura e o campo do cadastro — e um esquema só. O que este arquivo cobra é
 * que os dois caminhos NÃO divirjam: o código que um aceita o outro aceita, e
 * o que um recusa o outro recusa. A forma canônica (14 dígitos) é medida contra
 * o banco em `apps/api/src/estoque/estoque.e2e.test.ts`.
 */

const AMOSTRAS = [
  '7891234567895',
  '07891234567895',
  '12345670',
  '  7891234567895  ',
  '1234567',
  '123456789012345',
  'nao-e-numero',
  '789 1234 567895',
  '7891234567895\u001d',
]

describe('CodigoDeBarras — o mesmo esquema nos dois caminhos', () => {
  it('LigarCodigoItem e SalvarItemEstoque concordam em cada amostra', () => {
    for (const gtin of AMOSTRAS) {
      const ligar = LigarCodigoItem.safeParse({ gtin }).success
      const salvar = SalvarItemEstoque.safeParse({ nome: 'Tirzepatida 5 mg', gtin }).success
      expect({ gtin, salvar }).toEqual({ gtin, salvar: ligar })
      expect(CodigoDeBarras.safeParse(gtin).success).toBe(ligar)
    }
  })

  it('8 a 14 dígitos passam; 7 e 15 não; espaço nas pontas é aparado', () => {
    expect(CodigoDeBarras.parse('  7891234567895  ')).toBe('7891234567895')
    expect(CodigoDeBarras.safeParse('1234567').success).toBe(false)
    expect(CodigoDeBarras.safeParse('123456789012345').success).toBe(false)
  })

  it('VAZIO é "sem código" no cadastro, e nunca é um código para ligar', () => {
    expect(SalvarItemEstoque.parse({ nome: 'Seringa' }).gtin).toBe('')
    expect(SalvarItemEstoque.parse({ nome: 'Seringa', gtin: '' }).gtin).toBe('')
    expect(LigarCodigoItem.safeParse({ gtin: '' }).success).toBe(false)
  })

  it('na EDIÇÃO, ausente PRESERVA (não vira vazio) e vazio explícito TIRA', () => {
    // Se o `default('')` da criação valesse na edição, um `PATCH { nome }`
    // apagaria o código que a leitura da caixa ligou.
    expect('gtin' in EditarItemEstoque.parse({ nome: 'Outro nome' })).toBe(false)
    expect(EditarItemEstoque.parse({ gtin: '' }).gtin).toBe('')
  })
})

describe('gtinCanonico — a normalização que o servidor grava', () => {
  it('EAN-13 e GTIN-14 do mesmo produto viram o MESMO código', () => {
    expect(gtinCanonico('7891234567895')).toBe('07891234567895')
    expect(gtinCanonico('07891234567895')).toBe('07891234567895')
    expect(gtinCanonico('12345670')).toBe('00000012345670')
  })

  it('é IDEMPOTENTE: normalizar três vezes dá o que normalizar uma vez deu', () => {
    for (const gtin of AMOSTRAS.filter((g) => CodigoDeBarras.safeParse(g).success)) {
      const uma = gtinCanonico(CodigoDeBarras.parse(gtin))
      expect(gtinCanonico(gtinCanonico(gtinCanonico(uma)))).toBe(uma)
      expect(uma).toMatch(/^\d{14}$/)
    }
  })
})
