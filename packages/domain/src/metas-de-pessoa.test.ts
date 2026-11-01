import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  INDICADORES,
  INDICADORES_AUTOMATICOS,
  INDICADOR_MANUAL,
  atingimentoDaMeta,
  ehIndicador,
  mediaDeAtingimento,
  nomeDoIndicador,
  percentualNoPrazo,
  tipoDoIndicador,
} from './metas-de-pessoa'

/**
 * **A TABELA DOS 8 INDICADORES, E OS DOIS QUE SÃO PERCENTUAIS.**
 *
 * Tudo aqui foi medido executando o `realizadoMeta` DO PROTÓTIPO contra
 * fixtures construídas — não lido de relatório. O que os números abaixo fixam:
 *
 *  - `1/3` é **33** e `2/3` é **67**: `Math.round`, meio para cima;
 *  - **lista vazia é `null`, nunca `0`** — "sem dado" e "nada no prazo" são
 *    perguntas diferentes, e um `0%` numa pessoa que não tinha tarefa no mês
 *    acusa alguém que não deixou nada atrasar;
 *  - a **média de atingimento** clampa CADA meta em 100 antes de somar: sem o
 *    clamp, 200% numa meta esconde 0% em outra, e a conversa 1:1 abre com um
 *    número que diz o contrário do mês.
 */

describe('a tabela dos indicadores', () => {
  it('tem os 8 automáticos mais o manual, na ORDEM do protótipo', () => {
    expect(INDICADORES.map((i) => i.chave)).toEqual([
      'agendamentos',
      'confirmacoes',
      'contatos',
      'orc_qtd',
      'orc_valor',
      'recebimentos',
      'tarefas_prazo',
      'contagens_prazo',
      'manual',
    ])
    expect(INDICADORES_AUTOMATICOS).toHaveLength(8)
    expect(INDICADORES_AUTOMATICOS).not.toContain(INDICADOR_MANUAL)
  })

  /** Os tipos medidos em `IND_PES`. `orc_valor` é o ÚNICO de dinheiro. */
  it('declara o tipo de cada um, e só `orc_valor` é dinheiro', () => {
    expect(Object.fromEntries(INDICADORES.map((i) => [i.chave, i.tipo]))).toEqual({
      agendamentos: 'qtd',
      confirmacoes: 'qtd',
      contatos: 'qtd',
      orc_qtd: 'qtd',
      orc_valor: 'valor',
      recebimentos: 'qtd',
      tarefas_prazo: 'pct',
      contagens_prazo: 'pct',
      manual: 'qtd',
    })
    expect(INDICADORES.filter((i) => i.tipo === 'valor').map((i) => i.chave)).toEqual(['orc_valor'])
    expect(INDICADORES.filter((i) => i.tipo === 'pct').map((i) => i.chave)).toEqual([
      'tarefas_prazo',
      'contagens_prazo',
    ])
  })

  it('tem os nomes que ela escreveu — é o que a equipe lê na tela', () => {
    expect(nomeDoIndicador('agendamentos')).toBe('Agendamentos feitos')
    expect(nomeDoIndicador('confirmacoes')).toBe('Confirmações feitas')
    expect(nomeDoIndicador('contatos')).toBe('Contatos com pacientes')
    expect(nomeDoIndicador('orc_qtd')).toBe('Orçamentos fechados (quantidade)')
    expect(nomeDoIndicador('orc_valor')).toBe('Orçamentos fechados (valor)')
    expect(nomeDoIndicador('recebimentos')).toBe('Recebimentos registrados')
    expect(nomeDoIndicador('tarefas_prazo')).toBe('Tarefas concluídas no prazo')
    expect(nomeDoIndicador('contagens_prazo')).toBe('Contagens de estoque no prazo')
    expect(nomeDoIndicador('manual')).toBe('Outra meta (lançamento manual)')
  })

  it('`ehIndicador` recusa chave inventada — e não a aceita em silêncio', () => {
    expect(ehIndicador('tarefas_prazo')).toBe(true)
    expect(ehIndicador('tarefas_prazos')).toBe(false)
    expect(ehIndicador('')).toBe(false)
    expect(ehIndicador('orcValor')).toBe(false)
  })

  it('`tipoDoIndicador` cobre a tabela inteira, sem padrão silencioso', () => {
    for (const i of INDICADORES) expect(tipoDoIndicador(i.chave)).toBe(i.tipo)
  })
})

// ---------------------------------------------------------------------------
// OS DOIS PERCENTUAIS
// ---------------------------------------------------------------------------

