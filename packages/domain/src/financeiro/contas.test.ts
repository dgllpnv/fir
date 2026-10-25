import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { fimDoMes } from '../relogio'
import {
  CATEGORIAS_DESP,
  ehCategoriaDeDespesa,
  FORMAS_DE_SAIDA,
  infoDaCategoria,
  proximoVencimento,
} from './contas'

describe('proximoVencimento — a âncora do dia 31', () => {
  it('a conta do dia 31 volta ao dia 31 depois do mês curto', () => {
    expect(proximoVencimento('2026-12-31', 31)).toBe('2027-01-31')
    expect(proximoVencimento('2027-01-31', 31)).toBe('2027-02-28')
    expect(proximoVencimento('2027-02-28', 31)).toBe('2027-03-31') // ← o defeito do protótipo
  })

  it('dia 29 em ano bissexto pega o 29 de fevereiro', () => {
    expect(proximoVencimento('2028-01-29', 29)).toBe('2028-02-29')
  })

  it('dia 29 em ano COMUM cai no 28, e volta ao 29 no mês seguinte', () => {
    expect(proximoVencimento('2027-01-29', 29)).toBe('2027-02-28')
    expect(proximoVencimento('2027-02-28', 29)).toBe('2027-03-29')
  })

  it('a conta do dia 10 vence no dia 10, e a virada de ano não a move', () => {
    expect(proximoVencimento('2026-12-10', 10)).toBe('2027-01-10')
  })

  it('âncora fora de 1–31 é defeito, não um vencimento esquisito', () => {
    expect(() => proximoVencimento('2026-12-31', 0)).toThrow()
    expect(() => proximoVencimento('2026-12-31', 32)).toThrow()
    expect(() => proximoVencimento('2026-12-31', 1.5)).toThrow()
  })
})

describe('as categorias e as formas', () => {
  it('as dez categorias, e só elas, com fixas e variáveis fechando a lista', () => {
    expect(CATEGORIAS_DESP).toHaveLength(10)
    expect(CATEGORIAS_DESP.filter((c) => c.tipo === 'fixa').map((c) => c.nome)).toEqual([
      'Pessoal',
      'Ocupação',
      'Sistemas e assinaturas',
      'Serviços contratados',
    ])
    expect(CATEGORIAS_DESP.at(-1)!.nome).toBe('Outras despesas') // o fallback é o último
  })

  it('toda categoria tem descrição — é ela que a tela mostra embaixo do campo', () => {
    for (const c of CATEGORIAS_DESP) expect(c.desc.length).toBeGreaterThan(0)
  })

  it('fixas mais variáveis são as dez: nenhuma categoria fica sem tipo', () => {
    const fixas = CATEGORIAS_DESP.filter((c) => c.tipo === 'fixa').length
    const variaveis = CATEGORIAS_DESP.filter((c) => c.tipo === 'variavel').length
    expect(fixas + variaveis).toBe(CATEGORIAS_DESP.length)
  })

  it('`infoDaCategoria` conhece as dez e não inventa a décima primeira', () => {
    expect(infoDaCategoria('Marketing')!.tipo).toBe('variavel')
    expect(infoDaCategoria('Cerveja')).toBeUndefined()
    expect(ehCategoriaDeDespesa('Cerveja')).toBe(false)
    expect(ehCategoriaDeDespesa('Pessoal')).toBe(true)
  })

  it('as formas de SAÍDA não são as de entrada', () => {
    // Conta a pagar é Boleto, Transferência e Débito automático; recebimento é
    // Pix, cartões e promissória. Misturar as duas listas é o começo de uma
    // Visão do mês que soma maçã com laranja.
    expect(FORMAS_DE_SAIDA).toContain('Boleto')
    expect(FORMAS_DE_SAIDA).not.toContain('Nota promissória')
    expect(FORMAS_DE_SAIDA).not.toContain('Cartão de débito')
  })
})

describe('proximoVencimento — propriedades', () => {
  it('iterar N meses a partir da âncora dá o dia da âncora OU o último dia do mês, sempre', () => {
    fc.assert(
      fc.property(
        fc.date({ min: new Date('2024-01-01'), max: new Date('2035-12-31'), noInvalidDate: true }),
        fc.integer({ min: 1, max: 31 }),
        fc.integer({ min: 1, max: 48 }),
        (d, ancora, n) => {
          let v = `${d.toISOString().slice(0, 8)}${String(Math.min(ancora, 28)).padStart(2, '0')}`
          for (let i = 0; i < n; i++) {
            v = proximoVencimento(v, ancora)
            const dia = Number(v.slice(8, 10))
            expect(dia === ancora || v === fimDoMes(v.slice(0, 7))).toBe(true)
            // Nunca ULTRAPASSA a âncora. É esta que pega a correção errada:
            // "subir para o dia 1 do mês seguinte quando o dia não existe"
            // passa na primeira e faz a conta de 31/01 vencer em 01/03.
            expect(dia).toBeLessThanOrEqual(ancora)
          }
        },
      ),
    )
  })

  it('o próximo vencimento está SEMPRE no mês seguinte — nunca pula nem repete um mês', () => {
    fc.assert(
      fc.property(
        fc.date({ min: new Date('2024-01-01'), max: new Date('2035-12-31'), noInvalidDate: true }),
        fc.integer({ min: 1, max: 31 }),
        (d, ancora) => {
          const v = `${d.toISOString().slice(0, 8)}${String(Math.min(ancora, 28)).padStart(2, '0')}`
          const p = proximoVencimento(v, ancora)
          const mes = (s: string) => Number(s.slice(0, 4)) * 12 + Number(s.slice(5, 7))
          expect(mes(p) - mes(v)).toBe(1)
        },
      ),
    )
  })
})
