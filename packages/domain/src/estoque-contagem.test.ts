import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { analiseDaContagem, analiseDoPeriodo, curvaABC } from './estoque-analise'
import {
  MEDIDA_INTEIRA,
  type MovimentoDeEstoque,
  loteSugerido,
  lotesComSaldo,
  saldoEmMedida,
} from './estoque'

/**
 * A CONTAGEM e a CURVA ABC — a aritmética da fatia que fecha o épico 6.
 *
 * Duas regras inegociáveis vivem aqui:
 *
 *  - **13.** `diferença = contagem final − saldo esperado`, e ela é
 *    **relatada, nunca corrigida**. Ajustá-la destrói a única informação que
 *    justifica contar o estoque.
 *  - **11.** O esperado é o SALDO imediatamente antes da contagem — a mesma
 *    derivação, não uma segunda conta. A propriedade ao fim deste arquivo
 *    cobra que as duas nunca divirjam.
 */

let seq = 0

const mov = (
  tipo: MovimentoDeEstoque['tipo'],
  milesimos: bigint,
  dia: string,
  lote: string | null = null,
): MovimentoDeEstoque => ({
  id: `m${++seq}`,
  sequencia: BigInt(seq),
  tipo,
  milesimos,
  dia,
  em: `${dia}T12:00:00.000Z`,
  lote,
})

/**
 * O movimento de contagem que pertence a um GRUPO.
 *
 * A contagem de um item com validade produz **uma linha por lote**: a
 * prateleira tem 2 frascos que vencem em junho e 1 que vence em setembro, e
 * isso é **uma** contagem — não três. O protótipo guarda um array
 * `validades: [{v, q}]` dentro de um movimento só; aqui o array é impossível
 * (uma coluna `lote` por linha), então o que amarra as linhas é `contagemId`.
 *
 * **Sem o grupo, `saldoEmMedida` leria só a ÚLTIMA linha** — o item com três
 * lotes contados mostraria o saldo do último, e os outros dois frascos
 * desapareceriam do estoque sem nenhum erro na tela.
 */
const movDeGrupo = (
  milesimos: bigint,
  dia: string,
  lote: string | null,
  contagemId: string,
): MovimentoDeEstoque => ({ ...mov('contagem', milesimos, dia, lote), contagemId })

describe('contagem em VÁRIOS LOTES — o grupo é o ponto de partida', () => {
  it('as três linhas da mesma contagem SOMAM, e não se sobrescrevem', () => {
    const s = saldoEmMedida(
      [
        movDeGrupo(2_000n, '2026-03-01', '2026-06-30', 'c1'),
        movDeGrupo(1_000n, '2026-03-01', '2026-09-30', 'c1'),
        movDeGrupo(500n, '2026-03-01', '2026-12-31', 'c1'),
      ],
      'ampola',
    )
    // 2 + 1 + 0,5 — e não 0,5, que é o que a leitura de uma linha só daria.
    expect(s.saldo.milesimos).toBe(3_500n)
    expect(s.semContagem).toBe(false)
  })

  it('o grupo reinicia a história: o que veio ANTES dele não conta', () => {
    const s = saldoEmMedida(
      [
        mov('entrada', 9_000n, '2026-01-01'),
        movDeGrupo(2_000n, '2026-03-01', '2026-06-30', 'c1'),
        movDeGrupo(1_000n, '2026-03-01', '2026-09-30', 'c1'),
        mov('consumo', -500n, '2026-03-05', '2026-06-30'),
      ],
      'ampola',
    )
    expect(s.saldo.milesimos).toBe(2_500n)
  })

  it('a contagem MAIS NOVA vence a antiga, grupo contra grupo', () => {
    const s = saldoEmMedida(
      [
        movDeGrupo(2_000n, '2026-03-01', '2026-06-30', 'c1'),
        movDeGrupo(1_000n, '2026-03-01', '2026-09-30', 'c1'),
        movDeGrupo(4_000n, '2026-04-01', '2026-09-30', 'c2'),
      ],
      'ampola',
    )
    expect(s.saldo.milesimos).toBe(4_000n)
  })

  it('cada lote do grupo entra no FIFO com o SEU saldo', () => {
    const linhas = [
      movDeGrupo(2_000n, '2026-03-01', '2026-09-30', 'c1'),
      movDeGrupo(1_000n, '2026-03-01', '2026-06-30', 'c1'),
    ]
    expect(lotesComSaldo(linhas, 'ampola').map((l) => [l.lote, l.saldo.milesimos])).toEqual([
      ['2026-06-30', 1_000n],
      ['2026-09-30', 2_000n],
    ])
    // E o sugerido é o que vence PRIMEIRO, não o que foi contado primeiro.
    expect(loteSugerido(linhas, 'ampola')).toBe('2026-06-30')
  })

  it('a contagem SOLTA (sem grupo) continua sendo um ponto de partida sozinha', () => {
    // `movEstoque` com tipo `contagem` grava uma linha sem `contagemId`. Ela
    // não pode arrastar a linha de outra contagem do mesmo dia.
    const s = saldoEmMedida(
      [mov('contagem', 2_000n, '2026-03-01'), mov('contagem', 7_000n, '2026-03-01')],
      'ampola',
    )
    expect(s.saldo.milesimos).toBe(7_000n)
  })
})

