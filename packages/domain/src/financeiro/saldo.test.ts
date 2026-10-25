import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { Dinheiro } from '../dinheiro'
import { saldoEmAberto, type EventoDeSaldo } from './saldo'

const c = (n: number) => Dinheiro.deCentavos(BigInt(n))
const ZERO = Dinheiro.zero()
const ev = (programaId: string | null, aberto: Dinheiro, abatido: Dinheiro): EventoDeSaldo => ({
  programaId,
  aberto,
  abatido,
})

describe('saldoEmAberto — derivado, agrupado, e o crédito que não se descarta', () => {
  it('saldo é aberto − abatido, dentro do grupo', () => {
    const r = saldoEmAberto([ev(null, c(300000), ZERO), ev(null, ZERO, c(100000))])
    expect(r.total.centavos).toBe(200000n)
    expect(r.grupos).toHaveLength(1)
  })

  it('o pago no programa abate o programa, NÃO o geral', () => {
    // É a falha que faz a clínica parar de cobrar uma dívida que existe.
    const r = saldoEmAberto([
      ev(null, c(100000), ZERO), // R$ 1.000 solto
      ev('prog-a', c(300000), ZERO), // R$ 3.000 do programa A
      ev('prog-a', ZERO, c(300000)), // pagou o programa A inteiro
    ])
    expect(r.total.centavos).toBe(100000n)
    expect(r.grupos.find((g) => g.programaId === 'prog-a')!.saldo.ehZero()).toBe(true)
    expect(r.grupos.find((g) => g.programaId === null)!.saldo.centavos).toBe(100000n)
  })

  it('grupo pago a mais NÃO abate outro grupo — e o excedente vira `credito`', () => {
    const r = saldoEmAberto([
      ev('prog-a', c(100000), c(150000)), // pagou R$ 500 a mais
      ev(null, c(80000), ZERO),
    ])
    expect(r.total.centavos).toBe(80000n) // o geral intacto
    expect(r.credito.centavos).toBe(50000n) // e o excedente VISÍVEL
    expect(r.grupos.find((g) => g.programaId === 'prog-a')!.saldo.ehZero()).toBe(true)
  })

  it('`temSaldo` sobrevive à redação — é ele que a equipe sem `valores` recebe', () => {
    expect(saldoEmAberto([ev(null, c(1), ZERO)]).temSaldo).toBe(true)
    expect(saldoEmAberto([]).temSaldo).toBe(false)
    expect(saldoEmAberto([ev(null, c(100), c(100))]).temSaldo).toBe(false)
  })

  it('a ordem dos grupos é determinística: geral primeiro, depois por id', () => {
    const a = saldoEmAberto([ev('z', c(1), ZERO), ev(null, c(1), ZERO), ev('a', c(1), ZERO)])
    expect(a.grupos.map((g) => g.programaId)).toEqual([null, 'a', 'z'])
  })

  it('o grupo guarda `aberto` e `abatido` brutos — é o que a cobrança lê na conversa', () => {
    const r = saldoEmAberto([ev('prog-a', c(300000), c(120000))])
    const g = r.grupos[0]!
    expect(g.aberto.centavos).toBe(300000n)
    expect(g.abatido.centavos).toBe(120000n)
    expect(g.saldo.centavos).toBe(180000n)
    expect(g.credito.ehZero()).toBe(true)
  })

  it('um grupo pago a mais e outro devendo convivem — nenhum compensa o outro', () => {
    const r = saldoEmAberto([
      ev('prog-a', c(100000), c(160000)), // R$ 600 a mais
      ev('prog-b', c(250000), ZERO),
    ])
    expect(r.total.centavos).toBe(250000n)
    expect(r.credito.centavos).toBe(60000n)
  })

  it('paciente sem evento nenhum tem zero grupos, zero total e zero crédito', () => {
    const r = saldoEmAberto([])
    expect(r.grupos).toEqual([])
    expect(r.total.ehZero()).toBe(true)
    expect(r.credito.ehZero()).toBe(true)
  })
})

const dinheiro = fc.bigInt({ min: 0n, max: 10_000_000n }).map((n) => Dinheiro.deCentavos(n))
const evento = fc.record({
  programaId: fc.option(fc.constantFrom('a', 'b', 'c'), { nil: null }),
  aberto: dinheiro,
  abatido: dinheiro,
})

describe('saldoEmAberto — propriedades', () => {
  it('o total é exatamente a soma dos saldos dos grupos', () => {
    fc.assert(
      fc.property(fc.array(evento, { maxLength: 60 }), (es) => {
        const r = saldoEmAberto(es)
        const soma = r.grupos.reduce((s, g) => s.mais(g.saldo), Dinheiro.zero())
        expect(soma.centavos).toBe(r.total.centavos)
      }),
    )
  })

  it('o crédito total é exatamente a soma dos créditos dos grupos', () => {
    fc.assert(
      fc.property(fc.array(evento, { maxLength: 60 }), (es) => {
        const r = saldoEmAberto(es)
        const soma = r.grupos.reduce((s, g) => s.mais(g.credito), Dinheiro.zero())
        expect(soma.centavos).toBe(r.credito.centavos)
      }),
    )
  })

  it('nenhum saldo de grupo é negativo, e o crédito explica a diferença', () => {
    fc.assert(
      fc.property(fc.array(evento, { maxLength: 60 }), (es) => {
        const r = saldoEmAberto(es)
        for (const g of r.grupos) {
          expect(g.saldo.ehNegativo()).toBe(false)
          expect(g.credito.ehNegativo()).toBe(false)
          // `saldo − credito === aberto − abatido`: o clamp não PERDE nada, ele
          // move. Sem esta propriedade, `Math.max(0, …)` passaria igual.
          expect(g.saldo.menos(g.credito).centavos).toBe(g.aberto.menos(g.abatido).centavos)
        }
      }),
    )
  })

  it('a ordem dos eventos não muda nada', () => {
    fc.assert(
      fc.property(fc.array(evento, { maxLength: 60 }), (es) => {
        const a = saldoEmAberto(es)
        const b = saldoEmAberto([...es].reverse())
        expect(b.total.centavos).toBe(a.total.centavos)
        expect(b.credito.centavos).toBe(a.credito.centavos)
        expect(b.grupos.map((g) => [g.programaId, g.saldo.centavos])).toEqual(
          a.grupos.map((g) => [g.programaId, g.saldo.centavos]),
        )
      }),
    )
  })

  it('`temSaldo` é verdadeiro se e somente se o total é maior que zero', () => {
    fc.assert(
      fc.property(fc.array(evento, { maxLength: 60 }), (es) => {
        const r = saldoEmAberto(es)
        expect(r.temSaldo).toBe(r.total.centavos > 0n)
      }),
    )
  })

  it('há no máximo um grupo por programa, e o geral aparece no máximo uma vez', () => {
    fc.assert(
      fc.property(fc.array(evento, { maxLength: 60 }), (es) => {
        const r = saldoEmAberto(es)
        const ids = r.grupos.map((g) => g.programaId)
        expect(new Set(ids).size).toBe(ids.length)
      }),
    )
  })
})
