import { percentualInteiro } from '../financeiro/visao-do-mes'
import { ehDiaDoCalendario, fimDoMes, somarDias } from '../relogio'
import { erro, erroDe, ok, type Result } from '../resultado'
import { absoluto, dividirMeioParaCima, type Fracao, fracao } from './aritmetica'
import type { Agregacao, Direcao } from './catalogo'
import { diasCorridosEntre, diasUteisDoConjunto, diasUteisEntre, type CorteDosDias } from './periodos'
import { dentroDoDominio, limitarAoDominio, NumeroDoKpi, type UnidadeDeKpi } from './unidades'

/**
 * Meta, ritmo, situação, progresso e projeção (I-16 a I-22). Puros: o
 * servidor calcula, a tela desenha (regra "o front não calcula").
 *
 * Toda comparação usa o ritmo EXATO, como fração (números c.7). Arredondar
 * só na exibição: com o ritmo arredondado, 33 centavos de uma meta de 100 em
 * 3 dias úteis passariam por "no ritmo".
 */

export const TIPOS_DE_META_DE_KPI = ['mes', 'ate_data', 'recorrente'] as const
export type TipoDeMetaDeKpi = (typeof TIPOS_DE_META_DE_KPI)[number]

export type MetaParaConta = {
  readonly agregacao: Agregacao
  readonly direcao: Direcao
  readonly inicio: string
  /** Inclusivo: o dia que a pessoa vê. Toda conta passa por `janelaDaMeta`. */
  readonly prazo: string
  readonly partida: NumeroDoKpi
  readonly alvo: NumeroDoKpi
}

/**
 * Até onde a meta foi medida.
 * - `string`: todos os dias de `inicio` até ele (as `soma` comuns: hoje).
 * - `CorteDosDias`: o `D`/`L` do faturamento conferido (I-9, números B1).
 * Depois do prazo, o corte é o prazo e a meta congela (I-16).
 */
export type CorteDaMeta = string | CorteDosDias

/** `[inicio, prazo + 1)`: o prazo é inclusivo na tela e exclusivo na conta. */
export function janelaDaMeta(inicio: string, prazo: string): Result<{ de: string; ate: string }> {
  if (!ehDiaDoCalendario(inicio) || !ehDiaDoCalendario(prazo)) {
    return erro(erroDe('DataInvalida', 'Escolha datas que existem no calendário.'))
  }
  if (inicio > prazo) return erro(erroDe('PrazoAntesDoInicio', 'O prazo é antes do início.'))
  return ok({ de: inicio, ate: somarDias(prazo, 1) })
}

/** Teto: `soma` ou `analise` com menor melhor ("perda até R$ 500"). */
export const ehMetaDeTeto = (m: Pick<MetaParaConta, 'agregacao' | 'direcao'>): boolean =>
  m.direcao === 'menor' && (m.agregacao === 'soma' || m.agregacao === 'analise')

/** A régua: dias úteis na `soma` (a da Visão do mês), corridos nas outras. Soma sem dia útil cai para corridos. */
function usaUteis(m: MetaParaConta): boolean {
  return m.agregacao === 'soma' && diasUteisEntre(m.inicio, m.prazo) > 0
}

/** `U`: os dias da régua de `inicio` a `prazo`. */
function totalDaRegua(m: MetaParaConta): bigint {
  return BigInt(usaUteis(m) ? diasUteisEntre(m.inicio, m.prazo) : diasCorridosEntre(m.inicio, m.prazo))
}

/** `u`: os dias da régua decorridos até o FIM do dia do corte, limitado ao prazo. */
function decorridosNaRegua(m: MetaParaConta, corte: CorteDaMeta): bigint {
  if (typeof corte === 'string') {
    const t = corte < m.prazo ? corte : m.prazo
    if (t < m.inicio) return 0n
    return BigInt(usaUteis(m) ? diasUteisEntre(m.inicio, t) : diasCorridosEntre(m.inicio, t))
  }
  if (corte.ultimo === null) return 0n
  const ate = corte.ultimo < m.prazo ? corte.ultimo : m.prazo
  if (usaUteis(m)) return BigInt(diasUteisDoConjunto(corte.dias, m.inicio, ate))
  return BigInt(new Set(corte.dias.filter((d) => d >= m.inicio && d <= ate)).size)
}

