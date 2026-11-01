import {
  Quantidade,
  deCompraParaMedida,
  deMedidaParaCompra,
  deMedidaParaUso,
  deUsoParaMedida,
} from './quantidade'
import { erro, erroDe, ok, type Result } from './resultado'

/**
 * O ESTOQUE, na aritmética — puro, sem I/O, sem framework.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * AS TRÊS UNIDADES, E POR QUE ELAS MORAM NO CADASTRO
 *
 *   1 unidCompra = fatorCompra × medida      (1 caixa  = 4 ampolas)
 *   1 medida     = fatorUso    × unidUso     (1 ampola = 5 mg)
 *
 * **`medida` é a unidade de estoque, e saldo é SEMPRE em `medida`.** A entrada
 * pode ser lançada em caixas, a contagem é em ampolas e a dose em mg — e os
 * três entram por uma porta só, `paraMedida`.
 *
 * Nenhum número de conversão aparece neste arquivo (regra 9). O único inteiro
 * declarado aqui é `MEDIDA_INTEIRA`, que não é fator de item nenhum: é a
 * definição de "uma unidade da medida, em milésimos", a mesma constante que
 * `Quantidade` usa para formatar.
 * ────────────────────────────────────────────────────────────────────────────
 */

/**
 * Uma unidade de `medida`, em milésimos.
 *
 * `Quantidade` guarda milésimos da unidade declarada; então uma ampola inteira
 * é `1000n`, e meia ampola é `500n`. É esta constante — e não um fator de item
 * — que define onde o frasco "acaba", e por isso a sobra arredonda para o
 * próximo múltiplo dela.
 */
export const MEDIDA_INTEIRA = 1_000n

/**
 * O cadastro de unidades de um item, como ele sai do banco.
 *
 * As duas conversões viajam em PARES, e o tipo as amarra: `unidCompra` sem
 * `fatorCompra` seria uma conversão meio declarada, e a migration diz a mesma
 * coisa com um `CHECK`. Quem cadastrou "caixa" sem dizer quantas ampolas vêm
 * nela não cadastrou conversão nenhuma.
 */
export type ItemComUnidades = {
  /** A unidade de estoque. Saldo, contagem e todo movimento são nela. */
  readonly medida: string
  readonly unidCompra: string | null
  /** 1 unidCompra = fatorCompra × medida, em milésimos. */
  readonly fatorCompra: bigint | null
  readonly unidUso: string | null
  /** 1 medida = fatorUso × unidUso, em milésimos. */
  readonly fatorUso: bigint | null
  /**
   * `false` = a sobra do frasco aberto **não** é usada no próximo paciente, e
   * a baixa gera um descarte junto (regra 15).
   */
  readonly aproveitaSobra: boolean
}

const fatores = (i: ItemComUnidades) => ({
  compraParaMedida: i.fatorCompra ?? 0n,
  medidaParaUso: i.fatorUso ?? 0n,
})

const unidadeNaoDeclarada = (q: Quantidade, i: ItemComUnidades) =>
  erro(
    erroDe(
      'UnidadeNaoDeclarada',
      `"${q.unidade}" não é uma unidade declarada deste item. ` +
        `Ele conta em ${i.medida}` +
        `${i.unidCompra === null ? '' : `, compra em ${i.unidCompra}`}` +
        `${i.unidUso === null ? '' : `, aplica em ${i.unidUso}`}. ` +
        `Confira as unidades de medida no cadastro do item.`,
    ),
  )

/**
 * Converte qualquer quantidade **declarada no cadastro** para `medida`.
 *
 * É a única porta pela qual quantidade entra no estoque — da nota (caixas), da
 * contagem (medida) ou da dose (uso). Unidade que o item não declarou é
 * **erro**, nunca uma conversão em silêncio (regra 10): o silêncio aqui é a
 * dose mil vezes maior aplicada em alguém.
 */
export function paraMedida(q: Quantidade, i: ItemComUnidades): Result<Quantidade> {
  if (q.unidade === i.medida) return ok(q)
  if (i.unidUso !== null && q.unidade === i.unidUso) {
    return deUsoParaMedida(q, fatores(i), i.medida)
  }
  if (i.unidCompra !== null && q.unidade === i.unidCompra) {
    return deCompraParaMedida(q, fatores(i), i.medida)
  }
  return unidadeNaoDeclarada(q, i)
}

/**
 * O caminho de volta, **só para exibir** — a tela mostra "0,5 ampola · 2,5 mg",
 * que é a frase do MANUAL.
 *
 * Nenhuma escrita passa por aqui: o que se grava é `medida`. Um caminho de
 * escrita por esta função seria a segunda representação do mesmo saldo.
 */
export function deMedidaParaExibicao(
  q: Quantidade,
  i: ItemComUnidades,
  destino: 'uso' | 'compra',
): Result<Quantidade> {
  if (destino === 'uso') {
    if (i.unidUso === null) {
      return erro(
        erroDe('UnidadeNaoDeclarada', 'Este item não tem unidade de uso no cadastro.'),
      )
    }
    return deMedidaParaUso(q, fatores(i), i.unidUso)
  }
  if (i.unidCompra === null) {
    return erro(erroDe('UnidadeNaoDeclarada', 'Este item não tem unidade de compra no cadastro.'))
  }
  return deMedidaParaCompra(q, fatores(i), i.unidCompra)
}

