import { describe, expect, it } from 'vitest'
import { ehErro, ehOk, erro, erroDe, exigir, ok } from './resultado.js'
import type { Result } from './resultado.js'

describe('Resultado', () => {
  it('ok carrega o valor e é reconhecido como ok', () => {
    const r = ok(42)
    expect(ehOk(r)).toBe(true)
    expect(ehErro(r)).toBe(false)
    if (ehOk(r)) expect(r.valor).toBe(42)
  })

  it('erro carrega o erro e é reconhecido como erro', () => {
    const r = erro(erroDe('ValorInvalido', 'valor negativo'))
    expect(ehErro(r)).toBe(true)
    if (ehErro(r)) expect(r.erro.codigo).toBe('ValorInvalido')
  })
})

describe('estreitamento de tipo', () => {
  // Estes testes existem pelo TIPO, não pelo valor: se o estreitamento
  // negativo parar de funcionar, o typecheck quebra antes de o teste rodar.
  // Foi exatamente esse defeito que a primeira versão dos guards tinha.
  it('ehErro estreita no ramo negativo (guard clause com early return)', () => {
    const usar = (r: Result<number>): number => {
      if (ehErro(r)) return -1
      return r.valor // só compila se o membro de erro foi eliminado aqui
    }
    expect(usar(ok(7))).toBe(7)
    expect(usar(erro(erroDe('X', 'x')))).toBe(-1)
  })

  it('ehOk estreita no ramo negativo', () => {
    const codigo = (r: Result<number>): string => {
      if (ehOk(r)) return 'ok'
      return r.erro.codigo // só compila se o membro ok foi eliminado aqui
    }
    expect(codigo(ok(1))).toBe('ok')
    expect(codigo(erro(erroDe('ValorInvalido', 'x')))).toBe('ValorInvalido')
  })

  it('exigir devolve o valor e lança no erro', () => {
    expect(exigir(ok('tudo bem'))).toBe('tudo bem')
    expect(() => exigir(erro(erroDe('Falhou', 'detalhe')))).toThrow('Falhou: detalhe')
  })
})