/** O último dia do corte, limitado ao prazo; `null` se nada foi medido. */
function ultimoDiaDoCorte(m: MetaParaConta, corte: CorteDaMeta): string | null {
  const t = typeof corte === 'string' ? corte : corte.ultimo
  if (t === null) return null
  return t < m.prazo ? t : m.prazo
}

function exigirUnidade(m: MetaParaConta, atual: NumeroDoKpi | null): UnidadeDeKpi {
  const u = m.alvo.unidade
  if (m.partida.unidade !== u) throw new Error(`meta com partida em ${m.partida.unidade} e alvo em ${u}`)
  if (atual !== null && atual.unidade !== u) throw new Error(`valor em ${atual.unidade} para meta em ${u}`)
  return u
}

/**
 * O ritmo esperado no FIM do dia do corte, sobre `[inicio, t + 1)` (números B2):
 * `partida + (alvo − partida) × u ÷ U`. Na `soma`, `partida = 0` e fica
 * `alvo × u ÷ U`.
 *
 * Propriedades (testadas): na véspera do início é a partida; no prazo é o
 * alvo; é monótono no tempo; fica entre partida e alvo.
 */
export function ritmoEsperado(meta: MetaParaConta, corte: CorteDaMeta): Fracao {
  exigirUnidade(meta, null)
  const U = totalDaRegua(meta)
  const u = decorridosNaRegua(meta, corte)
  const p = meta.partida.emMenorUnidade
  const a = meta.alvo.emMenorUnidade
  return fracao(p * U + (a - p) * u, U)
}

export type SituacaoDaMeta = 'atingida' | 'no_ritmo' | 'atencao' | 'abaixo' | 'sem_dado'

/**
 * A situação por multiplicação cruzada (números c.7), com `sinal = ±1` pela
 * direção e `avanço = |ritmo − partida|`:
 * - `no_ritmo` ⇔ `sinal·(atual − ritmo) ≥ 0`;
 * - `atencao`  ⇔ `10·sinal·(atual − ritmo) ≥ −avanço` (até 10% do avanço esperado abaixo);
 * - senão `abaixo`. Prazo vencido sem atingir é `abaixo`.
 *
 * `atingida`: maior melhor com `atual ≥ alvo`; menor melhor em `taxa`/`posicao`
 * com `atual ≤ alvo`; TETO só depois do prazo, e nunca com valor `null`
 * (números B4: "sem contagens" não é R$ 0).
 */
export function situacao(
  meta: MetaParaConta,
  atual: NumeroDoKpi | null,
  corte: CorteDaMeta,
  hoje: string,
): SituacaoDaMeta {
  exigirUnidade(meta, atual)
  if (atual === null) return 'sem_dado'
  const x = atual.emMenorUnidade
  const alvo = meta.alvo.emMenorUnidade
  const encerrada = hoje > meta.prazo

  if (ehMetaDeTeto(meta)) {
    if (encerrada) return x <= alvo ? 'atingida' : 'abaixo'
  } else if (meta.direcao === 'maior' ? x >= alvo : x <= alvo) {
    return 'atingida'
  }
  if (encerrada) return 'abaixo'

  const r = ritmoEsperado(meta, corte)
  const sinal = meta.direcao === 'maior' ? 1n : -1n
  const delta = sinal * (x * r.denominador - r.numerador)
  if (delta >= 0n) return 'no_ritmo'
  const avanco = absoluto(r.numerador - meta.partida.emMenorUnidade * r.denominador)
  return 10n * delta >= -avanco ? 'atencao' : 'abaixo'
}

const limitar = (v: bigint, min: bigint, max: bigint) => (v < min ? min : v > max ? max : v)

/**
 * Progresso inteiro de 0 a 100 (I-22).
 * - Comum: `(atual − partida) ÷ (alvo − partida)`, pela direção.
 * - Teto: `100 × fração de tempo × min(1, ritmo ÷ atual)` — gastar abaixo do
 *   ritmo é progresso; o tempo é a fração da régua já decorrida.
 */