describe('percentualNoPrazo — `tarefas_prazo` e `contagens_prazo`', () => {
  /**
   * A FRONTEIRA, construída à mão. Cada linha é um caso medido no protótipo.
   *
   * Um gerador uniforme sobre `[0, 10000]` praticamente nunca produz `total=0`
   * nem `total=1`, que são os dois casos em que esta função decide algo — já
   * foram cinco vezes neste projeto.
   */
  it('a fronteira, caso a caso, como o protótipo devolve', () => {
    expect(percentualNoPrazo(0, 0)).toBe(null)
    expect(percentualNoPrazo(1, 0)).toBe(0)
    expect(percentualNoPrazo(1, 1)).toBe(100)
    expect(percentualNoPrazo(3, 1)).toBe(33)
    expect(percentualNoPrazo(3, 2)).toBe(67)
    expect(percentualNoPrazo(3, 0)).toBe(0)
    expect(percentualNoPrazo(3, 3)).toBe(100)
    // 7 tarefas, 1 no prazo: 14,28… → 14. Divisão inexata para BAIXO.
    expect(percentualNoPrazo(7, 1)).toBe(14)
    // 8 tarefas, 1 no prazo: 12,5 exato → meio PARA CIMA, como `Math.round`.
    expect(percentualNoPrazo(8, 1)).toBe(13)
    // 200 tarefas, 1 no prazo: 0,5 → 1. NÃO é zero: quem fez uma no prazo
    // num mês inteiro não aparece igual a quem não fez nenhuma.
    expect(percentualNoPrazo(200, 1)).toBe(1)
  })

  it('TOTAL ZERO É `null`, e isso não é o mesmo que 0%', () => {
    expect(percentualNoPrazo(0, 0)).toBe(null)
    // E 0% existe de verdade: uma tarefa, atrasada.
    expect(percentualNoPrazo(1, 0)).toBe(0)
  })

  /**
   * O gerador é ENVIESADO para a fronteira de propósito.
   *
   * `fc.nat({ max: 400 })` sozinho gasta a amostra em totais de três dígitos,
   * onde nada decide: a função é linear ali. Os pesos abaixo põem metade dos
   * casos em `total <= 3`, que é onde mora a clínica pequena de verdade — e
   * onde `null`, `0` e `100` se confundem.
   */
  const totalEnviesado = fc.oneof(
    { weight: 5, arbitrary: fc.integer({ min: 0, max: 3 }) },
    { weight: 2, arbitrary: fc.integer({ min: 4, max: 12 }) },
    { weight: 1, arbitrary: fc.integer({ min: 13, max: 400 }) },
  )
  const caso = totalEnviesado.chain((total) =>
    fc.tuple(fc.constant(total), fc.integer({ min: 0, max: Math.max(total, 0) })),
  )

  it('está sempre em [0, 100], e é `null` apenas quando não há denominador', () => {
    fc.assert(
      fc.property(caso, ([total, noPrazo]) => {
        const p = percentualNoPrazo(total, noPrazo)
        if (total === 0) {
          expect(p).toBe(null)
          return
        }
        expect(p).not.toBe(null)
        expect(p!).toBeGreaterThanOrEqual(0)
        expect(p!).toBeLessThanOrEqual(100)
      }),
      { numRuns: 3000 },
    )
  })

  /**
   * **A PROPRIEDADE QUE PEGA A MUTAÇÃO DO ARREDONDAMENTO.**
   *
   * `|200·noPrazo − p·2·total| <= total` diz que `p` é o inteiro MAIS PRÓXIMO
   * de `100·noPrazo/total`, em aritmética exata. Trocar o
   * arredondamento por `Math.floor` (ou por `Math.ceil`) sobrevive às duas
   * propriedades acima — a faixa continua `[0,100]` — e morre aqui.
   */
  it('é o inteiro MAIS PRÓXIMO da razão, provado sem ponto flutuante', () => {
    fc.assert(
      fc.property(caso, ([total, noPrazo]) => {
        const p = percentualNoPrazo(total, noPrazo)
        if (p === null) return
        const distancia = 200n * BigInt(noPrazo) - BigInt(p) * 2n * BigInt(total)
        expect(distancia <= BigInt(total)).toBe(true)
        expect(-distancia <= BigInt(total)).toBe(true)
      }),
      { numRuns: 3000 },
    )
  })

  it('é MONÓTONO: mais no prazo nunca baixa o percentual', () => {
    fc.assert(
      fc.property(
        totalEnviesado.filter((t) => t > 0),
        (total) => {
          let anterior = -1
          for (let k = 0; k <= total; k++) {
            const p = percentualNoPrazo(total, k)!
            expect(p).toBeGreaterThanOrEqual(anterior)
            anterior = p
          }
          // E as duas pontas são exatas, sempre.
          expect(percentualNoPrazo(total, 0)).toBe(0)
          expect(percentualNoPrazo(total, total)).toBe(100)
        },
      ),
      { numRuns: 400 },
    )
  })

  it('`noPrazo` maior que `total` é ERRO, não um percentual acima de 100', () => {
    // Não é um caso de dado: é um defeito de consulta (um `FILTER` mais largo
    // que o `WHERE`). Devolver 150% o esconderia dentro de uma barra.
    expect(() => percentualNoPrazo(3, 4)).toThrow()
    expect(() => percentualNoPrazo(-1, 0)).toThrow()
    expect(() => percentualNoPrazo(3, -1)).toThrow()
    expect(() => percentualNoPrazo(1.5, 1)).toThrow()
  })
})

