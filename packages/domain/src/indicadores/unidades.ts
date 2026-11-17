import { Dinheiro } from '../dinheiro'
import { percentualInteiro } from '../financeiro/visao-do-mes'
import { absoluto } from './aritmetica'

/**
 * As unidades de um KPI e a ESCALA de cada uma (I-2, regra 9).
 *
 * A escala mora nesta tabela, e só nela: um `× 100` dentro de uma função é
 * defeito mesmo quando o resultado está certo hoje. Todo valor de KPI é um
 * inteiro na menor unidade da linha — nunca `number`, nunca fração.
 */
export const UNIDADES_DE_KPI = ['reais', 'percentual', 'quantidade', 'dias', 'nota', 'horas'] as const
export type UnidadeDeKpi = (typeof UNIDADES_DE_KPI)[number]

export type EscalaDaUnidade = {
  /** O nome da menor unidade, que é o que o banco guarda. */
  readonly menorUnidade: 'centavos' | 'centesimos' | 'minutos'
  /** Quantas menores unidades fazem uma unidade de tela (1 real, 1%, 1 hora). */
  readonly porUnidade: bigint
  /** O domínio do valor, na menor unidade. `null` = sem limite naquele lado. */
  readonly minimo: bigint | null
  readonly maximo: bigint | null
}

export const ESCALA_DA_UNIDADE: Readonly<Record<UnidadeDeKpi, EscalaDaUnidade>> = {
  // `minimo: 0` em reais: o único KPI em reais que pode ser negativo é o
  // resultado do mês, e o catálogo o declara (`admiteNegativo`).
  reais: { menorUnidade: 'centavos', porUnidade: 100n, minimo: 0n, maximo: null },
  // Sem teto: "despesas fixas sobre o recebido" passa de 100% quando as fixas
  // passam do recebido. O teto de 100% das taxas "x de y" é do catálogo.
  percentual: { menorUnidade: 'centesimos', porUnidade: 100n, minimo: 0n, maximo: null },
  quantidade: { menorUnidade: 'centesimos', porUnidade: 100n, minimo: 0n, maximo: null },
  dias: { menorUnidade: 'centesimos', porUnidade: 100n, minimo: 0n, maximo: null },
  // Nota de 0 a 10, em centésimos.
  nota: { menorUnidade: 'centesimos', porUnidade: 100n, minimo: 0n, maximo: 1000n },
  // Só o banco de horas usa, e o valor do KPI é a soma dos saldos POSITIVOS (c.14).
  horas: { menorUnidade: 'minutos', porUnidade: 60n, minimo: 0n, maximo: null },
}

export const ehUnidadeDeKpi = (u: string): u is UnidadeDeKpi =>
  (UNIDADES_DE_KPI as readonly string[]).includes(u)

/**
 * O valor de um KPI: um inteiro na menor unidade, com a unidade colada.
 *
 * **Somar ou comparar unidades diferentes LANÇA** (I-2, regra 10). Não é um
 * `Result`: não há entrada de usuário que leve a isso, só código errado, e
 * converter em silêncio seria pior que parar.
 */
export class NumeroDoKpi {
  private constructor(
    readonly unidade: UnidadeDeKpi,
    readonly emMenorUnidade: bigint,
  ) {}

  static de(unidade: UnidadeDeKpi, emMenorUnidade: bigint): NumeroDoKpi {
    return new NumeroDoKpi(unidade, emMenorUnidade)
  }

  static deDinheiro(d: Dinheiro): NumeroDoKpi {
    return new NumeroDoKpi('reais', d.centavos)
  }

  static zero(unidade: UnidadeDeKpi): NumeroDoKpi {
    return new NumeroDoKpi(unidade, 0n)
  }

  private exigirMesmaUnidade(outro: NumeroDoKpi): void {
    if (outro.unidade !== this.unidade) {
      throw new Error(`Não é possível operar ${this.unidade} com ${outro.unidade}.`)
    }
  }

  mais(outro: NumeroDoKpi): NumeroDoKpi {
    this.exigirMesmaUnidade(outro)
    return new NumeroDoKpi(this.unidade, this.emMenorUnidade + outro.emMenorUnidade)
  }

