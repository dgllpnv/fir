import { Dinheiro } from './dinheiro'
import { diasEntre } from './relogio'

/**
 * **A COBRANÇA DO CLIENTE FIRMARE** — dinheiro real que a Firmare fatura de um
 * `Cliente Firmare` (G3, spec `docs/superpowers/plans/g3-spec-metas-e-
 * lancamentos.md`, ADR 0015). Regras 1-7 do CLAUDE.md se aplicam de ponta a
 * ponta: tudo aqui é `bigint`/`Dinheiro`, nunca `number` perto de centavo.
 *
 * `PercentualCentesimos` existe porque a assinatura de referência do spec
 * (`aplicarDesconto(mensalidade: Dinheiro, percentual: number)`) foi reprovada
 * pelo gate de números (ADR 0015, Decisão 1): um `percentual: number` força
 * uma conversão para ponto flutuante em algum ponto da multiplicação por um
 * `bigint` de centavos — a mesma classe de bug que a regra 1 proíbe, do lado
 * do FATOR em vez do valor. `1000` = 10,00%; o intervalo válido é `[0, 10000]`.
 */
export type PercentualCentesimos = bigint

/**
 * Constrói um `PercentualCentesimos` válido, ou lança.
 *
 * `0` e `10000` são os dois extremos legítimos (0% e 100%, critério de borda
 * explícito do ADR 0015).
 */
export function criarPercentualCentesimos(valor: bigint): PercentualCentesimos {
  if (valor < 0n || valor > 10000n) {
    throw new Error(`percentual fora do intervalo [0, 10000] centésimos: ${valor}`)
  }
  return valor
}

/**
 * Divisão inteira com arredondamento para CIMA — `a` e `b` não-negativos.
 *
 * `(a + b - 1) / b` com divisão inteira de `bigint` trunca a fração para
 * baixo, e somar `b - 1` antes empurra qualquer resto para o próximo inteiro.
 * `b = 0n` não é um caso válido aqui (nunca ocorre: o divisor é sempre
 * `10000n`) e lançaria por divisão por zero do próprio `bigint`.
 */
function ceilDiv(a: bigint, b: bigint): bigint {
  return (a + b - 1n) / b
}

export type DescontoAplicado = {
  /**
   * O desconto do `Benefício de indicação`, arredondado SEMPRE para cima —
   * nunca a favor da Firmare cobrar mais que o percentual exato (ADR 0015,
   * Decisão 1; ADR 0013 §8).
   */
  readonly desconto: Dinheiro
  /** `mensalidade - desconto`. A cobrança final arredonda sempre para baixo. */
  readonly cobranca: Dinheiro
}

/**
 * Aplica um `Benefício de indicação` (desconto percentual) a uma `Mensalidade`.
 *
 * Fórmula exata do ADR 0015: `desconto = ceilDiv(mensalidade_centavos ×
 * percentual_centesimos, 10000)`, `cobranca = mensalidade_centavos − desconto`.
 *
 * Devolve as DUAS partes — nunca só a cobrança — porque o desconto também é
 * um registro auditável (o valor do `Benefício` efetivamente consumido).
 *
 * **Não é o caso da regra 2 do CLAUDE.md** ("ratear em N parcelas iguais,
 * `max − min <= 1`"): aqui há DUAS partes desiguais por desenho (o desconto é
 * tipicamente pequeno, a cobrança é o resto grande). O invariante que vale é
 * mais estreito — ver `cobranca-carteira.test.ts`: a soma é exata, e o
 * desconto nunca é menor que o piso da divisão exata (nunca arredonda a favor
 * da Firmare).
 */
