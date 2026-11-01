import { chaveDaContagem, type MovimentoDeEstoque, ordemDeMovimento } from './estoque'
import { Quantidade } from './quantidade'

/**
 * A ANÁLISE DO ESTOQUE e a CURVA ABC — puras, sem I/O.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * A REGRA 13, QUE É O PRODUTO INTEIRO DO MÓDULO
 *
 *   inicial + entradas − saídas ± ajustes = esperado
 *   diferença = contagem final − esperado
 *
 * **A diferença é RELATADA, nunca corrigida.** Ajustá-la automaticamente
 * destrói a única informação que justifica contar o estoque: é ela que mostra
 * à clínica que há saída sem registro. Não existe neste arquivo nenhum caminho
 * que escreva movimento — ele só compara.
 * ────────────────────────────────────────────────────────────────────────────
 */

export type AnaliseDaContagem = {
  /**
   * A contagem INICIAL da comparação, que é o ponto de partida.
   *
   * `null` = não havia contagem antes desta. Nesse caso não há esperado, e
   * `diferenca` é zero — é **inventário inicial**, não uma falta do tamanho do
   * estoque inteiro. Dizer "faltaram 10 ampolas" na primeira contagem seria
   * inventar uma perda no dia em que a clínica começou a usar a ferramenta.
   */
  readonly anterior: { readonly quantidade: Quantidade; readonly dia: string } | null
  readonly temEsperado: boolean
  /** Soma das entradas entre as duas contagens. Positiva. */
  readonly entradas: Quantidade
  /** Consumo + descarte + uso interno, em MÓDULO. Positiva. */
  readonly saidas: Quantidade
  /** Ajustes, ASSINADOS — é o único tipo dos dois sentidos. */
  readonly ajustes: Quantidade
  /** `anterior + entradas − saidas + ajustes`. */
  readonly esperado: Quantidade
  /** O total do grupo de contagem final: a soma de todos os lotes contados. */
  readonly contado: Quantidade
  /** `contado − esperado`. Negativo = faltou. **Nunca clampado.** */
  readonly diferenca: Quantidade
}

const SAIDAS = new Set(['consumo', 'descarte', 'interno'])

/** Os índices das linhas de um grupo de contagem, na ordem canônica. */
const indicesDoGrupo = (ordenados: readonly MovimentoDeEstoque[], chave: string): number[] =>
  ordenados.flatMap((m, i) =>
    m.tipo === 'contagem' && chaveDaContagem(m) === chave ? [i] : [],
  )

/**
 * O NÚCLEO DA ARITMÉTICA — entre dois grupos de contagem.
 *
 * Existe como função separada porque há **duas** perguntas com a mesma conta, e
 * elas escolhem bordas diferentes:
 *
 *  - *"o que aconteceu desde a última vez que contamos?"* — a contagem anterior
 *    IMEDIATA, que é a análise de uma contagem;
 *  - *"o que aconteceu neste mês?"* — a contagem do começo do mês contra a do
 *    fim, **ignorando as do meio**. Ignorar é o certo: uma contagem
 *    intermediária é outra MEDIÇÃO, nunca uma correção (regra 13), e tomá-la
 *    como ponto de partida esconderia a parte da perda que ela já tinha
 *    acusado.
 *
 * Duas implementações desta soma seriam duas respostas para "quanto faltou", e
 * a segunda é a que ficaria errada.
 */
function entreGrupos(
  ordenados: readonly MovimentoDeEstoque[],
  inicial: string | null,
  final: string,
  medida: string,
): AnaliseDaContagem | null {
  const q = (m: bigint) => Quantidade.deMilesimos(m, medida)
  const doFinal = indicesDoGrupo(ordenados, final)
  if (doFinal.length === 0) return null
  const comecaOFinal = doFinal[0]!
  const contado = doFinal.reduce((s, i) => s + ordenados[i]!.milesimos, 0n)

  const doInicial = inicial === null ? [] : indicesDoGrupo(ordenados, inicial)
  if (doInicial.length === 0) {
    return {
      anterior: null,
      temEsperado: false,
      entradas: q(0n),
      saidas: q(0n),
      ajustes: q(0n),
      esperado: q(0n),
      contado: q(contado),
      diferenca: q(0n),
    }
  }

  const terminaOInicial = doInicial[doInicial.length - 1]!
  const anterior = doInicial.reduce((s, i) => s + ordenados[i]!.milesimos, 0n)

  // ENTRE as duas contagens. `tipo !== 'contagem'` porque uma contagem do meio
  // não é entrada nem saída — ela é outra medição, e somá-la como delta
  // trocaria o ponto de partida por um número.
  const entre = ordenados
    .slice(terminaOInicial + 1, comecaOFinal)
    .filter((m) => m.tipo !== 'contagem')

  const soma = (p: (m: MovimentoDeEstoque) => boolean) =>
    entre.filter(p).reduce((s, m) => s + m.milesimos, 0n)

  const entradas = soma((m) => m.tipo === 'entrada')
  // Em MÓDULO: as saídas são gravadas negativas, e a tela mostra "−2 ampolas".
  // A compensação carrega o tipo da origem com o sinal oposto, então uma
  // sessão reaberta ZERA a saída por soma, sem a análise aprender tipo novo.
  const saidas = -soma((m) => SAIDAS.has(m.tipo))
  const ajustes = soma((m) => m.tipo === 'ajuste')
  const esperado = anterior + entradas - saidas + ajustes

  return {
    anterior: { quantidade: q(anterior), dia: ordenados[doInicial[0]!]!.dia },
    temEsperado: true,
    entradas: q(entradas),
    saidas: q(saidas),
    ajustes: q(ajustes),
    esperado: q(esperado),
    contado: q(contado),
    diferenca: q(contado - esperado),
  }
}

