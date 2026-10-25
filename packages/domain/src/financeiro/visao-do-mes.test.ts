import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { Dinheiro } from '../dinheiro'
import { CATEGORIAS_DESP } from './contas'
import {
  diasUteisAte,
  percentualInteiro,
  visaoDoMes,
  type DespesaPaga,
  type EntradaDaVisao,
} from './visao-do-mes'

const c = (n: number) => Dinheiro.deCentavos(BigInt(n))
const ZERO = Dinheiro.zero()

const VAZIA: EntradaDaVisao = {
  recebido: [],
  recebidoMesAnterior: ZERO,
  pagas: [],
  pagasMesAnterior: [],
  aPagar: [],
  aReceber: ZERO,
  meta: null,
  caixas: [],
  diasUteis: 0,
}
const entrada = (p: Partial<EntradaDaVisao>): EntradaDaVisao => ({ ...VAZIA, ...p })
const pix = (n: number) => ({ forma: 'Pix', valor: c(n) })

describe('percentualInteiro — a divisão que não passa por float', () => {
  it('o percentual arredonda como o Math.round, sem float', () => {
    expect(percentualInteiro(6600n, 10000n)).toBe(66)
    expect(percentualInteiro(665n, 1000n)).toBe(67) // 66,5 → 67, meio para cima
    expect(percentualInteiro(664n, 1000n)).toBe(66)
    expect(percentualInteiro(0n, 1000n)).toBe(0)
    expect(percentualInteiro(1000n, 0n)).toBeNull() // meta zero não tem percentual
  })

  it('o percentual sobrevive a valores que estouram o double', () => {
    // 90.071.992.547.409.919 centavos: `Number()` deste valor já mente.
    expect(percentualInteiro(90071992547409919n, 90071992547409919n)).toBe(100)
    expect(percentualInteiro(90071992547409919n, 180143985094819838n)).toBe(50)
  })

  it('O CONTRAEXEMPLO DO `Math.round(Number(a)/Number(b)*100)`: 12%, e não 13%', () => {
    // `b` é 2^53+1, o primeiro inteiro que o double não representa: `Number(b)`
    // devolve 2^53, um a MENOS, e com isso a razão calculada em ponto
    // flutuante sobe o suficiente para atravessar a fronteira do meio.
    //
    // Conferido à mão, em inteiros: 100·a = 112.589.990.684.262.400 e
    // 12,5·b = 112.589.990.684.262.412,5 — então 100a/b está ABAIXO de 12,5 e
    // arredonda para 12. A versão em `float` devolve 13.
    //
    // Os dois primeiros `expect` deste bloco passam verde com a versão em
    // `float` (medido: `a/a` dá 1 exato, `a/2a` dá 0,5 exato), e foi por isso
    // que este caso precisou ser PROCURADO em vez de escolhido.
    expect(percentualInteiro(1125899906842624n, 9007199254740993n)).toBe(12)
    expect(percentualInteiro(1035827914295214n, 9007199254740993n)).toBe(11)
    expect(percentualInteiro(2296835809958953n, 9007199254740993n)).toBe(25)
  })

  it('percentual negativo arredonda meio PARA CIMA, como o Math.round', () => {
    // Math.round(-66.5) === -66, não -67. O resultado do mês é negativo com
    // frequência, e um arredondamento que diverge do Math.round faria a tela
    // discordar do protótipo por um ponto, sem explicação.
    expect(percentualInteiro(-665n, 1000n)).toBe(-66)
    expect(percentualInteiro(-666n, 1000n)).toBe(-67)
    expect(percentualInteiro(-300000n, 500000n)).toBe(-60)
  })
})

