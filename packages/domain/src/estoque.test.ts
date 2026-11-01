import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  type ItemComUnidades,
  MEDIDA_INTEIRA,
  type MovimentoDeEstoque,
  baixaDoItem,
  deMedidaParaExibicao,
  loteSugerido,
  lotesComSaldo,
  paraMedida,
  saldoEmMedida,
  sinalDoTipo,
} from './estoque'
import { Quantidade } from './quantidade'
import { ehErro, ehOk, exigir } from './resultado'

/**
 * O estoque, na aritmética — **sem banco, sem HTTP**.
 *
 * Três coisas são provadas aqui, e cada uma é uma regra inegociável do
 * `CLAUDE.md`:
 *
 *  - **9.** As conversões vêm do CADASTRO. Nenhum número de conversão aparece
 *    neste arquivo fora de um `ItemComUnidades`, e nenhum aparece em
 *    `estoque.ts` — o que lá existe é `MEDIDA_INTEIRA`, que é a definição de
 *    "uma unidade de medida em milésimos", não um fator de item.
 *  - **10.** Unidade desconhecida **lança erro**, nunca converte em silêncio.
 *  - **11.** Saldo é DERIVADO: última contagem + entradas − saídas ± ajustes.
 *  - **15.** Lote por FIFO de validade, e item que não aproveita sobra gera
 *    DOIS movimentos somando a unidade inteira.
 */

/** 1 caixa = 4 ampolas · 1 ampola = 5 mg · não aproveita sobra. */
const FRASCO: ItemComUnidades = {
  medida: 'ampola',
  unidCompra: 'caixa',
  fatorCompra: 4_000n,
  unidUso: 'mg',
  fatorUso: 5_000n,
  aproveitaSobra: false,
}

/** Descartável: uma unidade só, sem compra em caixa nem dose. */
const SERINGA: ItemComUnidades = {
  medida: 'un.',
  unidCompra: null,
  fatorCompra: null,
  unidUso: null,
  fatorUso: null,
  aproveitaSobra: true,
}

/** O mesmo frasco, mas a clínica aproveita a sobra no próximo paciente. */
const FRASCO_APROVEITA: ItemComUnidades = { ...FRASCO, aproveitaSobra: true }

const mg = (m: bigint) => Quantidade.deMilesimos(m, 'mg')
const ampola = (m: bigint) => Quantidade.deMilesimos(m, 'ampola')
const caixa = (m: bigint) => Quantidade.deMilesimos(m, 'caixa')

describe('paraMedida — a conversão vem do CADASTRO', () => {
  it('mg vira ampola pelo `fatorUso` do item: 2,5 mg = 0,5 ampola', () => {
    expect(exigir(paraMedida(mg(2_500n), FRASCO)).milesimos).toBe(500n)
  })

  it('caixa vira ampola pelo `fatorCompra`: 2 caixas = 8 ampolas', () => {
    expect(exigir(paraMedida(caixa(2_000n), FRASCO)).milesimos).toBe(8_000n)
  })

  it('a própria `medida` atravessa sem conversão', () => {
    expect(exigir(paraMedida(ampola(1_500n), FRASCO)).milesimos).toBe(1_500n)
  })

  it('UNIDADE DESCONHECIDA LANÇA ERRO — nunca converte em silêncio (regra 10)', () => {
    // `UI` é unidade de dose de outro item. Sem esta recusa, o número passaria
    // como se fosse ampola, e a dose aplicada seria mil vezes a prescrita.
    const r = paraMedida(Quantidade.deMilesimos(20_000n, 'UI'), FRASCO)
    expect(ehErro(r) && r.erro.codigo).toBe('UnidadeNaoDeclarada')
    expect(ehErro(r) && r.erro.mensagem).toContain('UI')
  })

  it('a unidade de USO de um item que não a declarou é recusada', () => {
    // A seringa não tem `unidUso`. Mandar "mg" para ela é erro de cadastro ou
    // de corpo, e as duas coisas têm de parar aqui.
    expect(ehErro(paraMedida(mg(1_000n), SERINGA))).toBe(true)
  })

  it('conversão INEXATA é recusada, com a frase que manda conferir o cadastro', () => {
    // 1 mg com `fatorUso = 5` daria 0,2 ampola = 200 milésimos — exato. O caso
    // inexato é o que não divide: 1 ampola = 3 mg, dose de 1 mg → 1/3 ampola.
    const tres: ItemComUnidades = { ...FRASCO, fatorUso: 3_000n }
    const r = paraMedida(mg(1_000n), tres)
    expect(ehErro(r) && r.erro.codigo).toBe('ConversaoInexata')
  })

  it('IDA E VOLTA devolve exatamente o original, para toda dose exata', () => {
    /**
     * **CONSTRUÍDO, não sorteado.** A lição medida duas vezes neste projeto:
     * gerador uniforme não acha fronteira. O espaço que importa aqui é o das
     * doses que o `fatorUso` divide — e é ele que é varrido, inteiro.
     */
    for (const passo of [1n, 2n, 5n, 1_000n]) {
      const f = passo * 1_000n
      const item: ItemComUnidades = { ...FRASCO, fatorUso: f }
      for (const ampolas of [1n, 499n, 500n, 999n, 1_000n, 1_001n, 7_500n]) {
        const emUso = exigir(deMedidaParaExibicao(ampola(ampolas), item, 'uso'))
        const volta = exigir(paraMedida(emUso, item))
        expect(volta.milesimos, `fator ${f}, ${ampolas} milésimos de ampola`).toBe(ampolas)
      }
    }
  })
})