export function aplicarDesconto(mensalidade: Dinheiro, percentual: PercentualCentesimos): DescontoAplicado {
  if (percentual < 0n || percentual > 10000n) {
    throw new Error(`percentual fora do intervalo [0, 10000] centésimos: ${percentual}`)
  }
  const mensalidadeCentavos = mensalidade.centavos
  if (mensalidadeCentavos < 0n) {
    throw new Error(`mensalidade não pode ser negativa: ${mensalidadeCentavos}`)
  }

  const descontoCentavos =
    percentual === 0n || mensalidadeCentavos === 0n ? 0n : ceilDiv(mensalidadeCentavos * percentual, 10000n)
  const cobrancaCentavos = mensalidadeCentavos - descontoCentavos

  return {
    desconto: Dinheiro.deCentavos(descontoCentavos),
    cobranca: Dinheiro.deCentavos(cobrancaCentavos),
  }
}

/* ──────────────────────────────────────────────────────────────────────────
 * MENSALIDADES (G8 1F) — `statusMensalidade` e `painelMensalidades` do
 * protótipo (`versoes/firmare-gestao-prototipo/index.html` L708-729), com os
 * ajustes 4, 7 e 8 do gate de números G8 e a D-22 item 12.
 *
 * Só datas civis `yyyy-MM-dd` entram aqui. O "hoje" chega de fora, já no fuso
 * da carteira (regra 24): nenhum `Date` local, nenhum relógio implícito.
 * ────────────────────────────────────────────────────────────────────────── */

const COMPETENCIA = /^(\d{4})-(\d{2})-01$/

/**
 * O vencimento de uma competência (`yyyy-MM-01`) para quem vence no dia
 * `diaVencimento` (1 a 31). **Regra 25:** dia 29, 30 ou 31 em mês curto cai
 * no último dia do mês — 31 em fevereiro de 2027 vence em 28/02, em 2028 em
 * 29/02. É a mesma conta do protótipo (`Math.min(dia, ult)`, L709 e L887).
 *
 * Lança para entrada impossível: a coluna tem `CHECK (1..31)` e a competência
 * é sempre o dia 1º (migration 0031). Chegar aqui com outra coisa é defeito de
 * quem chamou, não um caso de negócio.
 */
export function vencimentoDaCompetencia(competencia: string, diaVencimento: number): string {
  const m = COMPETENCIA.exec(competencia)
  if (!m) throw new Error(`competência precisa ser yyyy-MM-01: ${competencia}`)
  if (!Number.isInteger(diaVencimento) || diaVencimento < 1 || diaVencimento > 31) {
    throw new Error(`dia de vencimento fora de 1..31: ${diaVencimento}`)
  }
  const ano = Number(m[1])
  const mes = Number(m[2])
  // Dia 0 do mês seguinte = último dia deste. Aritmética de calendário em
  // UTC, sem fuso: a data é civil, não um instante.
  const ultimo = new Date(Date.UTC(ano, mes, 0)).getUTCDate()
  return `${m[1]}-${m[2]}-${String(Math.min(diaVencimento, ultimo)).padStart(2, '0')}`
}

/**
 * A situação de uma mensalidade, em ordem de prioridade.
 *
 * O protótipo tem também os textos de lembrete ("lembrete enviado em",
 * "lembrete atrasado", "lembrete será criado"). Eles dependem da tarefa de
 * lembrete de pagamento ($3, R11), que ainda não existe; até lá, a mensalidade
 * aberta e futura é `a_vencer`. `sem_valor` é o ajuste 8 do gate: uma cobrança
 * de R$ 0 (desconto de 100%) nunca aparece como "vencida há N dias".
 */
export type SituacaoDaMensalidade = 'vencida' | 'vence_hoje' | 'a_vencer' | 'paga' | 'sem_valor'

/** A ordem fixa dos baldes — a mesma em `porSituacao` e nos filtros da tela. */
export const SITUACOES_DA_MENSALIDADE: readonly SituacaoDaMensalidade[] = [
  'vencida',
  'vence_hoje',
  'a_vencer',
  'paga',
  'sem_valor',
]

/** Uma cobrança não cancelada, como o painel a enxerga. */
export type LinhaDeMensalidade = {
  readonly id: string
  readonly status: 'aberto' | 'pago'
  /** O valor COBRADO (snapshot, já com desconto) — nunca a mensalidade atual (ajuste 7). */
  readonly valor: Dinheiro
  readonly vencimento: string
}