describe('visaoDoMes', () => {
  it('resultado é recebido menos despesas pagas, e pode ser negativo', () => {
    const v = visaoDoMes(
      entrada({ recebido: [pix(500000)], pagas: [{ categoria: 'Pessoal', valor: c(800000) }] }),
    )
    expect(v.resultado.centavos).toBe(-300000n)
    expect(v.percentualDoResultado).toBe(-60)
  })

  it('despesa paga usa o VALOR PAGO quando ele difere do valor da conta', () => {
    // A conta era R$ 980 e veio R$ 1.012. O mês fecha com 1.012. Quem monta
    // a lista é o repositório, com `coalesce(valor_pago, valor)`; aqui a
    // garantia é que NADA mais é somado depois.
    const v = visaoDoMes(entrada({ pagas: [{ categoria: 'Ocupação', valor: c(101200) }] }))
    expect(v.despesasPagas.centavos).toBe(101200n)
  })

  it('fixas e variáveis somam exatamente as despesas pagas', () => {
    const v = visaoDoMes(
      entrada({
        pagas: [
          { categoria: 'Pessoal', valor: c(400000) },
          { categoria: 'Ocupação', valor: c(250000) },
          { categoria: 'Marketing', valor: c(150000) },
        ],
      }),
    )
    expect(v.fixas.centavos).toBe(650000n)
    expect(v.variaveis.centavos).toBe(150000n)
    expect(v.fixas.mais(v.variaveis).centavos).toBe(v.despesasPagas.centavos)
  })

  it('uma categoria sem movimento no mês NÃO aparece — e uma com movimento no mês anterior, sim', () => {
    const v = visaoDoMes(
      entrada({
        pagas: [{ categoria: 'Pessoal', valor: c(400000) }],
        pagasMesAnterior: [{ categoria: 'Marketing', valor: c(90000) }],
      }),
    )
    expect(v.porCategoria.map((x) => x.categoria)).toEqual(['Pessoal', 'Marketing'])
    const mkt = v.porCategoria.find((x) => x.categoria === 'Marketing')!
    expect(mkt.valor.ehZero()).toBe(true)
    expect(mkt.valorMesAnterior.centavos).toBe(90000n)
    expect(v.porCategoria.map((x) => x.categoria)).not.toContain('Ocupação')
  })

  it('as categorias saem na ordem da tabela, fixas antes das variáveis', () => {
    const v = visaoDoMes(
      entrada({
        pagas: [
          { categoria: 'Outras despesas', valor: c(1) },
          { categoria: 'Ocupação', valor: c(1) },
          { categoria: 'Marketing', valor: c(1) },
          { categoria: 'Pessoal', valor: c(1) },
        ],
      }),
    )
    expect(v.porCategoria.map((x) => x.categoria)).toEqual([
      'Pessoal',
      'Ocupação',
      'Marketing',
      'Outras despesas',
    ])
  })

  it('categoria desconhecida cai em `Outras despesas` — o dinheiro não some da soma', () => {
    // A coluna do banco é `text` (acrescentar categoria não pode exigir
    // migration), então um nome fora da lista é possível. Descartá-lo quebraria
    // `fixas + variáveis === despesasPagas` sem erro nenhum — e é esse buraco
    // que o protótipo tem em `porCat`, que mapeia só sobre CATEGORIAS_DESP.
    const v = visaoDoMes(entrada({ pagas: [{ categoria: 'Cerveja', valor: c(5000) }] }))
    expect(v.despesasPagas.centavos).toBe(5000n)
    expect(v.porCategoria.find((x) => x.categoria === 'Outras despesas')!.valor.centavos).toBe(5000n)
    expect(v.fixas.mais(v.variaveis).centavos).toBe(5000n)
  })

  it('a meta sem `valores` entrega só o percentual', () => {
    // Aqui é só a FORMA: `meta` e `recebido` existem como campo, e quem os
    // apaga é o interceptor. O domínio nunca decide permissão.
    const v = visaoDoMes(entrada({ meta: c(1200000), recebido: [pix(792000)] }))
    expect(v.percentualDaMeta).toBe(66)
    expect(v.metaRestante!.centavos).toBe(408000n)
  })

  it('meta batida não devolve "faltam" negativo', () => {
    const v = visaoDoMes(entrada({ meta: c(100000), recebido: [pix(150000)] }))
    expect(v.percentualDaMeta).toBe(150)
    expect(v.metaRestante!.ehZero()).toBe(true)
  })

  it('sem meta, o percentual e o restante são `null` — não zero', () => {
    const v = visaoDoMes(entrada({ recebido: [pix(150000)] }))
    expect(v.percentualDaMeta).toBeNull()
    expect(v.metaRestante).toBeNull()
  })

  it('"a pagar" conta as vencidas à parte, sem tirá-las do total', () => {
    const v = visaoDoMes(
      entrada({
        aPagar: [
          { valor: c(100000), vencida: true },
          { valor: c(250000), vencida: false },
        ],
      }),
    )
    expect(v.aPagar.centavos).toBe(350000n)
    expect(v.quantidadeAPagar).toBe(2)
    expect(v.quantidadeVencidas).toBe(1)
  })

  it('o recebido sai por forma, em ARRAY — nunca num mapa com o valor na chave', () => {
    const v = visaoDoMes(
      entrada({
        recebido: [
          pix(45000),
          pix(12000),
          { forma: 'Nota promissória', valor: c(120000) },
          { forma: 'Dinheiro', valor: c(5000) },
        ],
      }),
    )
    expect(Array.isArray(v.porForma)).toBe(true)
    expect(v.porForma.find((x) => x.forma === 'Pix')!.valor.centavos).toBe(57000n)
    // A promissória É receita (entra no LTV e no recebido do mês); ela só não
    // está na gaveta. Diferente do caixa, aqui ela aparece.
    expect(v.recebido.centavos).toBe(182000n)
    expect(v.porForma.find((x) => x.forma === 'Nota promissória')!.valor.centavos).toBe(120000n)
  })

  it('o resumo dos caixas do mês conta os fechados e os que tinham diferença', () => {
    const v = visaoDoMes(
      entrada({
        caixas: [{ diferenca: ZERO }, { diferenca: c(-5000) }, { diferenca: ZERO }],
        diasUteis: 18,
      }),
    )
    expect(v.caixa.fechados).toBe(3)
    expect(v.caixa.comDiferenca).toBe(1)
    expect(v.caixa.diferenca.centavos).toBe(-5000n)
    expect(v.caixa.diasUteis).toBe(18)
  })

  it('O FECHAMENTO À MÃO, com números redondos — é este que alguém relê quando o mês não bate', () => {
    // Recebido R$ 10.000,00.
    // Despesas: Pessoal R$ 4.000,00 · Ocupação R$ 2.500,00 · Marketing R$ 1.500,00.
    // Meta do mês: R$ 12.000,00.
    const v = visaoDoMes(
      entrada({
        recebido: [pix(1000000)],
        pagas: [
          { categoria: 'Pessoal', valor: c(400000) },
          { categoria: 'Ocupação', valor: c(250000) },
          { categoria: 'Marketing', valor: c(150000) },
        ],
        meta: c(1200000),
      }),
    )
    expect(v.recebido.centavos).toBe(1000000n) //  R$ 10.000,00
    expect(v.despesasPagas.centavos).toBe(800000n) //  R$  8.000,00
    expect(v.fixas.centavos).toBe(650000n) //  R$  6.500,00
    expect(v.variaveis.centavos).toBe(150000n) //  R$  1.500,00
    expect(v.percentualFixas).toBe(81) //  6.500 / 8.000 = 81,25%
    expect(v.percentualVariaveis).toBe(19) //  1.500 / 8.000 = 18,75%
    expect(v.resultado.centavos).toBe(200000n) //  R$  2.000,00
    expect(v.percentualDoResultado).toBe(20) //  2.000 / 10.000
    expect(v.percentualDaMeta).toBe(83) // 10.000 / 12.000 = 83,33%
    expect(v.metaRestante!.centavos).toBe(200000n) //  R$  2.000,00
  })
})