describe('baixaDoItem — a sobra de frasco aberto (regra 15)', () => {
  it('dose de 0,5 ampola num item que NÃO aproveita gera DOIS movimentos', () => {
    const b = exigir(baixaDoItem(mg(2_500n), FRASCO))
    expect(b.consumo.milesimos).toBe(500n)
    expect(b.descarte?.milesimos).toBe(500n)
    // **O FRASCO INTEIRO saiu da prateleira.** Nunca um arredondamento.
    expect(b.consumo.milesimos + (b.descarte?.milesimos ?? 0n)).toBe(MEDIDA_INTEIRA)
  })

  it('dose EXATAMENTE igual a uma medida não gera descarte de zero', () => {
    /**
     * A fronteira que o sorteio uniforme não distingue. Um descarte de zero é
     * uma linha de perda que a análise do estoque tem de explicar e que nunca
     * aconteceu.
     */
    const b = exigir(baixaDoItem(mg(5_000n), FRASCO))
    expect(b.consumo.milesimos).toBe(1_000n)
    expect(b.descarte).toBeNull()
  })

  it('dose de 1,5 ampola descarta 0,5 — sobe para a PRÓXIMA medida inteira', () => {
    // 7,5 mg = 1,5 ampola: dois frascos abertos, meia ampola jogada fora.
    const b = exigir(baixaDoItem(mg(7_500n), FRASCO))
    expect(b.consumo.milesimos).toBe(1_500n)
    expect(b.descarte?.milesimos).toBe(500n)
    expect(b.consumo.milesimos + b.descarte!.milesimos).toBe(2n * MEDIDA_INTEIRA)
  })

  it('item que APROVEITA a sobra gera UM movimento, mesmo em dose fracionária', () => {
    const b = exigir(baixaDoItem(mg(2_500n), FRASCO_APROVEITA))
    expect(b.consumo.milesimos).toBe(500n)
    expect(b.descarte).toBeNull()
  })

  it('item SEM unidade de uso nunca gera descarte de sobra', () => {
    /**
     * É a regra do protótipo (`sobraDescartada = !!usoItem(it) && !aproveita`),
     * e ela está certa: "sobra de frasco aberto" só existe onde há frasco de
     * que se tira dose. Numa seringa, arredondar para cima descartaria meia
     * seringa que ninguém abriu.
     */
    const meia: ItemComUnidades = { ...SERINGA, aproveitaSobra: false }
    const b = exigir(baixaDoItem(Quantidade.deMilesimos(500n, 'un.'), meia))
    expect(b.consumo.milesimos).toBe(500n)
    expect(b.descarte).toBeNull()
  })

  it('dose zero ou negativa é recusada', () => {
    expect(ehErro(baixaDoItem(mg(0n), FRASCO))).toBe(true)
    expect(ehErro(baixaDoItem(mg(-1_000n), FRASCO))).toBe(true)
  })

  /**
   * **A PROPRIEDADE, com o gerador ancorado nas fronteiras.**
   *
   * O invariante: consumo + descarte é **sempre** um múltiplo exato de uma
   * medida inteira, e é o MENOR múltiplo que cobre a dose. Isto é o que
   * garante que o estoque baixa frascos inteiros — e é onde um `Math.ceil` em
   * ponto flutuante erraria por um milésimo em dose grande.
   *
   * O gerador sorteia o resto DENTRO de uma medida de propósito (0 incluído,
   * `MEDIDA_INTEIRA − 1` incluído): sorteando em `[1, 10^9]` o resto zero
   * praticamente nunca sai, e é justamente ele que distingue "não cria
   * descarte" de "cria um descarte de zero".
   */
  it('PROPRIEDADE: consumo + descarte é o menor múltiplo de medida que cobre a dose', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 500n }),
        fc.bigInt({ min: 0n, max: MEDIDA_INTEIRA - 1n }),
        (inteiras, resto) => {
          const emMedida = inteiras * MEDIDA_INTEIRA + resto
          if (emMedida === 0n) return
          // A dose viaja em mg para que a conversão do cadastro participe.
          const emUso = exigir(deMedidaParaExibicao(ampola(emMedida), FRASCO, 'uso'))
          const b = exigir(baixaDoItem(emUso, FRASCO))
          const total = b.consumo.milesimos + (b.descarte?.milesimos ?? 0n)

          expect(b.consumo.milesimos).toBe(emMedida)
          expect(total % MEDIDA_INTEIRA).toBe(0n)
          expect(total).toBeGreaterThanOrEqual(emMedida)
          expect(total - emMedida).toBeLessThan(MEDIDA_INTEIRA)
          // E o descarte existe se e somente se há resto.
          expect(b.descarte === null).toBe(resto === 0n)
        },
      ),
      { numRuns: 400 },
    )
  })
})

