import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { Dinheiro } from '../dinheiro'
import { ehErro } from '../resultado'
import { podeDesfazerPagamento, proximoVencimento, vencimentoDaRenovacao } from './contas'

describe('vencimentoDaRenovacao — a série não ganha duas contas à frente', () => {
  it('sem conta posterior, renova pela âncora', () => {
    expect(vencimentoDaRenovacao('2026-12-31', 31, ['2026-12-31'])).toBe('2027-01-31')
  })

  it('com a seguinte já existente, não renova', () => {
    expect(vencimentoDaRenovacao('2026-12-31', 31, ['2026-12-31', '2027-01-31'])).toBeNull()
  })

  it('vencimento EDITADO para depois da âncora: a seguinte antiga ainda bloqueia', () => {
    // Pagou dezembro (nasceu 31/01), desfez, adiou para 05/01, pagou de novo.
    // 28/02 não colide com 31/01 no índice — é esta regra que segura.
    expect(vencimentoDaRenovacao('2027-01-05', 31, ['2027-01-05', '2027-01-31'])).toBeNull()
  })

  it('conta anterior não bloqueia — só a POSTERIOR', () => {
    expect(vencimentoDaRenovacao('2027-01-31', 31, ['2026-12-31', '2027-01-31'])).toBe('2027-02-28')
  })
})

describe('podeDesfazerPagamento', () => {
  it('conta aberta não se desfaz', () => {
    const r = podeDesfazerPagamento(null, '2026-10-24', true)
    expect(ehErro(r) && r.erro.codigo).toBe('CONTA_NAO_PAGA')
  })

  it('pagamento do mês corrente desfaz sem confirmação', () => {
    expect(podeDesfazerPagamento('2026-10-01', '2026-10-24', false).tipo).toBe('ok')
  })

  it('pagamento do mês anterior pede confirmação — e só ela', () => {
    const r = podeDesfazerPagamento('2026-09-30', '2026-10-01', false)
    expect(ehErro(r) && r.erro).toMatchObject({
      codigo: 'CONFIRMACAO_NECESSARIA',
      avisos: ['MES_ANTERIOR'],
    })
    expect(podeDesfazerPagamento('2026-09-30', '2026-10-01', true).tipo).toBe('ok')
  })

  it('a virada de ano também é mês anterior', () => {
    expect(podeDesfazerPagamento('2026-12-31', '2027-01-01', false).tipo).toBe('erro')
  })
})

/**
 * O MODELO de uma série sob qualquer sequência de Paguei, desfazer, excluir e
 * adiar vencimento — com as MESMAS regras do serviço (`podeDesfazerPagamento`,
 * `vencimentoDaRenovacao` e o índice `conta_da_serie_por_mes`).
 */
type Conta = {
  readonly id: number
  vencimento: string
  pago: Dinheiro | null
  excluida: boolean
  readonly origem: number | null
}

type Op =
  | { readonly t: 'pagar'; readonly i: number; readonly centavos: bigint }
  | { readonly t: 'desfazer'; readonly i: number }
  | { readonly t: 'excluir'; readonly i: number }
  | { readonly t: 'adiar'; readonly i: number; readonly dias: number }

const op: fc.Arbitrary<Op> = fc.oneof(
  fc.record({
    t: fc.constant('pagar' as const),
    i: fc.nat(20),
    centavos: fc.bigInt({ min: 1n, max: 10_000_000n }),
  }),
  fc.record({ t: fc.constant('desfazer' as const), i: fc.nat(20) }),
  fc.record({ t: fc.constant('excluir' as const), i: fc.nat(20) }),
  fc.record({ t: fc.constant('adiar' as const), i: fc.nat(20), dias: fc.integer({ min: 1, max: 20 }) }),
)

const somarDiasIso = (dia: string, n: number): string => {
  const d = new Date(`${dia}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

function simular(ops: readonly Op[], ancora: number) {
  const contas: Conta[] = [
    { id: 0, vencimento: `2026-01-${String(Math.min(ancora, 28)).padStart(2, '0')}`, pago: null, excluida: false, origem: null },
  ]
  let registrado = Dinheiro.zero()
  let desfeito = Dinheiro.zero()
  const violacoes: string[] = []

  for (const o of ops) {
    const c = contas[o.i % contas.length]!
    if (c.excluida) continue
    if (o.t === 'pagar') {
      if (c.pago !== null) continue
      const valor = Dinheiro.deCentavos(o.centavos)
      c.pago = valor
      registrado = registrado.mais(valor)
      const prox = vencimentoDaRenovacao(c.vencimento, ancora, contas.map((x) => x.vencimento))
      if (prox === null) continue
      if (contas.some((x) => x.vencimento > c.vencimento)) violacoes.push('renovou com posterior')
      // O índice parcial: duas VIVAS com o mesmo vencimento, nunca.
      if (contas.some((x) => !x.excluida && x.vencimento === prox)) continue
      contas.push({ id: contas.length, vencimento: prox, pago: null, excluida: false, origem: c.id })
    } else if (o.t === 'desfazer') {
      const r = podeDesfazerPagamento(c.pago === null ? null : c.vencimento, c.vencimento, true)
      if (r.tipo === 'erro' || c.pago === null) continue
      desfeito = desfeito.mais(c.pago)
      c.pago = null
    } else if (o.t === 'excluir') {
      // Conta paga não se exclui (`excluir` responde 409).
      if (c.pago === null) c.excluida = true
    } else {
      // "Adiar a parcela": o novo vencimento não atravessa a seguinte da série.
      const novo = somarDiasIso(c.vencimento, o.dias)
      const seguinte = contas.map((x) => x.vencimento).filter((v) => v > c.vencimento).sort()[0]
      if (seguinte === undefined || novo < seguinte) c.vencimento = novo
    }
  }
  return { contas, registrado, desfeito, violacoes }
}

describe('desfazer pagamento — propriedades', () => {
  it('Σ registrados = Σ vivos + Σ desfeitos, para qualquer sequência', () => {
    fc.assert(
      fc.property(fc.array(op, { maxLength: 60 }), fc.integer({ min: 1, max: 31 }), (ops, ancora) => {
        const { contas, registrado, desfeito } = simular(ops, ancora)
        const vivos = contas.reduce((s, x) => (x.pago === null ? s : s.mais(x.pago)), Dinheiro.zero())
        expect(registrado.centavos).toBe(vivos.mais(desfeito).centavos)
      }),
    )
  })

  it('no máximo UMA conta posterior por conta de origem — pagar de novo não renova de novo', () => {
    fc.assert(
      fc.property(fc.array(op, { maxLength: 60 }), fc.integer({ min: 1, max: 31 }), (ops, ancora) => {
        const { contas, violacoes } = simular(ops, ancora)
        expect(violacoes).toEqual([])
        const filhos = new Map<number, number>()
        for (const x of contas) {
          if (x.origem !== null) filhos.set(x.origem, (filhos.get(x.origem) ?? 0) + 1)
        }
        for (const n of filhos.values()) expect(n).toBeLessThanOrEqual(1)
        // E nunca duas vivas no mesmo vencimento.
        const vivas = contas.filter((x) => !x.excluida).map((x) => x.vencimento)
        expect(new Set(vivas).size).toBe(vivas.length)
      }),
    )
  })

  it('o modelo renova de fato: um Paguei numa série nova cria a seguinte', () => {
    const { contas } = simular([{ t: 'pagar', i: 0, centavos: 100n }], 31)
    expect(contas.map((x) => x.vencimento)).toEqual(['2026-01-28', proximoVencimento('2026-01-28', 31)])
  })
})