describe('diasUteisAte', () => {
  it('conta de segunda a sexta, do dia 1 até hoje, inclusive', () => {
    // Outubro de 2026: dia 1 é quinta. Até 2026-10-09 (sexta): 1,2,5,6,7,8,9.
    expect(diasUteisAte('2026-10', '2026-10-09')).toBe(7)
  })

  it('num mês já encerrado conta o mês inteiro', () => {
    expect(diasUteisAte('2026-09', '2026-10-15')).toBe(22)
  })

  it('num mês que ainda não começou conta zero', () => {
    expect(diasUteisAte('2026-11', '2026-10-15')).toBe(0)
  })
})

const dinheiro = fc.bigInt({ min: 0n, max: 10_000_000n }).map((n) => Dinheiro.deCentavos(n))
const despesa: fc.Arbitrary<DespesaPaga> = fc.record({
  categoria: fc.constantFrom(...CATEGORIAS_DESP.map((x) => x.nome)),
  valor: dinheiro,
})

describe('visaoDoMes — propriedades de fechamento', () => {
  it('a soma das categorias é exatamente o total de despesas pagas, e fixas + variáveis também', () => {
    fc.assert(
      fc.property(fc.array(despesa, { maxLength: 80 }), (pagas) => {
        const v = visaoDoMes(entrada({ pagas }))
        const porCat = v.porCategoria.reduce((s, x) => s.mais(x.valor), Dinheiro.zero())
        expect(porCat.centavos).toBe(v.despesasPagas.centavos)
        expect(v.fixas.mais(v.variaveis).centavos).toBe(v.despesasPagas.centavos)
      }),
    )
  })

  it('a soma por forma é exatamente o recebido do mês', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            forma: fc.constantFrom('Pix', 'Dinheiro', 'Cartão de crédito', 'Nota promissória'),
            valor: dinheiro,
          }),
          { maxLength: 80 },
        ),
        (recebido) => {
          const v = visaoDoMes(entrada({ recebido }))
          const soma = v.porForma.reduce((s, x) => s.mais(x.valor), Dinheiro.zero())
          expect(soma.centavos).toBe(v.recebido.centavos)
        },
      ),
    )
  })

  it('somar a lista em qualquer ordem dá o mesmo total', () => {
    fc.assert(
      fc.property(fc.array(despesa, { maxLength: 80 }), (pagas) => {
        const a = visaoDoMes(entrada({ pagas }))
        const b = visaoDoMes(entrada({ pagas: [...pagas].reverse() }))
        expect(b.despesasPagas.centavos).toBe(a.despesasPagas.centavos)
        expect(b.porCategoria.map((x) => [x.categoria, x.valor.centavos])).toEqual(
          a.porCategoria.map((x) => [x.categoria, x.valor.centavos]),
        )
      }),
    )
  })

  it('resultado é sempre exatamente recebido − despesas pagas', () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ forma: fc.constant('Pix'), valor: dinheiro }), { maxLength: 40 }),
        fc.array(despesa, { maxLength: 40 }),
        (recebido, pagas) => {
          const v = visaoDoMes(entrada({ recebido, pagas }))
          expect(v.resultado.centavos).toBe(v.recebido.centavos - v.despesasPagas.centavos)
        },
      ),
    )
  })

  it('`percentualInteiro` é o inteiro MAIS PRÓXIMO de a·100/b, com o meio para cima', () => {
    // Sem oráculo em `float`: comparar com `Math.round(Number(a)/Number(b)*100)`
    // seria comparar com a implementação que esta função existe para
    // substituir, e o oráculo erra sozinho nos meios exatos (`-0.665*100`
    // vira `-66.50000000000001` em binário). A definição exata, em inteiros:
    // `2·(p·b − 100a)` cai em `(−b, b]`.
    fc.assert(
      fc.property(
        // A faixa passa DE PROPÓSITO acima de 2^53: abaixo dela o `Number()`
        // é exato e a propriedade não distingue esta implementação de um
        // `Math.round` em ponto flutuante — medido, a mutação passou verde.
        //
        // E a RAZÃO fica limitada a ±200%, porque o retorno é `number`: com
        // `b` pequeno e `a` enorme o próprio resultado passa de 2^53 e a
        // conversão final mente — o que é verdade da função, não da
        // propriedade, e está escrito no `percentualInteiro`.
        fc.bigInt({ min: 2n ** 53n, max: 2n ** 60n }).chain((b) =>
          fc.tuple(fc.bigInt({ min: -2n * b, max: 2n * b }), fc.constant(b)),
        ),
        ([a, b]) => {
          const p = BigInt(percentualInteiro(a, b)!)
          const erro2 = 2n * (p * b - 100n * a)
          expect(erro2 > -b && erro2 <= b).toBe(true)
        },
      ),
    )
  })

  it('`percentualInteiro` é monótono: receber mais nunca baixa o percentual da meta', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 10_000_000n }),
        fc.bigInt({ min: 0n, max: 10_000_000n }),
        fc.bigInt({ min: 1n, max: 10_000_000n }),
        (x, y, b) => {
          const [menor, maior] = x <= y ? [x, y] : [y, x]
          expect(percentualInteiro(menor, b)!).toBeLessThanOrEqual(percentualInteiro(maior, b)!)
        },
      ),
    )
  })
})