/* ======================================================================
 * SALDO DERIVADO (regra 11)
 * ====================================================================== */

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

describe('saldoEmMedida — DERIVADO, nunca um campo (regra 11)', () => {
  it('sem movimento nenhum, o saldo é zero e o item está SEM CONTAGEM', () => {
    const s = saldoEmMedida([], 'ampola')
    expect(s.saldo.milesimos).toBe(0n)
    expect(s.semContagem).toBe(true)
  })

  it('a última CONTAGEM é o ponto de partida: o que veio antes dela é ignorado', () => {
    /**
     * É o que torna a contagem útil. Se as entradas anteriores continuassem
     * somando, a contagem física — que é a única medida real da prateleira —
     * viraria mais um palpite entre outros.
     */
    const s = saldoEmMedida(
      [
        mov('entrada', 10_000n, '2026-01-05'),
        mov('contagem', 4_000n, '2026-02-01'),
        mov('entrada', 2_000n, '2026-02-10'),
        mov('consumo', -1_000n, '2026-02-12'),
      ],
      'ampola',
    )
    expect(s.saldo.milesimos).toBe(5_000n)
    expect(s.semContagem).toBe(false)
  })

  it('a ordem de chegada NÃO altera o resultado — o cálculo ordena', () => {
    const linhas = [
      mov('consumo', -1_000n, '2026-02-12'),
      mov('entrada', 10_000n, '2026-01-05'),
      mov('entrada', 2_000n, '2026-02-10'),
      mov('contagem', 4_000n, '2026-02-01'),
    ]
    expect(saldoEmMedida(linhas, 'ampola').saldo.milesimos).toBe(5_000n)
    expect(saldoEmMedida([...linhas].reverse(), 'ampola').saldo.milesimos).toBe(5_000n)
  })

  it('CONTAGEM e ENTRADA no MESMO instante: a `sequencia` decide, sempre igual', () => {
    /**
     * **Não é caso hipotético.** Em Postgres `now()` é o instante da
     * TRANSAÇÃO, então `salvarItemEstoque` — que grava o item e a contagem
     * inicial juntos — e qualquer entrada escrita na mesma transação carregam
     * `em` **idêntico**. Sem o desempate monotônico, a entrada contaria ou não
     * conforme a ordem em que o `sort` resolvesse o empate, e o saldo do mesmo
     * item mudaria entre duas leituras.
     *
     * A medição desta ordem foi encontrada **por mutação**: apagar o terceiro
     * critério de `ordem` deixava as 30 asserções deste arquivo verdes.
     */
    const INSTANTE = '2026-02-01T09:00:00.000Z'
    const contagem = { ...mov('contagem', 4_000n, '2026-02-01'), em: INSTANTE, sequencia: 10n }
    const entrada = { ...mov('entrada', 2_000n, '2026-02-01'), em: INSTANTE, sequencia: 11n }

    // A entrada foi gravada DEPOIS da contagem: ela conta.
    expect(saldoEmMedida([contagem, entrada], 'ampola').saldo.milesimos).toBe(6_000n)
    // E a ordem em que as linhas chegam da consulta não muda nada.
    expect(saldoEmMedida([entrada, contagem], 'ampola').saldo.milesimos).toBe(6_000n)

    // Invertida a sequência, a contagem é a última e a entrada é anterior a
    // ela — logo NÃO conta. É o mesmo dado, outra ordem de gravação.
    const antes = { ...entrada, sequencia: 9n }
    expect(saldoEmMedida([contagem, antes], 'ampola').saldo.milesimos).toBe(4_000n)
    expect(saldoEmMedida([antes, contagem], 'ampola').saldo.milesimos).toBe(4_000n)
  })

  it('DUAS contagens no mesmo dia: vale a de `em` mais recente', () => {
    const a = mov('contagem', 4_000n, '2026-02-01')
    const b = { ...mov('contagem', 9_000n, '2026-02-01'), em: '2026-02-01T18:00:00.000Z' }
    expect(saldoEmMedida([a, b], 'ampola').saldo.milesimos).toBe(9_000n)
    expect(saldoEmMedida([b, a], 'ampola').saldo.milesimos).toBe(9_000n)
  })

  it('o ajuste soma com o SINAL que está gravado — os dois sentidos', () => {
    expect(
      saldoEmMedida([mov('contagem', 5_000n, '2026-02-01'), mov('ajuste', -500n, '2026-02-02')], 'ampola')
        .saldo.milesimos,
    ).toBe(4_500n)
    expect(
      saldoEmMedida([mov('contagem', 5_000n, '2026-02-01'), mov('ajuste', 500n, '2026-02-02')], 'ampola')
        .saldo.milesimos,
    ).toBe(5_500n)
  })

  it('o saldo pode ficar NEGATIVO, e ele não é clampado', () => {
    /**
     * **O protótipo faz `Math.max(0, …)` aqui, e isso apaga a informação.**
     *
     * Saldo negativo significa que a clínica registrou mais saída do que tinha
     * — lançamento duplicado, contagem errada ou consumo sem entrada. Mostrar
     * zero esconde o incidente exatamente onde ele seria visto, e é o mesmo
     * erro que o clamp do `Saldo em aberto` cometia antes do crédito.
     */
    const s = saldoEmMedida(
      [mov('contagem', 1_000n, '2026-02-01'), mov('consumo', -3_000n, '2026-02-02')],
      'ampola',
    )
    expect(s.saldo.milesimos).toBe(-2_000n)
    expect(s.saldo.ehNegativa()).toBe(true)
  })

  it('a COMPENSAÇÃO devolve o saldo ao ponto inicial, somando como qualquer linha', () => {
    const consumo = mov('consumo', -500n, '2026-02-02', '2027-03-31')
    const descarte = mov('descarte', -500n, '2026-02-02', '2027-03-31')
    const s = saldoEmMedida(
      [
        mov('contagem', 4_000n, '2026-02-01', '2027-03-31'),
        consumo,
        descarte,
        { ...mov('consumo', 500n, '2026-02-03', '2027-03-31'), compensaId: consumo.id },
        { ...mov('descarte', 500n, '2026-02-03', '2027-03-31'), compensaId: descarte.id },
      ],
      'ampola',
    )
    expect(s.saldo.milesimos).toBe(4_000n)
  })
})

