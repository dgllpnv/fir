import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { Dinheiro } from './dinheiro'
import { ratearPrograma, valorSugerido } from './rateio'

const c = (n: number | bigint) => Dinheiro.deCentavos(BigInt(n))
const somar = (ds: readonly Dinheiro[]) => ds.reduce((s, d) => s.mais(d), Dinheiro.zero())

describe('ratearPrograma — a soma que tem de fechar', () => {
  it('reparte proporcionalmente ao peso, e a soma é EXATA', () => {
    // R$ 3.600 entre Tirzepatida (12 × 300 = 3600) e Drenagem (3 × 150 = 450).
    const r = ratearPrograma(c(360000), [360000n, 45000n])
    expect(r.map((d) => d.centavos)).toEqual([320000n, 40000n])
    expect(somar(r).centavos).toBe(360000n)
  })

  it('PESOS IGUAIS É EXATAMENTE `Dinheiro.ratear` — uma regra só no sistema', () => {
    for (const [total, n] of [
      [100, 3],
      [1, 3],
      [1000001, 7],
      [0, 5],
    ] as const) {
      expect(ratearPrograma(c(total), Array<bigint>(n).fill(1n)).map((d) => d.centavos)).toEqual(
        c(total)
          .ratear(n)
          .map((d) => d.centavos),
      )
    }
  })

  it('o centavo que sobra vai para o MAIOR RESTO, e empate vai para o primeiro', () => {
    // 10 centavos entre pesos 1,1,1: 3,3,3 e sobra 1 -> [4,3,3].
    expect(ratearPrograma(c(10), [1n, 1n, 1n]).map((d) => d.centavos)).toEqual([4n, 3n, 3n])
  })

  it('MAIOR RESTO, e não arredondamento por parte', () => {
    // 100 centavos entre pesos 1, 1, 1, 1, 1, 1, 1 (7 partes): 14 cada, sobram
    // 2 -> as duas primeiras ganham um centavo.
    expect(ratearPrograma(c(100), Array<bigint>(7).fill(1n)).map((d) => d.centavos)).toEqual([
      15n,
      15n,
      14n,
      14n,
      14n,
      14n,
      14n,
    ])
  })

  it('peso zero recebe zero, e não trava o resto', () => {
    expect(ratearPrograma(c(1000), [1n, 0n, 1n]).map((d) => d.centavos)).toEqual([500n, 0n, 500n])
  })

  it('peso zero NÃO recebe o centavo que sobra, mesmo com o resto empatado', () => {
    expect(ratearPrograma(c(1), [1n, 0n, 1n]).map((d) => d.centavos)).toEqual([1n, 0n, 0n])
  })

  it('todos os pesos zero cai no rateio IGUAL — o programa sem valores de referência', () => {
    expect(ratearPrograma(c(1000), [0n, 0n]).map((d) => d.centavos)).toEqual([500n, 500n])
    expect(ratearPrograma(c(10), [0n, 0n, 0n]).map((d) => d.centavos)).toEqual([4n, 3n, 3n])
  })

  it('uma parte só leva tudo', () => {
    expect(ratearPrograma(c(360001), [7n]).map((d) => d.centavos)).toEqual([360001n])
  })

  it('total zero devolve zeros, não erro', () => {
    expect(ratearPrograma(c(0), [3n, 1n]).map((d) => d.centavos)).toEqual([0n, 0n])
  })

  it('O CONTRAEXEMPLO DO PONTO FLUTUANTE: R$ 4.788.145.816,69 entre dois pesos', () => {
    // Congelado por BUSCA, não escolhido a dedo — e é a lição do épico 4
    // aplicada: gerador uniforme não acha fronteira. Aqui o total é múltiplo
    // exato da soma dos pesos, então o quociente é inteiro e NÃO há sobra a
    // distribuir. `Number(bruto) * Number(peso)` passa de 2^53, o produto
    // arredonda para baixo, e `Math.floor` do quociente entrega um centavo a
    // menos — que a distribuição de sobra devolveria à parte ERRADA.
    const pesos = [821738243n, 998849520n]
    const r = ratearPrograma(c(478814581669n), pesos)
    expect(r.map((d) => d.centavos)).toEqual([216117157909n, 262697423760n])
    expect(somar(r).centavos).toBe(478814581669n)
  })

  it('lista de pesos vazia lança — rateio sem parte não é rateio', () => {
    expect(() => ratearPrograma(c(100), [])).toThrow()
  })

  it('peso negativo lança — não existe item de preço negativo', () => {
    expect(() => ratearPrograma(c(100), [1n, -1n])).toThrow()
  })
})