/**
 * A análise de **uma** contagem: o esperado, o contado e a diferença.
 *
 * `contagemId` é a chave do GRUPO — o id da `Contagem` quando ela veio da
 * lista, ou o id do próprio movimento quando foi uma contagem solta de
 * `movEstoque`.
 *
 * Devolve `null` quando a contagem não existe nos movimentos. Uma análise de
 * zeros no lugar do `null` apareceria na tela como "esperado 0, contado 0,
 * tudo certo".
 */
export function analiseDaContagem(
  movs: readonly MovimentoDeEstoque[],
  contagemId: string,
  medida: string,
): AnaliseDaContagem | null {
  const ordenados = [...movs].sort(ordemDeMovimento)
  const doFinal = indicesDoGrupo(ordenados, contagemId)
  if (doFinal.length === 0) return null

  // A contagem ANTERIOR é a última linha de contagem antes desta — e o grupo
  // dela, não só a linha.
  let anteriorEm = -1
  for (let i = 0; i < doFinal[0]!; i++) {
    if (ordenados[i]!.tipo === 'contagem') anteriorEm = i
  }
  const inicial = anteriorEm === -1 ? null : chaveDaContagem(ordenados[anteriorEm]!)
  return entreGrupos(ordenados, inicial, contagemId, medida)
}

export type AnaliseDoPeriodo = AnaliseDaContagem & {
  /** O dia da contagem INICIAL do período. */
  readonly deDia: string
  /** O dia da contagem FINAL do período. */
  readonly ateDia: string
}

/** Os grupos de contagem, na ordem canônica, com o dia de cada um. */
function gruposDeContagem(
  ordenados: readonly MovimentoDeEstoque[],
): { readonly chave: string; readonly dia: string }[] {
  const vistos = new Set<string>()
  const fora: { chave: string; dia: string }[] = []
  for (const m of ordenados) {
    if (m.tipo !== 'contagem') continue
    const k = chaveDaContagem(m)
    if (vistos.has(k)) continue
    vistos.add(k)
    fora.push({ chave: k, dia: m.dia })
  }
  return fora
}

/**
 * A ANÁLISE DE UM PERÍODO — e ela compara **duas contagens**, não dois dias.
 *
 * "inicial + entradas − saídas = esperado; diferença = contagem final −
 * esperado" só fecha se as duas pontas forem contagens: o esperado precisa de
 * um ponto de partida que alguém **viu na prateleira**. Com bordas de data, o
 * "inicial" seria um saldo derivado — e comparar um derivado com um contado
 * mede o acumulado desde a última contagem, não o período pedido.
 *
 * É o recorte do protótipo (`consumoItem`): a contagem **anterior ou igual** a
 * `de` (ou, na falta dela, a primeira dentro da janela), contra a última
 * contagem até `ate`. Sem duas contagens, a resposta é `null` — e a tela diz
 * "sem contagens no período", em vez de mostrar uma diferença que não
 * significa nada.
 */