// ---------------------------------------------------------------------------
// ATINGIMENTO
// ---------------------------------------------------------------------------

describe('atingimentoDaMeta', () => {
  it('é o realizado sobre a meta, e PASSA de 100 quando ela foi superada', () => {
    expect(atingimentoDaMeta(40n, 40n)).toBe(100)
    expect(atingimentoDaMeta(20n, 40n)).toBe(50)
    expect(atingimentoDaMeta(60n, 40n)).toBe(150)
    expect(atingimentoDaMeta(0n, 40n)).toBe(0)
  })

  it('meta zero ou negativa NÃO tem percentual — é `null`, nunca 0', () => {
    expect(atingimentoDaMeta(10n, 0n)).toBe(null)
    expect(atingimentoDaMeta(10n, -5n)).toBe(null)
  })

  it('realizado `null` (sem dado) é `null`, e não zero', () => {
    expect(atingimentoDaMeta(null, 40n)).toBe(null)
  })

  /**
   * Centavos acima de 2^53 — o caso que `Math.round(a/b*100)` erra.
   *
   * Não é faixa de clínica, e é exatamente por isso que o teste existe: a
   * função é a mesma para `orc_valor` em centavos e para `agendamentos` em
   * unidades, e a aritmética tem de ser exata nas duas.
   */
  it('é exato em centavos grandes, sem ponto flutuante no meio', () => {
    const meta = 9_007_199_254_740_993n
    expect(atingimentoDaMeta(meta, meta)).toBe(100)
    expect(atingimentoDaMeta(meta / 2n, meta)).toBe(50)
  })
})

describe('mediaDeAtingimento — a média da pessoa no mês', () => {
  it('ignora meta sem dado, e devolve `null` quando nenhuma tem', () => {
    expect(mediaDeAtingimento([null, null])).toBe(null)
    expect(mediaDeAtingimento([])).toBe(null)
    expect(mediaDeAtingimento([null, 50])).toBe(50)
  })

  /**
   * **O CLAMP EM 100 POR META, ANTES DA MÉDIA.** É o `Math.min(100, …)` dela.
   *
   * Sem o clamp, 200% e 0% viram 100% de média, e a pessoa que falhou metade
   * das metas abre a 1:1 com "meta cumprida". Com o clamp: 50%.
   */
  it('CLAMPA cada meta em 100 antes de somar', () => {
    expect(mediaDeAtingimento([200, 0])).toBe(50)
    expect(mediaDeAtingimento([100, 0])).toBe(50)
    expect(mediaDeAtingimento([1000, 1000])).toBe(100)
  })

  it('arredonda meio para cima, sem ponto flutuante', () => {
    // (33 + 34) / 2 = 33,5 → 34
    expect(mediaDeAtingimento([33, 34])).toBe(34)
    // (33 + 33 + 34) / 3 = 33,33… → 33
    expect(mediaDeAtingimento([33, 33, 34])).toBe(33)
  })

  it('está sempre em [0, 100]', () => {
    fc.assert(
      fc.property(
        fc.array(fc.oneof(fc.constant(null), fc.integer({ min: 0, max: 400 })), { maxLength: 12 }),
        (ps) => {
          const m = mediaDeAtingimento(ps)
          if (m === null) {
            expect(ps.every((p) => p === null)).toBe(true)
            return
          }
          expect(m).toBeGreaterThanOrEqual(0)
          expect(m).toBeLessThanOrEqual(100)
        },
      ),
      { numRuns: 2000 },
    )
  })
})