describe('valorSugerido', () => {
  it('é valor por sessão × sessões, somado', () => {
    expect(
      valorSugerido([
        { valorPorSessao: c(30000), sessoes: 12 },
        { valorPorSessao: c(15000), sessoes: 3 },
      ])!.centavos,
    ).toBe(405000n)
  })

  it('é null quando NENHUM item tem valor de referência', () => {
    expect(valorSugerido([{ valorPorSessao: null, sessoes: 4 }])).toBeNull()
    expect(valorSugerido([])).toBeNull()
  })

  it('o item sem valor de referência contribui ZERO, e não anula a sugestão', () => {
    // A sugestão é um ponto de partida na tela, não um preço. Devolver `null`
    // porque UM item do catálogo está sem preço esconderia a conta inteira.
    expect(
      valorSugerido([
        { valorPorSessao: c(30000), sessoes: 12 },
        { valorPorSessao: null, sessoes: 3 },
      ])!.centavos,
    ).toBe(360000n)
  })
})

describe('Dinheiro.vezes', () => {
  it('não passa por Number em ponto nenhum', () => {
    expect(c(9007199254740993n).vezes(3n).centavos).toBe(27021597764222979n)
  })

  it('multiplicar por zero é zero, e por um é o mesmo', () => {
    expect(c(12345).vezes(0n).ehZero()).toBe(true)
    expect(c(12345).vezes(1n).centavos).toBe(12345n)
  })
})

// -- PROPRIEDADES ----------------------------------------------------------
//
// Obrigatórias aqui (CLAUDE.md §7), e a da soma SOZINHA não basta: ela não
// distingue maior-resto de "todo o resto na primeira parte".

const gTotal = fc.bigInt({ min: 0n, max: 10n ** 12n }).map((n) => Dinheiro.deCentavos(n))
const gPesos = fc.array(fc.bigInt({ min: 0n, max: 10n ** 9n }), { minLength: 1, maxLength: 12 })