describe('lotesComSaldo e loteSugerido — FIFO de validade (regra 15)', () => {
  it('os lotes saem em ordem de validade, e os zerados não aparecem', () => {
    const lotes = lotesComSaldo(
      [
        mov('contagem', 0n, '2026-01-01'),
        mov('entrada', 2_000n, '2026-01-02', '2027-06-30'),
        mov('entrada', 3_000n, '2026-01-03', '2026-12-31'),
        mov('entrada', 1_000n, '2026-01-04', '2026-09-30'),
        mov('consumo', -1_000n, '2026-01-05', '2026-09-30'),
      ],
      'ampola',
    )
    expect(lotes.map((l) => l.lote)).toEqual(['2026-12-31', '2027-06-30'])
    expect(lotes.map((l) => l.saldo.milesimos)).toEqual([3_000n, 2_000n])
  })

  it('o lote SUGERIDO é o que vence primeiro com saldo — é o FIFO inteiro', () => {
    const movs = [
      mov('contagem', 0n, '2026-01-01'),
      mov('entrada', 1_000n, '2026-01-02', '2027-06-30'),
      mov('entrada', 1_000n, '2026-01-03', '2026-09-30'),
    ]
    expect(loteSugerido(movs, 'ampola')).toBe('2026-09-30')
  })

  it('lote esgotado deixa de ser sugerido — o seguinte assume', () => {
    const movs = [
      mov('contagem', 0n, '2026-01-01'),
      mov('entrada', 1_000n, '2026-01-02', '2027-06-30'),
      mov('entrada', 1_000n, '2026-01-03', '2026-09-30'),
      mov('consumo', -1_000n, '2026-01-04', '2026-09-30'),
    ]
    expect(loteSugerido(movs, 'ampola')).toBe('2027-06-30')
  })

  it('item sem lote nenhum não sugere nada — e isso não é um erro', () => {
    expect(loteSugerido([mov('contagem', 5_000n, '2026-01-01')], 'ampola')).toBeNull()
  })

  it('a CONTAGEM zera a história de lote: o que foi contado é o que existe', () => {
    /**
     * A contagem é um ponto de partida também por lote. Sem isto, um lote que
     * a equipe não encontrou na prateleira continuaria sendo sugerido para a
     * próxima dose — e a enfermagem procuraria um frasco que não está lá.
     */
    const lotes = lotesComSaldo(
      [
        mov('entrada', 5_000n, '2026-01-02', '2026-09-30'),
        mov('contagem', 2_000n, '2026-02-01', '2027-06-30'),
      ],
      'ampola',
    )
    expect(lotes.map((l) => l.lote)).toEqual(['2027-06-30'])
  })
})

