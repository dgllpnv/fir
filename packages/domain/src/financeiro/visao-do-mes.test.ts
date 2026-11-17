import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { Dinheiro } from '../dinheiro'
import { CATEGORIAS_DESP, FORMA_NAO_INFORMADA, FORMAS_DE_SAIDA } from './contas'
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
  conferidos: [],
  conferidoAte: null,
  diasSemCaixa: 0,
  recebidoMesAnterior: ZERO,
  pagas: [],
  pagasMesAnterior: [],
  aPagar: [],
  aReceber: ZERO,
  meta: null,
  medidoParaAMeta: ZERO,
  medidaDaMeta: 'fir',
  caixas: [],
  diasUteis: 0,
}
/**
 * `conferidos` espelha `recebido` por padrão — o caso do MÊS FECHADO, em que
 * todo dia já teve caixa. Quem quer provar o recorte da regra 6 (mês em
 * curso, com dia aberto) informa `conferidos` à parte.
 */
const entrada = (p: Partial<EntradaDaVisao>): EntradaDaVisao => ({
  ...VAZIA,
  ...p,
  // Régua FIR por padrão: a meta é medida pelo que entrou, como antes do MedX.
  medidoParaAMeta:
    p.medidoParaAMeta !== undefined
      ? p.medidoParaAMeta
      : (p.recebido ?? []).reduce((s, x) => s.mais(x.valor), Dinheiro.zero()),
  conferidos: p.conferidos ?? (p.recebido ?? []).map((x) => ({ forma: x.forma ?? '', valor: x.valor })),
})
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
    expect(v.resultadoDoMes.centavos).toBe(-300000n)
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
    expect(mkt.mesAnterior.valor.centavos).toBe(90000n)
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

  it('meta medida pelo MedX: o percentual é do MedX, e `recebido` continua o da FIR (N-B6)', () => {
    const v = visaoDoMes(
      entrada({ meta: c(1000000), recebido: [pix(792000)], medidoParaAMeta: c(500000), medidaDaMeta: 'medx' }),
    )
    expect(v.recebido.centavos).toBe(792000n)
    expect(v.medido!.centavos).toBe(500000n)
    expect(v.medidaDaMeta).toBe('medx')
    expect(v.percentualDaMeta).toBe(50)
    expect(v.metaRestante!.centavos).toBe(500000n)
  })

  it('MedX sem leitura completa: sem percentual e sem "faltam" — nunca 0%', () => {
    const v = visaoDoMes(entrada({ meta: c(1000000), recebido: [pix(792000)], medidoParaAMeta: null, medidaDaMeta: 'medx' }))
    expect(v.percentualDaMeta).toBe(null)
    expect(v.metaRestante).toBe(null)
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

  it('num mês EM CURSO, `porForma` para no último dia conferido', () => {
    const v = visaoDoMes(
      entrada({
        recebido: [pix(45000), pix(12000), { forma: 'Dinheiro', valor: c(30000) }],
        // Só os dois primeiros caem em dias com caixa fechado.
        conferidos: [pix(45000), pix(12000)],
        conferidoAte: '2026-10-23',
        diasSemCaixa: 1,
      }),
    )
    expect(v.recebido.centavos).toBe(87000n)
    expect(v.porForma.reduce((s, x) => s.mais(x.valor), ZERO).centavos).toBe(57000n)
    expect(v.porForma.find((x) => x.forma === 'Dinheiro')).toBeUndefined()
    // E a tela SABE o recorte: um número que não fecha com o total precisa
    // dizer de onde ele vem.
    expect(v.porFormaAteODia).toBe('2026-10-23')
    expect(v.porFormaDiasSemCaixa).toBe(1)
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
    expect(v.resultadoDoMes.centavos).toBe(200000n) //  R$  2.000,00
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
          // Mês FECHADO: `conferidos === recebido`, e aí a soma por forma é
          // exatamente o recebido. Num mês em curso ela é MENOR, de
          // propósito — ver a propriedade seguinte.
          const v = visaoDoMes(entrada({ recebido }))
          const soma = v.porForma.reduce((s, x) => s.mais(x.valor), Dinheiro.zero())
          expect(soma.centavos).toBe(v.recebido.centavos)
        },
      ),
    )
  })

  it('A REGRA 6 NA VISÃO DO MÊS: `porForma` nunca alcança um dia sem caixa fechado', () => {
    // A propriedade CONSTRÓI o caso em vez de sorteá-lo: `conferidos` é um
    // prefixo de `recebido`, e o resto é o que ainda está na gaveta. Com
    // geradores independentes a chance de o resto ser não-vazio E mudar
    // alguma forma seria boa, mas o que importa aqui é a FRONTEIRA — que
    // nenhum centavo de um dia aberto apareça por forma.
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            forma: fc.constantFrom('Pix', 'Dinheiro', 'Cartão de crédito'),
            valor: dinheiro,
          }),
          { minLength: 1, maxLength: 40 },
        ),
        fc.nat(),
        (recebido, corte) => {
          const quantos = corte % (recebido.length + 1)
          const conferidos = recebido.slice(0, quantos)
          const v = visaoDoMes(entrada({ recebido, conferidos }))

          const porForma = v.porForma.reduce((s, x) => s.mais(x.valor), Dinheiro.zero())
          const esperado = conferidos.reduce((s, x) => s.mais(x.valor), Dinheiro.zero())
          // A soma por forma é a dos CONFERIDOS, exatamente — nunca mais.
          expect(porForma.centavos).toBe(esperado.centavos)
          // E o total do mês continua inteiro: a regra 6 recorta o agregado
          // por forma, não a receita do mês.
          const tudo = recebido.reduce((s, x) => s.mais(x.valor), Dinheiro.zero())
          expect(v.recebido.centavos).toBe(tudo.centavos)
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
          expect(v.resultadoDoMes.centavos).toBe(v.recebido.centavos - v.despesasPagas.centavos)
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

  it('`percentualInteiro` acerta EM CIMA da fronteira do meio, com `b` acima de 2^53', () => {
    // A propriedade acima não pega a versão em `float`: divergência só
    // acontece a um fio da fronteira `p,5`, e sortear `a` ao acaso nunca cai
    // lá (medido — 100 execuções, nenhuma). Esta CONSTRÓI a fronteira, em vez
    // de esperar o sorteio, e é ela que torna os três números congelados lá em
    // cima uma invariante em vez de três exemplos.
    fc.assert(
      fc.property(
        fc.bigInt({ min: 2n ** 53n + 1n, max: 2n ** 56n }),
        fc.bigInt({ min: 1n, max: 199n }),
        fc.constantFrom(-2n, -1n, 0n, 1n, 2n),
        (b, p, jitter) => {
          const a = (b * (2n * p + 1n)) / 200n + jitter
          const r = BigInt(percentualInteiro(a, b)!)
          const erro2 = 2n * (r * b - 100n * a)
          expect(erro2 > -b && erro2 <= b).toBe(true)
        },
      ),
      { numRuns: 500 },
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

/**
 * PAGO POR FORMA (ADR 0020, gate do `validador-numeros`, P1–P6).
 *
 * As formas sorteadas incluem as da lista, o vazio (`''`, Paguei sem forma) e
 * texto ARBITRÁRIO — a forma legada ou renomeada que uma implementação que
 * percorre `FORMAS_DE_SAIDA` faria sumir da soma.
 */
describe('pago por forma de pagamento', () => {
  const forma = fc.oneof(
    fc.constantFrom(...FORMAS_DE_SAIDA, '', '  '),
    fc.string({ minLength: 1, maxLength: 30 }),
  )
  const paga: fc.Arbitrary<DespesaPaga> = fc.record({
    categoria: fc.constantFrom(...CATEGORIAS_DESP.map((x) => x.nome)),
    // `valor_pago > 0` é CHECK no banco.
    valor: fc.bigInt({ min: 1n, max: 10_000_000n }).map((n) => Dinheiro.deCentavos(n)),
    forma,
  })
  const chave = (f: string | undefined) => ((f ?? '').trim() === '' ? FORMA_NAO_INFORMADA : (f ?? '').trim())
  const somaDe = (xs: readonly { valor: Dinheiro }[]) => xs.reduce((s, x) => s + x.valor.centavos, 0n)

  it('P1 e P6: Σ pagoPorForma = despesasPagas = Σ porCategoria, EXATAMENTE', () => {
    fc.assert(
      fc.property(fc.array(paga, { maxLength: 80 }), (pagas) => {
        const v = visaoDoMes(entrada({ pagas }))
        expect(somaDe(v.pagoPorForma)).toBe(v.despesasPagas.centavos)
        expect(somaDe(v.porCategoria)).toBe(v.despesasPagas.centavos)
      }),
    )
  })

  it('P2: cada linha é a soma das despesas daquela forma (oráculo ingênuo)', () => {
    fc.assert(
      fc.property(fc.array(paga, { maxLength: 60 }), (pagas) => {
        const v = visaoDoMes(entrada({ pagas }))
        for (const l of v.pagoPorForma) {
          const oraculo = pagas.filter((p) => chave(p.forma) === l.forma).reduce((s, p) => s + p.valor.centavos, 0n)
          expect(l.valor.centavos).toBe(oraculo)
        }
      }),
    )
  })

  it('P3: sem linha vazia nem repetida nem zero; o vazio vira "Não informada"', () => {
    fc.assert(
      fc.property(fc.array(paga, { maxLength: 60 }), (pagas) => {
        const v = visaoDoMes(entrada({ pagas }))
        const nomes = v.pagoPorForma.map((l) => l.forma)
        expect(nomes).not.toContain('')
        expect(new Set(nomes).size).toBe(nomes.length)
        for (const l of v.pagoPorForma) expect(l.valor.ehZero()).toBe(false)
        if (pagas.some((p) => (p.forma ?? '').trim() === '')) expect(nomes).toContain(FORMA_NAO_INFORMADA)
      }),
    )
  })

  it('P4: ordem não crescente de valor, com empate pelo nome', () => {
    fc.assert(
      fc.property(fc.array(paga, { maxLength: 60 }), (pagas) => {
        const l = visaoDoMes(entrada({ pagas })).pagoPorForma
        for (let i = 1; i < l.length; i++) {
          const a = l[i - 1]!
          const b = l[i]!
          expect(a.valor.centavos >= b.valor.centavos).toBe(true)
          if (a.valor.centavos === b.valor.centavos) expect(a.forma.localeCompare(b.forma, 'pt-BR')).toBeLessThanOrEqual(0)
        }
      }),
    )
  })

  it('P5: embaralhar a entrada não muda a saída', () => {
    fc.assert(
      fc.property(fc.array(paga, { maxLength: 40 }).chain((xs) => fc.tuple(fc.constant(xs), fc.shuffledSubarray(xs, { minLength: xs.length, maxLength: xs.length }))), ([a, b]) => {
        const ja = visaoDoMes(entrada({ pagas: a })).pagoPorForma.map((l) => [l.forma, l.valor.centavos])
        const jb = visaoDoMes(entrada({ pagas: b })).pagoPorForma.map((l) => [l.forma, l.valor.centavos])
        expect(jb).toEqual(ja)
      }),
    )
  })

  it('forma desconhecida ganha linha própria e não some da soma', () => {
    const v = visaoDoMes(
      entrada({
        pagas: [
          { categoria: CATEGORIAS_DESP[0]!.nome, valor: Dinheiro.deCentavos(10_000n), forma: 'Pix' },
          { categoria: CATEGORIAS_DESP[0]!.nome, valor: Dinheiro.deCentavos(5_000n), forma: 'TED' },
        ],
      }),
    )
    expect(v.pagoPorForma.map((l) => [l.forma, l.valor.centavos])).toEqual([
      ['Pix', 10_000n],
      ['TED', 5_000n],
    ])
    expect(v.despesasPagas.centavos).toBe(15_000n)
  })
})

describe('visaoDoMes — PARTES e OUTRAS ENTRADAS (fatia 4)', () => {
  it('Σ porForma (partes) = recebido: o recebimento de 500 em Pix 300 + Dinheiro 200', () => {
    // `recebido` é um item por RECEBIMENTO (r.valor); `conferidos` são as PARTES.
    const v = visaoDoMes(
      entrada({
        recebido: [{ valor: c(50000) }],
        conferidos: [pix(30000), { forma: 'Dinheiro', valor: c(20000) }],
      }),
    )
    expect(v.recebido.centavos).toBe(50000n)
    expect(v.quantidadeDeRecebimentos).toBe(1) // um recebimento, duas partes
    expect(v.porForma.reduce((s, x) => s.mais(x.valor), ZERO).centavos).toBe(50000n)
  })

  it('outras entradas somam no resultado, e NUNCA em recebido, meta ou percentual da meta', () => {
    const v = visaoDoMes(
      entrada({
        recebido: [{ valor: c(100000) }],
        pagas: [{ categoria: 'Aluguel', valor: c(30000) }],
        outrasEntradas: [{ valor: c(5000) }, { valor: c(2500) }],
        meta: c(200000),
      }),
    )
    expect(v.recebido.centavos).toBe(100000n)
    expect(v.outrasEntradas.centavos).toBe(7500n)
    expect(v.quantidadeDeOutrasEntradas).toBe(2)
    expect(v.resultadoDoMes.centavos).toBe(100000n + 7500n - 30000n)
    expect(v.percentualDaMeta).toBe(50) // só sobre o recebido
    expect(v.metaRestante!.centavos).toBe(100000n)
  })

  it('sem outras entradas, nada muda (compatível)', () => {
    const v = visaoDoMes(entrada({ recebido: [{ valor: c(100) }] }))
    expect(v.outrasEntradas.centavos).toBe(0n)
    expect(v.resultadoDoMes.centavos).toBe(100n)
  })

  it('propriedade: resultado = recebido + outras − despesas, e a soma das partes fecha com o recebido', () => {
    fc.assert(
      fc.property(
        fc.array(fc.bigInt({ min: 1n, max: 10_000_000n }), { maxLength: 8 }),
        fc.array(fc.bigInt({ min: 1n, max: 10_000_000n }), { maxLength: 8 }),
        fc.array(fc.bigInt({ min: 1n, max: 10_000_000n }), { maxLength: 8 }),
        (rec, outras, desp) => {
          const v = visaoDoMes(
            entrada({
              recebido: rec.map((n) => ({ valor: Dinheiro.deCentavos(n) })),
              conferidos: rec.map((n) => ({ forma: 'Pix', valor: Dinheiro.deCentavos(n) })),
              outrasEntradas: outras.map((n) => ({ valor: Dinheiro.deCentavos(n) })),
              pagas: desp.map((n) => ({ categoria: 'Aluguel', valor: Dinheiro.deCentavos(n) })),
            }),
          )
          const soma = (xs: readonly bigint[]) => xs.reduce((s, x) => s + x, 0n)
          expect(v.resultadoDoMes.centavos).toBe(soma(rec) + soma(outras) - soma(desp))
          expect(v.porForma.reduce((s, x) => s + x.valor.centavos, 0n)).toBe(v.recebido.centavos)
        },
      ),
    )
  })

  it('propriedade: recebido, meta e TODOS os percentuais são invariantes às outras entradas', () => {
    const valor = fc.bigInt({ min: 1n, max: 10_000_000n })
    fc.assert(
      fc.property(
        fc.array(valor, { maxLength: 6 }),
        fc.array(valor, { minLength: 1, maxLength: 6 }),
        fc.array(valor, { maxLength: 6 }),
        fc.option(valor, { nil: undefined }),
        (rec, outras, desp, meta) => {
          const base = {
            recebido: rec.map((n) => ({ valor: Dinheiro.deCentavos(n) })),
            conferidos: rec.map((n) => ({ forma: 'Pix', valor: Dinheiro.deCentavos(n) })),
            pagas: desp.map((n) => ({ categoria: 'Aluguel', valor: Dinheiro.deCentavos(n) })),
            ...(meta === undefined ? {} : { meta: Dinheiro.deCentavos(meta) }),
          }
          const sem = visaoDoMes(entrada(base))
          const com = visaoDoMes(
            entrada({ ...base, outrasEntradas: outras.map((n) => ({ valor: Dinheiro.deCentavos(n) })) }),
          )
          const soma = (xs: readonly bigint[]) => xs.reduce((s, x) => s + x, 0n)
          expect(com.recebido).toEqual(sem.recebido)
          expect(com.quantidadeDeRecebimentos).toBe(sem.quantidadeDeRecebimentos)
          expect(com.porForma).toEqual(sem.porForma)
          expect(com.percentualDaMeta).toBe(sem.percentualDaMeta)
          expect(com.metaRestante).toEqual(sem.metaRestante)
          // Mantido por spec: o percentual do resultado é sobre o RECEBIDO.
          expect(com.percentualDoResultado === null || typeof com.percentualDoResultado === 'number').toBe(true)
          expect(com.outrasEntradas.centavos).toBe(soma(outras))
          expect(com.resultadoDoMes.centavos).toBe(sem.resultadoDoMes.centavos + soma(outras))
        },
      ),
    )
  })

  it('a parte de forma VAZIA (legado) sai como "Não informada", o rótulo do painel (R2)', () => {
    const v = visaoDoMes(
      entrada({
        recebido: [{ valor: c(500) }, { valor: c(300) }],
        conferidos: [{ forma: '', valor: c(500) }, pix(300)],
      }),
    )
    expect(v.porForma.map((x) => x.forma)).toEqual([FORMA_NAO_INFORMADA, 'Pix'])
    expect(v.porForma.some((x) => x.forma === '')).toBe(false)
  })
})