export function progresso(meta: MetaParaConta, atual: NumeroDoKpi | null, corte: CorteDaMeta): number | null {
  exigirUnidade(meta, atual)
  if (atual === null) return null
  const x = atual.emMenorUnidade
  if (ehMetaDeTeto(meta)) {
    const U = totalDaRegua(meta)
    const u = decorridosNaRegua(meta, corte)
    const r = ritmoEsperado(meta, corte)
    // ritmo ÷ atual ≥ 1 ⇔ r.num ≥ r.den·atual
    const p =
      x <= 0n || r.numerador >= r.denominador * x
        ? dividirMeioParaCima(100n * u, U)
        : dividirMeioParaCima(100n * u * r.numerador, U * r.denominador * x)
    return Number(limitar(p, 0n, 100n))
  }
  // `validarMeta` recusa alvo igual à partida; uma linha antiga assim não tem progresso, e não divide por zero.
  if (meta.alvo.emMenorUnidade === meta.partida.emMenorUnidade) return null
  const f = fracao(100n * (x - meta.partida.emMenorUnidade), meta.alvo.emMenorUnidade - meta.partida.emMenorUnidade)
  return Number(limitar(dividirMeioParaCima(f.numerador, f.denominador), 0n, 100n))
}

export type ProjecaoDaMeta =
  | { readonly valor: NumeroDoKpi; readonly motivo: null }
  | {
      readonly valor: null
      readonly motivo: 'sem_dado' | 'cedo_para_projetar' | 'corte_no_inicio' | 'sem_projecao' | 'fonte_fora_do_dominio'
    }

export type DominioDoKpi = { readonly admiteNegativo: boolean; readonly teto: bigint | null }

/**
 * Onde o KPI chega no prazo (I-21).
 * - `soma`: `atual × U ÷ úteis(D)` (números B1). Sem dia decorrido: `null`.
 * - `taxa`/`posicao`/`media_mensal`: extrapolação linear desde a partida,
 *   limitada ao domínio. Com `corte = inicio`, `null` — nunca divisão por zero.
 * - `analise`: não projeta.
 * - **Valor medido fora do domínio** (negativo onde não cabe) NÃO é escondido
 *   por um `max`: volta `fonte_fora_do_dominio`, e o servidor registra o
 *   incidente (números c.16).
 */
export function projecao(
  meta: MetaParaConta,
  atual: NumeroDoKpi | null,
  corte: CorteDaMeta,
  dominio: DominioDoKpi,
): ProjecaoDaMeta {
  const unidade = exigirUnidade(meta, atual)
  if (atual === null) return { valor: null, motivo: 'sem_dado' }
  const foraDoTeto = dominio.teto !== null && atual.emMenorUnidade > dominio.teto
  if (!dentroDoDominio(atual, dominio.admiteNegativo) || foraDoTeto) {
    return { valor: null, motivo: 'fonte_fora_do_dominio' }
  }
  if (meta.agregacao === 'analise') return { valor: null, motivo: 'sem_projecao' }

  if (meta.agregacao === 'soma') {
    const d = decorridosNaRegua(meta, corte)
    if (d === 0n) return { valor: null, motivo: 'cedo_para_projetar' }
    const v = dividirMeioParaCima(atual.emMenorUnidade * totalDaRegua(meta), d)
    return { valor: limitarAoDominio(NumeroDoKpi.de(unidade, v), dominio.admiteNegativo, dominio.teto), motivo: null }
  }

  // A MESMA régua do ritmo (I-19, inclusiva, fim do dia): `u` e `U`. Com
  // outra régua, quem está exatamente no ritmo "passaria da meta" (V2).
  const decorridos = decorridosNaRegua(meta, corte)
  // `u = 0` não projeta (V2). E o 1º dia também não, por regra de PRODUTO
  // explícita (c.16): um dia só de taxa é ruído, e extrapolá-lo para o prazo
  // inteiro é o cartão mentir no dia em que a meta nasce.
  const t = ultimoDiaDoCorte(meta, corte)
  if (decorridos === 0n || t === null || t <= meta.inicio) return { valor: null, motivo: 'corte_no_inicio' }
  const total = totalDaRegua(meta)
  const p = meta.partida.emMenorUnidade
  const v = p + dividirMeioParaCima((atual.emMenorUnidade - p) * total, decorridos)
  return { valor: limitarAoDominio(NumeroDoKpi.de(unidade, v), dominio.admiteNegativo, dominio.teto), motivo: null }
}