describe('analiseDaContagem — a diferença é RELATADA, nunca corrigida (regra 13)', () => {
  const ITEM = 'ampola'

  it('esperado = anterior + entradas − saídas ± ajustes, e a diferença sai dele', () => {
    const movs = [
      movDeGrupo(10_000n, '2026-03-01', null, 'c1'),
      mov('entrada', 4_000n, '2026-03-10'),
      mov('consumo', -1_000n, '2026-03-12'),
      mov('descarte', -500n, '2026-03-13'),
      mov('interno', -500n, '2026-03-14'),
      mov('ajuste', -1_000n, '2026-03-15'),
      movDeGrupo(10_000n, '2026-04-01', null, 'c2'),
    ]
    const a = analiseDaContagem(movs, 'c2', ITEM)!
    expect(a.temEsperado).toBe(true)
    expect(a.anterior?.quantidade.milesimos).toBe(10_000n)
    expect(a.anterior?.dia).toBe('2026-03-01')
    expect(a.entradas.milesimos).toBe(4_000n)
    // consumo + descarte + interno, em módulo
    expect(a.saidas.milesimos).toBe(2_000n)
    expect(a.ajustes.milesimos).toBe(-1_000n)
    // 10 + 4 − 2 − 1 = 11
    expect(a.esperado.milesimos).toBe(11_000n)
    expect(a.contado.milesimos).toBe(10_000n)
    // Faltou 1 ampola, e isso é o PRODUTO do módulo — nada é corrigido.
    expect(a.diferenca.milesimos).toBe(-1_000n)
  })

  it('a contagem de VÁRIOS LOTES é comparada pelo TOTAL do grupo', () => {
    const movs = [
      movDeGrupo(10_000n, '2026-03-01', '2026-06-30', 'c1'),
      mov('entrada', 2_000n, '2026-03-10', '2026-09-30'),
      movDeGrupo(8_000n, '2026-04-01', '2026-06-30', 'c2'),
      movDeGrupo(2_000n, '2026-04-01', '2026-09-30', 'c2'),
    ]
    const a = analiseDaContagem(movs, 'c2', ITEM)!
    expect(a.esperado.milesimos).toBe(12_000n)
    expect(a.contado.milesimos).toBe(10_000n)
    expect(a.diferenca.milesimos).toBe(-2_000n)
  })

  it('a PRIMEIRA contagem não tem esperado — é inventário inicial, não uma falta', () => {
    const movs = [
      mov('entrada', 3_000n, '2026-02-01'),
      movDeGrupo(10_000n, '2026-03-01', null, 'c1'),
    ]
    const a = analiseDaContagem(movs, 'c1', ITEM)!
    expect(a.temEsperado).toBe(false)
    expect(a.anterior).toBeNull()
    expect(a.diferenca.milesimos).toBe(0n)
    expect(a.contado.milesimos).toBe(10_000n)
  })

  it('contagem que não existe devolve `null`, e não uma análise de zeros', () => {
    expect(analiseDaContagem([mov('entrada', 1_000n, '2026-01-01')], 'c9', ITEM)).toBeNull()
  })

  it('a COMPENSAÇÃO zera a saída que ela reverte, sem tipo novo', () => {
    const consumo = mov('consumo', -1_000n, '2026-03-10')
    const movs = [
      movDeGrupo(5_000n, '2026-03-01', null, 'c1'),
      consumo,
      { ...mov('consumo', 1_000n, '2026-03-11'), compensaId: consumo.id },
      movDeGrupo(5_000n, '2026-04-01', null, 'c2'),
    ]
    const a = analiseDaContagem(movs, 'c2', ITEM)!
    expect(a.saidas.milesimos).toBe(0n)
    expect(a.esperado.milesimos).toBe(5_000n)
    expect(a.diferenca.milesimos).toBe(0n)
  })

  it('PROPRIEDADE: esperado = anterior + entradas − saídas + ajustes, e é o SALDO', () => {
    const delta = fc.record({
      tipo: fc.constantFrom(
        'entrada' as const,
        'consumo' as const,
        'descarte' as const,
        'interno' as const,
        'ajuste' as const,
      ),
      // A FRONTEIRA construída: zero, um milésimo, a medida inteira e valores
      // grandes. Um gerador uniforme de 1..1000 nunca produz o zero nem o
      // múltiplo exato da medida, que é onde a conta quebra.
      modulo: fc.oneof(
        fc.constant(0n),
        fc.constant(1n),
        fc.constant(MEDIDA_INTEIRA),
        fc.bigInt({ min: 1n, max: 10n ** 9n }),
      ),
      positivo: fc.boolean(),
    })
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 10n ** 9n }),
        fc.array(delta, { maxLength: 12 }),
        fc.bigInt({ min: 0n, max: 10n ** 9n }),
        (anterior, deltas, contado) => {
          const movs: MovimentoDeEstoque[] = [movDeGrupo(anterior, '2026-03-01', null, 'c1')]
          for (const d of deltas) {
            if (d.modulo === 0n) continue
            const sinal =
              d.tipo === 'entrada' ? 1n : d.tipo === 'ajuste' ? (d.positivo ? 1n : -1n) : -1n
            movs.push(mov(d.tipo, sinal * d.modulo, '2026-03-10'))
          }
          movs.push(movDeGrupo(contado, '2026-04-01', null, 'c2'))

          const a = analiseDaContagem(movs, 'c2', ITEM)
          expect(a).not.toBeNull()
          if (a === null) return
          expect(
            (a.anterior?.quantidade.milesimos ?? 0n) +
              a.entradas.milesimos -
              a.saidas.milesimos +
              a.ajustes.milesimos,
          ).toBe(a.esperado.milesimos)
          // A diferença é a subtração, nunca um clamp.
          expect(a.diferenca.milesimos).toBe(a.contado.milesimos - a.esperado.milesimos)
          // E o esperado é o SALDO imediatamente antes da contagem — a mesma
          // regra 11, por outro caminho. Duas contas que divergem seriam dois
          // números para a mesma pergunta.
          const semAContagem = movs.filter((m) => m.contagemId !== 'c2')
          expect(saldoEmMedida(semAContagem, ITEM).saldo.milesimos).toBe(a.esperado.milesimos)
        },
      ),
      { numRuns: 300 },
    )
  })
})