export function analiseDoPeriodo(
  movs: readonly MovimentoDeEstoque[],
  de: string,
  ate: string,
  medida: string,
): AnaliseDoPeriodo | null {
  const ordenados = [...movs].sort(ordemDeMovimento)
  const grupos = gruposDeContagem(ordenados)

  /**
   * A INICIAL: a última contagem até `de`; na falta dela, a primeira dentro da
   * janela. É assim que o primeiro mês de uso da ferramenta — em que a
   * contagem inicial caiu DENTRO do período — ainda produz uma análise.
   *
   * **A busca é por ÍNDICE, não por `dia`**, e isto não é estilo. Duas
   * contagens do MESMO dia são o caso comum do primeiro dia de uso: a inicial
   * do cadastro e a primeira lista de contagem nascem as duas hoje. Com
   * `dia >= inicial.dia`, a "final" podia ser a que veio ANTES — e a análise
   * saía com o esperado e o contado trocados, acusando uma falta que era uma
   * sobra. Medido no ambiente local: `esperado 12 · final 10 · dif −2` para um
   * item cuja história era 10 → +4 → −1 → contado 12.
   */
  let inicialEm = -1
  // `dia < de`, e não `<=`: a contagem que cai NO primeiro dia do período é a
  // inicial DELE, não a de antes. O protótipo usa `<=` (`cs.filter(m => m.data
  // <= ini).pop()`), e com isso uma janela de um dia só — ou um mês com duas
  // contagens no dia 1º — escolhe a SEGUNDA como ponto de partida e devolve
  // "sem contagens". É o caso do primeiro dia de uso da ferramenta, em que a
  // contagem do cadastro e a primeira lista nascem as duas hoje.
  for (const [i, g] of grupos.entries()) if (g.dia < de) inicialEm = i
  if (inicialEm === -1) {
    inicialEm = grupos.findIndex((g) => g.dia >= de && g.dia <= ate)
  }
  const inicial = inicialEm === -1 ? undefined : grupos[inicialEm]
  if (inicial === undefined) return null

  // A FINAL: a última até `ate` que vem DEPOIS da inicial na ordem canônica.
  let finalEm = -1
  for (let i = inicialEm + 1; i < grupos.length; i++) {
    if (grupos[i]!.dia <= ate) finalEm = i
  }
  const final = finalEm === -1 ? undefined : grupos[finalEm]
  if (final === undefined) return null

  const a = entreGrupos(ordenados, inicial.chave, final.chave, medida)
  if (a === null) return null
  return { ...a, deDia: inicial.dia, ateDia: final.dia }
}

/* ======================================================================
 * CURVA ABC — quais itens são "alto valor" (MANUAL cap. 12)
 * ====================================================================== */

export type ClasseAbc = 'A' | 'B' | 'C'

/** O item na curva: `valor` = saldo × custo, na escala que o chamador quiser. */
export type ItemNaCurva = { readonly id: string; readonly valor: bigint }

/**
 * A classificação de Pareto do estoque: **A** até 80% do valor acumulado,
 * **B** até 95%, **C** o resto.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * DUAS DECISÕES, E AS DUAS FORAM MEDIDAS NO PROTÓTIPO
 *
 *  1. **O acumulado é o de ANTES do item** (`antes/tot < .8`). Com o
 *     acumulado DEPOIS, o item que sozinho vale 90% do estoque cairia em C, e
 *     "alto valor" deixaria de fora justamente o frasco mais caro da
 *     geladeira. O protótipo acerta isso, e a regra é copiada tal e qual.
 *
 *  2. **Valor não-positivo é C e não entra no total.** O protótipo clampa o
 *     saldo em zero, então valor negativo nunca existe lá. Aqui ele existe —
 *     `CONTEXT.md` diz que o saldo NÃO é clampado, porque negativo é
 *     incidente — e somá-lo ao total ENCOLHERIA o denominador: um item com
 *     lançamento duplicado promoveria todos os outros a "alto valor".
 *
 * **Aritmética inteira, sem divisão:** `antes/tot < 4/5` é `antes * 5 <
 * tot * 4`. Nenhum ponto flutuante perto de valor de estoque (regras 1 e 8).
 * ────────────────────────────────────────────────────────────────────────────
 */
export function curvaABC(itens: readonly ItemNaCurva[]): Map<string, ClasseAbc> {
  const fora = new Map<string, ClasseAbc>()
  const positivos = itens
    .filter((i) => i.valor > 0n)
    .sort((a, b) => (a.valor < b.valor ? 1 : a.valor > b.valor ? -1 : 0))
  for (const i of itens) fora.set(i.id, 'C')

  const total = positivos.reduce((s, i) => s + i.valor, 0n)
  if (total <= 0n) return fora

  let antes = 0n
  for (const i of positivos) {
    fora.set(i.id, antes * 5n < total * 4n ? 'A' : antes * 20n < total * 19n ? 'B' : 'C')
    antes += i.valor
  }
  return fora
}

/**
 * "Alto valor" como a tela o lê: o cadastro manda, e a curva decide o resto.
 *
 * `''` no cadastro = automático pela curva. É a mesma precedência do protótipo
 * (`it.altoValor==="sim" ? true : "nao" ? false : abc[it.id]==="A"`), e ela
 * existe porque a clínica sabe de coisas que o custo não diz — o item barato
 * que é controlado pela ANVISA é alto valor para quem conta a prateleira.
 */
export const ehAltoValor = (
  marcado: '' | 'sim' | 'nao',
  classe: ClasseAbc | undefined,
): boolean => (marcado === 'sim' ? true : marcado === 'nao' ? false : classe === 'A')