/** Percentual da meta, INTEIRO, pela mesma função da rota `/percentual` (números c.11a). */
export function percentualDaMeta(atual: NumeroDoKpi | null, alvo: NumeroDoKpi): number | null {
  if (atual === null) return null
  if (atual.unidade !== alvo.unidade) throw new Error(`percentual de ${atual.unidade} sobre ${alvo.unidade}`)
  return percentualInteiro(atual.emMenorUnidade, alvo.emMenorUnidade)
}

// ---------------------------------------------------------------------------
// Validação da meta (422 na borda)
// ---------------------------------------------------------------------------

export type KpiParaValidarMeta = {
  readonly agregacao: Agregacao
  readonly direcao: Direcao
  readonly unidade: UnidadeDeKpi
  /** `resultado_do_mes` (números c.4). */
  readonly somenteMesCivil: boolean
  readonly admiteNegativo: boolean
  /** O teto do catálogo (100% nas taxas "x de y"): alvo acima dele nunca é atingível (V3). */
  readonly teto?: bigint | null
}

export type MetaParaValidar = {
  readonly tipo: TipoDeMetaDeKpi
  readonly inicio: string
  readonly prazo: string
  readonly partida: NumeroDoKpi
  readonly alvo: NumeroDoKpi
}

const ehMesCivilInteiro = (inicio: string, prazo: string) =>
  inicio.endsWith('-01') && prazo === fimDoMes(inicio.slice(0, 7))

/**
 * As recusas da meta, todas 422 na borda:
 * - prazo antes do início, data que não existe;
 * - `mes`/`recorrente` fora do mês civil inteiro;
 * - KPI só de mês civil (`resultado_do_mes`) com meta `ate_data` (números c.4);
 * - `soma`/`analise` com partida diferente de zero (I-17);
 * - alvo pior que a partida, ou igual (I-22): progresso sem avanço não existe;
 * - unidade trocada, ou valor fora do domínio da unidade.
 */
export function validarMeta(kpi: KpiParaValidarMeta, m: MetaParaValidar): Result<MetaParaValidar> {
  const j = janelaDaMeta(m.inicio, m.prazo)
  if (j.tipo === 'erro') return j
  if (m.alvo.unidade !== kpi.unidade || m.partida.unidade !== kpi.unidade) {
    return erro(erroDe('UnidadeDaMetaDiferente', 'A meta está numa unidade diferente da do KPI.'))
  }
  if ((m.tipo === 'mes' || m.tipo === 'recorrente') && !ehMesCivilInteiro(m.inicio, m.prazo)) {
    return erro(erroDe('MetaDoMesForaDoMes', 'Meta do mês vai do dia 1º ao último dia do mesmo mês.'))
  }
  if (kpi.somenteMesCivil && m.tipo === 'ate_data') {
    return erro(
      erroDe('ResultadoDoMesSoMesCivil', 'O resultado do mês só aceita meta de um mês inteiro (do mês ou recorrente).'),
    )
  }
  const acimaDoTeto = (n: NumeroDoKpi) => kpi.teto != null && n.emMenorUnidade > kpi.teto
  if (
    !dentroDoDominio(m.alvo, kpi.admiteNegativo) ||
    !dentroDoDominio(m.partida, kpi.admiteNegativo) ||
    acimaDoTeto(m.alvo) ||
    acimaDoTeto(m.partida)
  ) {
    return erro(erroDe('ValorForaDoDominio', 'O valor está fora do que esta unidade aceita.'))
  }
  const a = m.alvo.emMenorUnidade
  const p = m.partida.emMenorUnidade
  if (kpi.agregacao === 'soma' || kpi.agregacao === 'analise') {
    if (p !== 0n) return erro(erroDe('PartidaDaSomaNaoEZero', 'Na soma, a partida é sempre zero.'))
    const teto = ehMetaDeTeto(kpi)
    if (teto ? a < 0n : a <= 0n) return erro(erroDe('AlvoPiorQueAPartida', 'O alvo precisa ser maior que zero.'))
    return ok(m)
  }
  const melhor = kpi.direcao === 'maior' ? a > p : a < p
  if (!melhor) return erro(erroDe('AlvoPiorQueAPartida', 'O alvo precisa ser melhor que o valor de partida.'))
  return ok(m)
}