  menos(outro: NumeroDoKpi): NumeroDoKpi {
    this.exigirMesmaUnidade(outro)
    return new NumeroDoKpi(this.unidade, this.emMenorUnidade - outro.emMenorUnidade)
  }

  /** -1, 0 ou 1. */
  comparar(outro: NumeroDoKpi): -1 | 0 | 1 {
    this.exigirMesmaUnidade(outro)
    return this.emMenorUnidade < outro.emMenorUnidade ? -1 : this.emMenorUnidade > outro.emMenorUnidade ? 1 : 0
  }

  emDinheiro(): Dinheiro {
    if (this.unidade !== 'reais') throw new Error(`${this.unidade} não é dinheiro.`)
    return Dinheiro.deCentavos(this.emMenorUnidade)
  }
}

/** Soma de lista pelo value object: lista vazia exige a unidade. */
export function somarNumeros(unidade: UnidadeDeKpi, xs: readonly NumeroDoKpi[]): NumeroDoKpi {
  return xs.reduce((s, x) => s.mais(x), NumeroDoKpi.zero(unidade))
}

/** O valor está no domínio da unidade? `admiteNegativo` vem do catálogo. */
export function dentroDoDominio(n: NumeroDoKpi, admiteNegativo = false): boolean {
  const e = ESCALA_DA_UNIDADE[n.unidade]
  if (!admiteNegativo && e.minimo !== null && n.emMenorUnidade < e.minimo) return false
  if (e.maximo !== null && n.emMenorUnidade > e.maximo) return false
  return true
}

/** Leva ao domínio. Só para PROJEÇÃO: valor medido fora do domínio é incidente (c.16). */
export function limitarAoDominio(n: NumeroDoKpi, admiteNegativo = false, teto: bigint | null = null): NumeroDoKpi {
  const e = ESCALA_DA_UNIDADE[n.unidade]
  let v = n.emMenorUnidade
  if (!admiteNegativo && e.minimo !== null && v < e.minimo) v = e.minimo
  const max = teto ?? e.maximo
  if (max !== null && v > max) v = max
  return NumeroDoKpi.de(n.unidade, v)
}

// ---------------------------------------------------------------------------
// ValorNaTela (I-34, appsec C7)
// ---------------------------------------------------------------------------

declare const MARCA: unique symbol

/**
 * O valor de um KPI como a resposta o carrega.
 *
 * **XOR por unidade** (appsec C7): em `reais`, o valor viaja SÓ em
 * `emDinheiro`, que está em `CAMPOS_MONETARIOS` e a redação apaga; `emNumero`
 * é sempre `null`. Nas outras unidades é o contrário. Se `emNumero` pudesse
 * carregar reais, o mesmo valor atravessaria por um nome que a lista não
 * conhece.
 *
 * Os dois viajam como TEXTO do inteiro na menor unidade da linha de
 * `ESCALA_DA_UNIDADE` (centavos, centésimos, minutos), pela mesma razão de
 * `dinheiroEmTexto`. Quem formata é `formatarValorNaTela`.
 *
 * `escala` (0–100) é a altura relativa **à série do próprio KPI** (appsec
 * C10), nunca a outro KPI: comparar com outra série devolveria a razão entre
 * dois absolutos.
 *
 * A marca de tipo faz de `valorNaTela` o ÚNICO construtor: um literal
 * `{ unidade: 'reais', emNumero: '120000', … }` não compila como
 * `ValorNaTela`. Em tempo de execução é um objeto simples.
 */
export type ValorNaTela = {
  readonly unidade: UnidadeDeKpi
  readonly emDinheiro: string | null
  readonly emNumero: string | null
  readonly percentualDaMeta: number | null
  readonly escala: number | null
} & { readonly [MARCA]: true }

/**
 * O único construtor de `ValorNaTela`.
 *
 * - `numero` `null` = sem dado (nunca zero).
 * - `alvo`: o alvo da meta vigente; dá `percentualDaMeta` inteiro, pela
 *   `percentualInteiro` da rota `/percentual` (números c.11a).
 * - `serie`: os valores da série do PRÓPRIO KPI; dá a `escala`.
 */