describe('analiseDoPeriodo — a janela é entre DUAS CONTAGENS', () => {
  const ITEM = 'ampola'

  it('compara a contagem do começo com a do fim, ignorando a do meio', () => {
    /**
     * A do MEIO é ignorada de propósito: uma contagem intermediária é outra
     * MEDIÇÃO, nunca uma correção (regra 13). Tomá-la como ponto de partida
     * esconderia a parte da perda que ela já tinha acusado — e é o recorte do
     * protótipo (`consumoItem`), medido nele.
     */
    const movs = [
      movDeGrupo(10_000n, '2026-03-01', null, 'c1'),
      mov('entrada', 4_000n, '2026-03-10'),
      movDeGrupo(12_000n, '2026-03-15', null, 'c2'),
      mov('consumo', -1_000n, '2026-03-20'),
      movDeGrupo(11_000n, '2026-03-31', null, 'c3'),
    ]
    const a = analiseDoPeriodo(movs, '2026-03-01', '2026-03-31', ITEM)!
    expect(a.deDia).toBe('2026-03-01')
    expect(a.ateDia).toBe('2026-03-31')
    // 10 + 4 − 1 = 13 esperado; contados 11. Faltaram 2 no PERÍODO — e não só
    // o 1 que a contagem do meio ainda não tinha visto.
    expect(a.esperado.milesimos).toBe(13_000n)
    expect(a.contado.milesimos).toBe(11_000n)
    expect(a.diferenca.milesimos).toBe(-2_000n)
  })

  it('DUAS CONTAGENS NO MESMO DIA saem na ordem de GRAVAÇÃO, não do dia', () => {
    /**
     * **O defeito que este teste pegou, e ele era meu.**
     *
     * Duas contagens do mesmo dia são o caso comum do PRIMEIRO dia de uso: a
     * inicial do cadastro e a primeira lista de contagem nascem as duas hoje.
     * A primeira escrita de `analiseDoPeriodo` escolhia a final com
     * `dia >= inicial.dia`, então ela podia escolher a que veio ANTES — e a
     * análise saía com o esperado e o contado TROCADOS, acusando falta onde
     * havia sobra.
     *
     * Medido no ambiente local, com a história 10 → +4 → −1 → contado 12:
     * a resposta era `esperado 12 · final 10 · dif −2`. O certo é
     * `esperado 13 · final 12 · dif −1`.
     */
    const movs = [
      movDeGrupo(10_000n, '2026-03-01', null, 'inicial'),
      mov('entrada', 4_000n, '2026-03-01'),
      mov('consumo', -1_000n, '2026-03-01'),
      movDeGrupo(12_000n, '2026-03-01', null, 'da-lista'),
    ]
    const a = analiseDoPeriodo(movs, '2026-03-01', '2026-03-01', ITEM)!
    expect(a.anterior?.quantidade.milesimos).toBe(10_000n)
    expect(a.esperado.milesimos).toBe(13_000n)
    expect(a.contado.milesimos).toBe(12_000n)
    expect(a.diferenca.milesimos).toBe(-1_000n)
  })

  it('a contagem ANTERIOR ao período é o ponto de partida', () => {
    const movs = [
      movDeGrupo(10_000n, '2026-02-20', null, 'c1'),
      mov('entrada', 2_000n, '2026-03-05'),
      movDeGrupo(12_000n, '2026-03-31', null, 'c2'),
    ]
    const a = analiseDoPeriodo(movs, '2026-03-01', '2026-03-31', ITEM)!
    expect(a.deDia).toBe('2026-02-20')
    expect(a.diferenca.milesimos).toBe(0n)
  })

  it('UMA contagem só no período devolve `null` — não há o que comparar', () => {
    const movs = [movDeGrupo(10_000n, '2026-03-10', null, 'c1')]
    expect(analiseDoPeriodo(movs, '2026-03-01', '2026-03-31', ITEM)).toBeNull()
    // E nenhuma contagem também.
    expect(analiseDoPeriodo([mov('entrada', 1_000n, '2026-03-02')], '2026-03-01', '2026-03-31', ITEM)).toBeNull()
  })

  it('DUAS contagens ANTES do período e nenhuma dentro devolve `null`', () => {
    /**
     * **Teste escrito porque uma mutação sobreviveu.**
     *
     * Trocar a escolha da contagem FINAL de "a última DEPOIS da inicial na
     * ordem" para "a última com `dia <= ate` e `dia >= inicial.dia`" passava
     * verde em tudo — menos aqui. Com duas contagens em fevereiro e nenhuma em
     * março, aquela versão escolhia como "final" uma contagem que vem ANTES da
     * inicial, e a tela mostrava uma análise de março feita com dois números de
     * fevereiro: esperado e contado trocados, uma falta que era uma sobra.
     *
     * `null` é a resposta certa, e é a do protótipo: a tela diz "sem contagens
     * no período" em vez de mostrar uma diferença que não significa nada.
     */
    const movs = [
      movDeGrupo(10_000n, '2026-02-20', null, 'c1'),
      mov('entrada', 4_000n, '2026-02-21'),
      movDeGrupo(14_000n, '2026-02-20', null, 'c2'),
      mov('consumo', -1_000n, '2026-03-05'),
    ]
    expect(analiseDoPeriodo(movs, '2026-03-01', '2026-03-31', ITEM)).toBeNull()
  })

  it('a contagem DEPOIS de `ate` não entra', () => {
    const movs = [
      movDeGrupo(10_000n, '2026-03-01', null, 'c1'),
      movDeGrupo(9_000n, '2026-03-20', null, 'c2'),
      movDeGrupo(1_000n, '2026-04-10', null, 'c3'),
    ]
    const a = analiseDoPeriodo(movs, '2026-03-01', '2026-03-31', ITEM)!
    expect(a.ateDia).toBe('2026-03-20')
    expect(a.contado.milesimos).toBe(9_000n)
  })

  it('o PERÍODO usa a mesma conta da CONTAGEM — duas somas divergentes seriam dois números', () => {
    const movs = [
      movDeGrupo(10_000n, '2026-03-01', null, 'c1'),
      mov('entrada', 4_000n, '2026-03-10'),
      mov('descarte', -500n, '2026-03-12'),
      mov('ajuste', 250n, '2026-03-13'),
      movDeGrupo(13_000n, '2026-03-31', null, 'c2'),
    ]
    const periodo = analiseDoPeriodo(movs, '2026-03-01', '2026-03-31', ITEM)!
    const contagem = analiseDaContagem(movs, 'c2', ITEM)!
    // Com duas contagens só, as duas perguntas têm a mesma resposta — e é essa
    // igualdade que prova que o núcleo da aritmética é um só.
    expect(periodo.esperado.milesimos).toBe(contagem.esperado.milesimos)
    expect(periodo.diferenca.milesimos).toBe(contagem.diferenca.milesimos)
    expect(periodo.entradas.milesimos).toBe(contagem.entradas.milesimos)
    expect(periodo.saidas.milesimos).toBe(contagem.saidas.milesimos)
    expect(periodo.ajustes.milesimos).toBe(contagem.ajustes.milesimos)
  })
})