/**
 * `dias` é `vencimento − hoje`: negativo quando já venceu ("vencida há
 * `−dias` dias"), zero no dia, positivo antes.
 */
export function situacaoDaMensalidade(
  linha: LinhaDeMensalidade,
  hoje: string,
): { readonly situacao: SituacaoDaMensalidade; readonly dias: number } {
  const dias = diasEntre(hoje, linha.vencimento)
  if (linha.status === 'pago') return { situacao: 'paga', dias }
  if (linha.valor.ehZero()) return { situacao: 'sem_valor', dias }
  if (dias === 0) return { situacao: 'vence_hoje', dias }
  if (dias < 0) return { situacao: 'vencida', dias }
  return { situacao: 'a_vencer', dias }
}

export type ResumoDasMensalidades = {
  readonly linhas: readonly { readonly id: string; readonly situacao: SituacaoDaMensalidade; readonly dias: number }[]
  /** Σ `valor` de TODAS as linhas recebidas — as mesmas que a resposta devolve (ADR 0015, achado 1). */
  readonly total: Dinheiro
  /** Σ das pagas da competência ("pagas da competência", não "recebido no mês" — ajuste 7). */
  readonly recebido: Dinheiro
  /** `total − recebido`. */
  readonly aReceber: Dinheiro
  readonly porSituacao: readonly {
    readonly situacao: SituacaoDaMensalidade
    readonly quantidade: number
    readonly valor: Dinheiro
  }[]
}

/**
 * Os totais do painel do mês, sempre do MESMO array de linhas. Toda soma passa
 * por `Dinheiro` (regra 1); por construção, Σ por situação = total.
 */
export function resumirMensalidades(linhas: readonly LinhaDeMensalidade[], hoje: string): ResumoDasMensalidades {
  const baldes = new Map<SituacaoDaMensalidade, { quantidade: number; valor: Dinheiro }>(
    SITUACOES_DA_MENSALIDADE.map((s) => [s, { quantidade: 0, valor: Dinheiro.zero() }]),
  )
  let total = Dinheiro.zero()
  const saida = linhas.map((l) => {
    const { situacao, dias } = situacaoDaMensalidade(l, hoje)
    const balde = baldes.get(situacao)!
    balde.quantidade += 1
    balde.valor = balde.valor.mais(l.valor)
    total = total.mais(l.valor)
    return { id: l.id, situacao, dias }
  })
  const recebido = baldes.get('paga')!.valor
  return {
    linhas: saida,
    total,
    recebido,
    aReceber: total.menos(recebido),
    porSituacao: SITUACOES_DA_MENSALIDADE.map((s) => ({ situacao: s, ...baldes.get(s)! })),
  }
}

/**
 * Receita recorrente (MRR) e ticket médio — gate de números G8 §3.2.
 *
 * A entrada é a `mensalidade` de CONTRATO (antes do desconto) dos clientes
 * `ativo` + `onboarding` do escopo. O ticket médio divide só pelos que têm
 * mensalidade > 0 (D-22 item 12 — divergência consciente do protótipo, L1279,
 * que põe o cliente de consultoria sem mensalidade no denominador), com
 * `Dinheiro.media` (meio para cima). Sem ninguém com mensalidade, `null`: a
 * média de nada não é R$ 0,00.
 */
export function receitaRecorrente(mensalidades: readonly Dinheiro[]): {
  readonly receita: Dinheiro
  readonly ticketMedio: Dinheiro | null
  readonly clientesComMensalidade: number
} {
  const positivas = mensalidades.filter((m) => m.ehMaiorQue(Dinheiro.zero()))
  const receita = positivas.reduce((acc, m) => acc.mais(m), Dinheiro.zero())
  return {
    receita,
    ticketMedio: positivas.length === 0 ? null : receita.media(positivas.length),
    clientesComMensalidade: positivas.length,
  }
}