export function valorNaTela(
  unidade: UnidadeDeKpi,
  numero: NumeroDoKpi | null,
  alvo?: NumeroDoKpi | null,
  serie?: readonly (NumeroDoKpi | null)[],
): ValorNaTela {
  if (numero !== null && numero.unidade !== unidade) {
    throw new Error(`valorNaTela: número em ${numero.unidade} declarado como ${unidade}.`)
  }
  if (alvo != null && alvo.unidade !== unidade) {
    throw new Error(`valorNaTela: alvo em ${alvo.unidade} para um KPI em ${unidade}.`)
  }
  const texto = numero === null ? null : numero.emMenorUnidade.toString()
  const percentualDaMeta =
    numero === null || alvo == null ? null : percentualInteiro(numero.emMenorUnidade, alvo.emMenorUnidade)
  const v = {
    unidade,
    emDinheiro: unidade === 'reais' ? texto : null,
    emNumero: unidade === 'reais' ? null : texto,
    percentualDaMeta,
    escala: numero === null || serie === undefined ? null : escalaNaSerie(numero, serie),
  }
  // A marca só existe no tipo: este é o único ponto que a afirma.
  return v as ValorNaTela
}

/** O ponto de dia aguardando fechamento (I-29, números c.10): sem valor e sem escala. */
export const valorAguardando = (unidade: UnidadeDeKpi): ValorNaTela => valorNaTela(unidade, null)

function escalaNaSerie(numero: NumeroDoKpi, serie: readonly (NumeroDoKpi | null)[]): number | null {
  let maior = absoluto(numero.emMenorUnidade)
  for (const s of serie) {
    if (s === null) continue
    if (s.unidade !== numero.unidade) {
      throw new Error(`valorNaTela: série em ${s.unidade} para um KPI em ${numero.unidade}.`)
    }
    const a = absoluto(s.emMenorUnidade)
    if (a > maior) maior = a
  }
  if (maior === 0n) return 0
  return percentualInteiro(absoluto(numero.emMenorUnidade), maior)
}

// ---------------------------------------------------------------------------
// Formatador por unidade
// ---------------------------------------------------------------------------

const INTEIROS = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 })

/** `12345` centésimos → `"123,45"`; zeros à direita somem (`1250` → `"12,5"`). */
function centesimosEmTexto(v: bigint): string {
  const neg = v < 0n
  const a = absoluto(v)
  const inteiro = INTEIROS.format(a / 100n)
  const frac = (a % 100n).toString().padStart(2, '0').replace(/0+$/, '')
  return `${neg ? '-' : ''}${inteiro}${frac === '' ? '' : `,${frac}`}`
}

/** O texto de um valor de KPI, a partir da menor unidade. O front usa isto, nunca `toFixed`. */
export function formatarNumeroDoKpi(unidade: UnidadeDeKpi, emMenorUnidade: bigint): string {
  switch (unidade) {
    case 'reais':
      return Dinheiro.deCentavos(emMenorUnidade).formatar()
    case 'percentual':
      return `${centesimosEmTexto(emMenorUnidade)}%`
    case 'quantidade':
    case 'nota':
      return centesimosEmTexto(emMenorUnidade)
    case 'dias': {
      const t = centesimosEmTexto(emMenorUnidade)
      return `${t} ${emMenorUnidade === 100n ? 'dia' : 'dias'}`
    }
    case 'horas': {
      const neg = emMenorUnidade < 0n
      const a = absoluto(emMenorUnidade)
      const h = INTEIROS.format(a / 60n)
      const m = a % 60n
      return `${neg ? '-' : ''}${h}h${m === 0n ? '' : m.toString().padStart(2, '0')}`
    }
  }
}

/** `null` quando não há valor — ou quando a redação o apagou. */
export function formatarValorNaTela(v: Pick<ValorNaTela, 'unidade' | 'emDinheiro' | 'emNumero'>): string | null {
  const texto = v.unidade === 'reais' ? v.emDinheiro : v.emNumero
  return texto === null ? null : formatarNumeroDoKpi(v.unidade, BigInt(texto))
}