/**
 * A BAIXA DE UMA DOSE: o consumo, e o descarte da sobra quando ele existe.
 *
 * **Dois movimentos, nunca um arredondamento** (regra 15): abrir o frasco de
 * 5 mg para aplicar 2,5 mg tira **o frasco inteiro** da prateleira; 2,5 mg vão
 * na paciente e 2,5 mg são perda explicada. Somar os dois num movimento só
 * apagaria a distinção entre "aplicado" e "jogado fora" — que é justamente o
 * que a análise do estoque mede.
 *
 * **A sobra exige `unidUso` declarado**, e esta é a regra do protótipo
 * (`sobraDescartada = !!usoItem(it) && it.aproveitaSobra === false`). Ela está
 * certa: "sobra de frasco aberto" só existe onde há frasco de que se tira
 * dose. Num descartável, arredondar para cima descartaria meia seringa que
 * ninguém abriu.
 */
export type Baixa = {
  readonly consumo: Quantidade
  /** `null` quando a dose fecha medidas inteiras, ou o item aproveita a sobra. */
  readonly descarte: Quantidade | null
}

export function baixaDoItem(dose: Quantidade, i: ItemComUnidades): Result<Baixa> {
  const emMedida = paraMedida(dose, i)
  if (emMedida.tipo === 'erro') return emMedida

  const q = emMedida.valor
  if (q.milesimos <= 0n) {
    return erro(erroDe('QuantidadeInvalida', 'A quantidade precisa ser maior que zero.'))
  }

  const geraSobra = i.unidUso !== null && !i.aproveitaSobra
  const resto = q.milesimos % MEDIDA_INTEIRA
  if (!geraSobra || resto === 0n) return ok({ consumo: q, descarte: null })

  return ok({
    consumo: q,
    descarte: Quantidade.deMilesimos(MEDIDA_INTEIRA - resto, i.medida),
  })
}

/* ======================================================================
 * SALDO DERIVADO (regra 11)
 * ====================================================================== */

export const TIPOS_DE_MOVIMENTO = [
  'contagem',
  'entrada',
  'consumo',
  'descarte',
  'interno',
  'ajuste',
] as const
export type TipoDeMovimento = (typeof TIPOS_DE_MOVIMENTO)[number]

/**
 * O sinal **do tipo**, e não um campo que alguém digita.
 *
 * `0` = a contagem não soma, ela **reinicia**. `null` = `ajuste`, o único dos
 * dois sentidos, que carrega o sinal no próprio valor — é como a migration o
 * grava, e é o que faz "faltou 1" e "sobrou 1" caberem num tipo só.
 *
 * O protótipo tem uma coluna `sinal` só para o ajuste, e o resto deriva de um
 * `if` encadeado (`sinalMov`). Aqui o valor gravado já é o signed, então esta
 * função existe para VALIDAR a escrita, não para somar a leitura.
 */
export function sinalDoTipo(tipo: TipoDeMovimento): 1 | -1 | 0 | null {
  if (tipo === 'entrada') return 1
  if (tipo === 'contagem') return 0
  if (tipo === 'ajuste') return null
  return -1
}

/**
 * Um movimento, na forma mínima que o cálculo precisa.
 *
 * `milesimos` já vem **assinado e em `medida`** — é assim que a migration o
 * grava, e é o que faz o saldo ser uma soma em vez de um `switch`.
 */
export type MovimentoDeEstoque = {
  readonly id: string
  readonly tipo: TipoDeMovimento
  /** Assinado, em milésimos de `medida`. */
  readonly milesimos: bigint
  /** Dia civil no fuso da clínica, `aaaa-mm-dd`. */
  readonly dia: string
  /** Instante UTC, para desempatar dois movimentos do mesmo dia. */
  readonly em: string
  /**
   * A ORDEM DE GRAVAÇÃO, monotônica por clínica — o último desempate.
   *
   * Ela não é luxo: em Postgres `now()` é o instante da TRANSAÇÃO, então toda
   * linha escrita junta compartilha `em` **exatamente**. A baixa de uma sessão
   * grava consumo e descarte na mesma transação; `salvarItemEstoque` grava o
   * item e a contagem inicial na mesma. Sem um desempate monotônico, uma
   * contagem e uma entrada do mesmo instante ordenariam de forma arbitrária, e
   * o saldo mudaria entre duas leituras do mesmo dado — a entrada contaria ou
   * não contaria conforme o humor do `sort`.
   *
   * No banco é um `bigserial`. O protótipo faz o mesmo extraindo o número do
   * id (`movSeq`), o que funciona lá porque o id dele é `em` + contador.
   */
  readonly sequencia: bigint
  /** A validade do lote (`aaaa-mm-dd`), ou `null` quando o item não controla. */
  readonly lote: string | null
  /** O movimento que esta linha reverte. Nulo em tudo que não é compensação. */
  readonly compensaId?: string | null
}

