import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { fimDoMes } from './relogio'
import { retornoDe, type RegraDeRetorno } from './retorno'

const regra = (quantidade: number, unidade: 'd' | 'm', antecedenciaDias = 15): RegraDeRetorno => ({
  quantidade,
  unidade,
  antecedenciaDias,
})

const H = '2026-10-25'

describe('retornoDe — e o dia 31 que vira 28', () => {
  it('toxina botulínica: repetir a cada 4 meses, contato 15 dias antes', () => {
    // O exemplo do MANUAL cap. 8, "Fim do programa e contato de retorno".
    // MEDIDO no protótipo: `retornoDe({retorno:4, retornoUnid:'m',
    // antecedencia:15}, '2026-10-25')` → `{pode:'2027-02-25', prazo:'2027-02-10'}`.
    expect(retornoDe(regra(4, 'm'), '2026-10-25', H)).toEqual({
      podeEm: '2027-02-25',
      prazo: '2027-02-10',
    })
  })

  it('O DIA 31 CAI NO ÚLTIMO DIA DO MÊS CURTO — regra 25', () => {
    expect(retornoDe(regra(1, 'm', 0), '2026-01-31', H)!.podeEm).toBe('2026-02-28')
    expect(retornoDe(regra(1, 'm', 0), '2028-01-29', H)!.podeEm).toBe('2028-02-29')
    expect(retornoDe(regra(1, 'm', 0), '2026-03-31', H)!.podeEm).toBe('2026-04-30')
  })

  it('em dias, não em meses, quando a unidade é `d`', () => {
    expect(retornoDe(regra(90, 'd', 0), '2026-10-25', H)!.podeEm).toBe('2027-01-23')
  })

  it('O PRAZO NUNCA NASCE NO PASSADO: cai no hoje DA CLÍNICA', () => {
    // Última sessão há 8 meses, retorno de 4 meses: o contato já venceu. Sem o
    // clamp, o cartão nasceria "atrasado há cinco meses" no dia em que foi
    // criado. MEDIDO no protótipo (`if (prazo < today()) prazo = today()`).
    const r = retornoDe(regra(4, 'm'), '2026-02-25', '2026-10-25')!
    expect(r.podeEm).toBe('2026-06-25')
    expect(r.prazo).toBe('2026-10-25') // hoje, não 2026-06-10
  })

  it('o `hoje` é o DA CLÍNICA, do servidor — não um relógio global', () => {
    // O protótipo usa `today()` do navegador (regra 24). Aqui o dia entra como
    // argumento, e dois fusos no mesmo instante dão respostas diferentes.
    const r1 = retornoDe(regra(4, 'm'), '2026-02-25', '2026-10-24')!
    const r2 = retornoDe(regra(4, 'm'), '2026-02-25', '2026-10-25')!
    expect(r1.prazo).toBe('2026-10-24')
    expect(r2.prazo).toBe('2026-10-25')
  })

  it('sem regra de retorno, não há contato', () => {
    expect(retornoDe(null, '2026-10-25', H)).toBeNull()
  })

  it('antecedência zero põe o contato no próprio dia em que já pode repetir', () => {
    expect(retornoDe(regra(6, 'm', 0), '2026-10-25', H)!.prazo).toBe('2027-04-25')
  })

  it('a antecedência NÃO muda `podeEm` — ela é só o aviso', () => {
    const a = retornoDe(regra(6, 'm', 0), '2026-10-25', H)!
    const b = retornoDe(regra(6, 'm', 90), '2026-10-25', H)!
    expect(a.podeEm).toBe(b.podeEm)
    expect(b.prazo).toBe('2027-01-25')
  })
})

// -- PROPRIEDADES ----------------------------------------------------------

const gDia = fc
  .date({ min: new Date('2020-01-01'), max: new Date('2032-12-31'), noInvalidDate: true })
  .map((d) => d.toISOString().slice(0, 10))

const gRegra = fc.record({
  quantidade: fc.integer({ min: 1, max: 60 }),
  unidade: fc.constantFrom('d' as const, 'm' as const),
  antecedenciaDias: fc.integer({ min: 0, max: 90 }),
})

describe('as propriedades do contato de retorno', () => {
  it('em meses: `podeEm` tem o dia original OU é o último dia do mês', () => {
    fc.assert(
      fc.property(
        gDia,
        fc.integer({ min: 1, max: 60 }),
        fc.integer({ min: 0, max: 90 }),
        gDia,
        (base, meses, ant, hoje) => {
          const r = retornoDe(regra(meses, 'm', ant), base, hoje)!
          const d = Number(r.podeEm.slice(8, 10))
          expect(d === Number(base.slice(8, 10)) || r.podeEm === fimDoMes(r.podeEm.slice(0, 7))).toBe(
            true,
          )
        },
      ),
    )
  })

  it('A FRONTEIRA CONSTRUÍDA: todo mês curto, a partir de todo dia 29/30/31', () => {
    // Gerador uniforme não acha fronteira: dias 29, 30 e 31 são 3 de 31, e
    // fevereiro é 1 de 12. Aqui o caso é CONSTRUÍDO — a base é sempre um dia
    // longo, e o alvo é sempre um mês mais curto.
    fc.assert(
      fc.property(
        fc.integer({ min: 2024, max: 2036 }),
        fc.constantFrom(1, 3, 5, 7, 8, 10, 12),
        fc.constantFrom(29, 30, 31),
        fc.integer({ min: 1, max: 24 }),
        (ano, mes, dia, meses) => {
          const dois = (n: number) => String(n).padStart(2, '0')
          const base = `${ano}-${dois(mes)}-${dois(dia)}`
          const r = retornoDe(regra(meses, 'm', 0), base, '2020-01-01')!
          const ultimoDoAlvo = fimDoMes(r.podeEm.slice(0, 7))
          // Ou o dia original sobreviveu, ou foi grampeado no último do mês —
          // nunca transbordou para o mês seguinte.
          expect(r.podeEm <= ultimoDoAlvo).toBe(true)
          expect(Number(r.podeEm.slice(8, 10))).toBe(
            Math.min(dia, Number(ultimoDoAlvo.slice(8, 10))),
          )
        },
      ),
      { numRuns: 1500 },
    )
  })

  it('o prazo nunca passa de `podeEm` e nunca é antes de hoje', () => {
    fc.assert(
      fc.property(gDia, gRegra, gDia, (b, g, h) => {
        const r = retornoDe(g, b, h)
        if (r === null) return
        expect(r.prazo <= r.podeEm || r.prazo === h).toBe(true)
        expect(r.prazo >= h).toBe(true)
      }),
    )
  })

  it('`podeEm` é sempre DEPOIS da última sessão — o retorno não é retroativo', () => {
    fc.assert(
      fc.property(gDia, gRegra, gDia, (b, g, h) => {
        const r = retornoDe(g, b, h)
        if (r === null) return
        expect(r.podeEm > b).toBe(true)
      }),
    )
  })
})