describe('as propriedades do rateio', () => {
  it('a soma das partes é EXATAMENTE o total', () => {
    fc.assert(
      fc.property(gTotal, gPesos, (total, pesos) => {
        expect(somar(ratearPrograma(total, pesos)).centavos).toBe(total.centavos)
      }),
    )
  })

  it('nenhuma parte é negativa, e há uma parte por peso', () => {
    fc.assert(
      fc.property(gTotal, gPesos, (total, pesos) => {
        const r = ratearPrograma(total, pesos)
        expect(r).toHaveLength(pesos.length)
        expect(r.every((d) => !d.ehNegativo())).toBe(true)
      }),
    )
  })

  it('PESOS IGUAIS => IDÊNTICO A `ratear`, para qualquer total e qualquer n', () => {
    // Esta é a propriedade que impede DUAS regras de rateio de dinheiro no
    // sistema. Com ela, `max − min <= 1` e a distribuição do resto nas
    // primeiras partes vêm de graça, herdadas de `ratear`.
    //
    // `n` varre até 30 de propósito: com 3 partes, "maior resto" e "todo o
    // resto na primeira" produzem o MESMO resultado — que é justamente o caso
    // com que todo mundo confere.
    fc.assert(
      fc.property(gTotal, fc.integer({ min: 1, max: 30 }), fc.bigInt({ min: 1n, max: 10n ** 6n }), (total, n, peso) => {
        expect(ratearPrograma(total, Array<bigint>(n).fill(peso)).map((d) => d.centavos)).toEqual(
          total.ratear(n).map((d) => d.centavos),
        )
      }),
    )
  })

  it('MONOTONIA: peso maior nunca recebe parte menor', () => {
    // Sem esta, um arredondamento "para o mais próximo" por parte deixa o item
    // de R$ 450 receber mais que o de R$ 3.600, e a decomposição fica absurda
    // na tela sem que a soma acuse nada.
    fc.assert(
      fc.property(gTotal, gPesos, (total, pesos) => {
        const r = ratearPrograma(total, pesos)
        for (let i = 0; i < pesos.length; i++) {
          for (let j = 0; j < pesos.length; j++) {
            if (pesos[i]! > pesos[j]!) expect(r[i]!.centavos >= r[j]!.centavos).toBe(true)
          }
        }
      }),
    )
  })

  it('A FRONTEIRA CONSTRUÍDA: com resto garantido, a diferença entre partes é no máximo um centavo', () => {
    // Gerador uniforme não acha fronteira (lição medida no épico 4). Aqui o
    // total é CONSTRUÍDO como `base * n + resto` com `0 < resto < n`, de modo
    // que sempre haja exatamente `resto` centavos para distribuir.
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 30 }),
        fc.bigInt({ min: 0n, max: 10n ** 9n }),
        fc.integer({ min: 1, max: 29 }),
        (n, base, r0) => {
          const resto = BigInt((r0 % (n - 1)) + 1)
          const total = Dinheiro.deCentavos(base * BigInt(n) + resto)
          const partes = ratearPrograma(total, Array<bigint>(n).fill(5n)).map((d) => d.centavos)
          expect(partes.reduce((s, x) => s + x, 0n)).toBe(total.centavos)
          const max = partes.reduce((a, b) => (a > b ? a : b))
          const min = partes.reduce((a, b) => (a < b ? a : b))
          expect(max - min <= 1n).toBe(true)
          // E o resto vai nas PRIMEIRAS: as `resto` primeiras são as maiores.
          for (let i = 0; i < n; i++) {
            expect(partes[i]).toBe(BigInt(i) < resto ? base + 1n : base)
          }
        },
      ),
    )
  })

  it('TOTAL MÚLTIPLO DA SOMA DOS PESOS: cada parte é EXATAMENTE k × peso, sem sobra', () => {
    // A fronteira CONSTRUÍDA que mata o piso em ponto flutuante.
    //
    // Com `total = k × Σpesos`, o quociente `total × peso / Σpesos` é inteiro:
    // não existe resto, não existe sobra, e cada parte tem de ser `k × peso`,
    // exatamente. O piso em `Number` erra por um centavo quando o produto
    // passa de 2^53 — e a propriedade da soma sozinha NÃO pega isso, porque a
    // distribuição de sobra "conserta" o total pondo o centavo na parte errada.
    //
    // Os limites dos geradores põem `bruto × peso` acima de 2^53 de propósito.
    fc.assert(
      fc.property(
        fc.bigInt({ min: 1n, max: 10n ** 9n }),
        fc.bigInt({ min: 1n, max: 10n ** 9n }),
        fc.bigInt({ min: 1n, max: 10n ** 4n }),
        (p1, p2, k) => {
          const pesos = [p1, p2]
          const total = Dinheiro.deCentavos(k * (p1 + p2))
          expect(ratearPrograma(total, pesos).map((d) => d.centavos)).toEqual([k * p1, k * p2])
        },
      ),
      { numRuns: 2000 },
    )
  })

  it('PESOS PROPORCIONAIS: dobrar todos os pesos não muda o rateio', () => {
    // O que importa é a razão. Uma implementação que dividisse por um total de
    // pesos arredondado produziria resultados diferentes para `[1,2]` e
    // `[2,4]`, e a decomposição mudaria ao editar um preço de referência que
    // nem entrou no negociado.
    fc.assert(
      fc.property(gTotal, gPesos, fc.bigInt({ min: 2n, max: 1000n }), (total, pesos, k) => {
        expect(ratearPrograma(total, pesos.map((p) => p * k)).map((d) => d.centavos)).toEqual(
          ratearPrograma(total, pesos).map((d) => d.centavos),
        )
      }),
    )
  })
})