/**
 * A ORDEM CANÔNICA: `(dia, em, sequencia)`.
 *
 * `dia` primeiro porque é a data de NEGÓCIO — o lançamento retroativo de uma
 * entrada de ontem conta antes da contagem de hoje, mesmo tendo sido digitado
 * depois. `sequencia` por último para que a ordem seja **total**: ver a nota em
 * `MovimentoDeEstoque.sequencia`.
 */
const ordem = (a: MovimentoDeEstoque, b: MovimentoDeEstoque): number =>
  a.dia.localeCompare(b.dia) ||
  a.em.localeCompare(b.em) ||
  (a.sequencia < b.sequencia ? -1 : a.sequencia > b.sequencia ? 1 : 0)

/** Os movimentos a partir da última contagem (inclusive), já ordenados. */
function desdeAUltimaContagem(movs: readonly MovimentoDeEstoque[]): {
  readonly contagem: MovimentoDeEstoque | null
  readonly depois: readonly MovimentoDeEstoque[]
} {
  const ordenados = [...movs].sort(ordem)
  let corte = -1
  for (const [i, m] of ordenados.entries()) if (m.tipo === 'contagem') corte = i
  if (corte === -1) return { contagem: null, depois: ordenados }
  return { contagem: ordenados[corte]!, depois: ordenados.slice(corte + 1) }
}

export type SaldoDoItem = {
  readonly saldo: Quantidade
  /**
   * Nunca houve contagem neste item.
   *
   * A tela usa isto para o aviso "itens sem contagem inicial" do MANUAL
   * (cap. 12) — sem ele, um item recém-importado mostraria saldo zero como se
   * alguém tivesse ido à prateleira e encontrado zero.
   */
  readonly semContagem: boolean
}

/**
 * **última Contagem + entradas − saídas ± ajustes** (regra 11).
 *
 * Nunca um campo. Um `itens.saldo` gravado seria um segundo número para a
 * mesma pergunta, e o segundo é o que fica errado — é a mesma razão pela qual
 * `programas` não guarda `recebido`.
 *
 * **O saldo NÃO é clampado em zero**, e isto diverge do protótipo
 * (`Math.max(0, …)` em `saldoItem`). Saldo negativo significa mais saída
 * registrada do que havia — lançamento duplicado, contagem errada, ou consumo
 * sem entrada. Mostrar zero esconde o incidente exatamente onde ele seria
 * visto.
 */
export function saldoEmMedida(
  movs: readonly MovimentoDeEstoque[],
  medida: string,
): SaldoDoItem {
  const { contagem, depois } = desdeAUltimaContagem(movs)
  const inicial = contagem?.milesimos ?? 0n
  const total = depois.reduce((s, m) => s + m.milesimos, inicial)
  return { saldo: Quantidade.deMilesimos(total, medida), semContagem: contagem === null }
}

export type LoteComSaldo = { readonly lote: string; readonly saldo: Quantidade }

/**
 * Os lotes com saldo positivo, **em ordem de validade** — o FIFO inteiro.
 *
 * A última contagem reinicia a história por lote também, e isso importa: um
 * lote que a equipe não encontrou na prateleira deixa de ser oferecido para a
 * próxima dose. Sem isso, a enfermagem procuraria um frasco que não está lá.
 *
 * **O que esta função deliberadamente NÃO faz:** distribuir uma saída sem lote
 * informado entre os lotes que vencem antes. O protótipo faz isso em
 * `validadesItem`, e o efeito é um saldo por lote que não corresponde a
 * movimento nenhum — o número muda quando alguém informa o lote de uma saída
 * antiga. Aqui a saída **sempre** carrega o lote quando o item controla
 * validade (a migration cobra com um `CHECK`), e saída sem lote some do
 * agrupamento em vez de ser imputada a um lote que ninguém escolheu.
 */
export function lotesComSaldo(
  movs: readonly MovimentoDeEstoque[],
  medida: string,
): LoteComSaldo[] {
  const { contagem, depois } = desdeAUltimaContagem(movs)
  const porLote = new Map<string, bigint>()
  const somar = (lote: string | null, q: bigint) => {
    if (lote === null) return
    porLote.set(lote, (porLote.get(lote) ?? 0n) + q)
  }

  if (contagem !== null) somar(contagem.lote, contagem.milesimos)
  for (const m of depois) somar(m.lote, m.milesimos)

  return [...porLote.entries()]
    .filter(([, q]) => q > 0n)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([lote, q]) => ({ lote, saldo: Quantidade.deMilesimos(q, medida) }))
}

/**
 * O lote que **vence primeiro** entre os que têm saldo — FIFO de validade
 * (regra 15).
 *
 * É sugestão, e a tela deixa trocar: o MANUAL diz *"o lote vem sugerido pelo
 * que vence primeiro e pode ser trocado"*. `null` = o item não tem lote
 * nenhum, e isso não é erro.
 */
export function loteSugerido(
  movs: readonly MovimentoDeEstoque[],
  medida: string,
): string | null {
  return lotesComSaldo(movs, medida)[0]?.lote ?? null
}