describe('sinalDoTipo — o sinal é do TIPO, nunca um campo livre', () => {
  it('entrada soma; consumo, descarte e interno subtraem; contagem reinicia', () => {
    expect(sinalDoTipo('entrada')).toBe(1)
    expect(sinalDoTipo('consumo')).toBe(-1)
    expect(sinalDoTipo('descarte')).toBe(-1)
    expect(sinalDoTipo('interno')).toBe(-1)
    expect(sinalDoTipo('contagem')).toBe(0)
    // `ajuste` é o único dos dois sentidos, e por isso ele é `null`: quem o
    // grava carrega o sinal no próprio valor.
    expect(sinalDoTipo('ajuste')).toBeNull()
  })
})

describe('deMedidaParaExibicao', () => {
  it('ampola vira mg e caixa pelos fatores do cadastro', () => {
    expect(exigir(deMedidaParaExibicao(ampola(1_500n), FRASCO, 'uso')).formatar()).toBe('7,5 mg')
    expect(exigir(deMedidaParaExibicao(ampola(8_000n), FRASCO, 'compra')).formatar()).toBe('2 caixa')
  })

  it('item que não declarou a unidade devolve ERRO, não um palpite', () => {
    expect(ehErro(deMedidaParaExibicao(Quantidade.deMilesimos(1_000n, 'un.'), SERINGA, 'uso'))).toBe(
      true,
    )
  })

  it('o resultado é exatamente reversível por `paraMedida`', () => {
    const emUso = exigir(deMedidaParaExibicao(ampola(2_500n), FRASCO, 'uso'))
    expect(ehOk(paraMedida(emUso, FRASCO))).toBe(true)
    expect(exigir(paraMedida(emUso, FRASCO)).milesimos).toBe(2_500n)
  })
})