describe('curvaABC — classificação por VALOR em estoque (MANUAL cap. 12)', () => {
  it('A até 80% do valor acumulado, B até 95%, C o resto', () => {
    // 800 · 100 · 50 · 50 = 1.000. Acumulado ANTES de cada um: 0 · 800 · 900 · 950.
    const abc = curvaABC([
      { id: 'i1', valor: 800n },
      { id: 'i2', valor: 100n },
      { id: 'i3', valor: 50n },
      { id: 'i4', valor: 50n },
    ])
    expect(abc.get('i1')).toBe('A')
    expect(abc.get('i2')).toBe('B')
    expect(abc.get('i3')).toBe('B')
    expect(abc.get('i4')).toBe('C')
  })

  it('o acumulado é o de ANTES do item — o que CRUZA os 80% ainda é A', () => {
    // O protótipo usa `antes/tot < .8`, e isso importa: com o acumulado DEPOIS
    // o item que sozinho vale 90% do estoque cairia em C, e "alto valor"
    // deixaria de fora justamente o frasco mais caro da geladeira.
    const abc = curvaABC([
      { id: 'caro', valor: 900n },
      { id: 'resto', valor: 100n },
    ])
    expect(abc.get('caro')).toBe('A')
  })

  it('valor zero é sempre C, e não entra no total', () => {
    const abc = curvaABC([
      { id: 'i1', valor: 100n },
      { id: 'zero', valor: 0n },
    ])
    expect(abc.get('zero')).toBe('C')
    expect(abc.get('i1')).toBe('A')
  })

  it('SALDO NEGATIVO é C e não entra no total — aqui divergimos do protótipo', () => {
    // O protótipo clampa o saldo em zero (`Math.max(0, …)`), então valor
    // negativo nunca existe lá. Aqui ele existe (CONTEXT.md: o saldo não é
    // clampado), e somá-lo ao total ENCOLHERIA o denominador: um item com
    // lançamento duplicado promoveria todos os outros a "alto valor".
    const abc = curvaABC([
      { id: 'i1', valor: 800n },
      { id: 'negativo', valor: -5_000n },
      { id: 'i2', valor: 200n },
    ])
    expect(abc.get('negativo')).toBe('C')
    expect(abc.get('i1')).toBe('A')
    expect(abc.get('i2')).toBe('B')
  })

  it('catálogo sem valor nenhum: todos C, e nenhuma divisão por zero', () => {
    const abc = curvaABC([
      { id: 'i1', valor: 0n },
      { id: 'i2', valor: 0n },
    ])
    expect([...abc.values()]).toEqual(['C', 'C'])
  })

  it('PROPRIEDADE: toda classe é um prefixo da ordem decrescente de valor', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            id: fc.string({ minLength: 1, maxLength: 4 }),
            // A fronteira: zero, negativo, um milésimo e grande.
            valor: fc.oneof(
              fc.constant(0n),
              fc.constant(1n),
              fc.bigInt({ min: -(10n ** 6n), max: -1n }),
              fc.bigInt({ min: 1n, max: 10n ** 12n }),
            ),
          }),
          { maxLength: 30 },
        ),
        (itens) => {
          const unicos = [...new Map(itens.map((i) => [i.id, i])).values()]
          const abc = curvaABC(unicos)
          expect(abc.size).toBe(unicos.length)
          for (const i of unicos) {
            expect(['A', 'B', 'C']).toContain(abc.get(i.id))
            // Valor não-positivo NUNCA é A nem B.
            if (i.valor <= 0n) expect(abc.get(i.id)).toBe('C')
          }
          // O conjunto A é um PREFIXO da ordem decrescente: nenhum item
          // classificado B ou C vale mais que o menor dos A. Sem isto, uma
          // classificação que embaralhasse a ordem ainda passaria nas
          // asserções acima.
          const positivosDe = (k: string) =>
            unicos.filter((i) => abc.get(i.id) === k && i.valor > 0n).map((i) => i.valor)
          const asA = positivosDe('A')
          if (asA.length > 0) {
            const menorA = asA.reduce((a, b) => (a < b ? a : b))
            for (const v of [...positivosDe('B'), ...positivosDe('C')]) {
              expect(v <= menorA).toBe(true)
            }
          }
        },
      ),
      { numRuns: 300 },
    )
  })
})
