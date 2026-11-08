import { erro, erroDe, ok, type ErroDeDominio, type Result } from './resultado'
import { diaCivil, diasEntre, somarDias } from './relogio'

/**
 * METAS DA CARTEIRA — o cálculo de M3 (ticket 2B), só domínio.
 *
 * Reproduz as REGRAS e os LIMIARES do protótipo
 * (`versoes/firmare-gestao-prototipo/index.html`: `agregar` L746,
 * `segundasDoMes` L747, `semanaDaReuniao` L750, `avaliarMeta` L751-780,
 * `barraMeta` L782, histórico L761 e L790), mas decide por **comparação
 * racional exata** (ajuste 16 do gate de números).
 *
 * Por quê: o protótipo compara `v/alvo >= esp*.9` em ponto flutuante. Com
 * alvo 100, 1 de 5 semanas passadas e acumulado 18, o valor exato é
 * `18/100 = 0,9 × 1/5` — "No ritmo" pela regra (L776) — e o float avalia
 * `0.18 >= 0.18000000000000002`, falso: "Atenção" (CE-2). A meta da cliente
 * trocaria de cor por um bit de arredondamento.
 *
 * ESCALA. Toda entrada numérica é um `bigint` na escala de armazenamento do
 * indicador, a mesma de `lancamentos_de_indicador`: `R$` em centavos, `un` e
 * `dias` em inteiros, `%` no inteiro que o indicador grava (centésimos de
 * ponto percentual, CONTEXT.md, "Lançamento de indicador"). Nenhum float
 * entra nem sai. A decisão de faixa é invariante de escala (multiplicar alvo,
 * inicial e lançamentos pelo mesmo k > 0 não muda nada — property test), então
 * a avaliação não precisa saber a unidade. A unidade só importa para recusar
 * combinações sem sentido (`validarModeloDeMeta`) e para arredondar a média na
 * exibição (`valorParaExibicao`).
 *
 * A média NÃO é arredondada antes de avaliar: trafega como o racional exato
 * `soma / n`. O protótipo arredonda a uma casa antes de comparar
 * (`Math.round(x*10)/10`, L746); arredondar e depois comparar é decidir com um
 * número que não foi medido.
 */

export type TipoDeMeta = 'mensal' | 'prazo'
export type AgregacaoDeMeta = 'soma' | 'media' | 'ultimo'
export type SentidoDeMeta = 'maior_melhor' | 'menor_melhor'
export type UnidadeDeMeta = 'R$' | 'un' | '%' | 'dias'

/** `referencia` é o dia civil `yyyy-MM-dd` da segunda-feira da semana. */
export type LancamentoDeMeta = { readonly referencia: string; readonly valor: bigint }

/** Fração exata. Invariante: `den > 0n` e `mdc(|num|, den) = 1`. */
export type Racional = { readonly num: bigint; readonly den: bigint }

/* ──────────────────────────────────────────────────────────────────────────
 * Aritmética racional (interna, com ±∞ explícito)
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * Racional estendido. `±∞` existe porque o protótipo divide por zero em casos
 * que a regra precisa decidir (`alvo/v` com `v = 0`, `v/alvo` com `alvo = 0`,
 * L762-767). Em JS isso dá `±Infinity`, e a ordem de `Infinity` é exatamente a
 * que a regra quer — os defeitos do protótipo são o `0/0` (`NaN`) e o `alvo`
 * falsy de L767. Aqui o infinito é um valor nomeado, e `0/0` nunca é
 * construído (todo caminho que chegaria lá é "bateu" antes).
 */
type Estendido = { readonly k: 'fin'; readonly r: Racional } | { readonly k: 'inf'; readonly sinal: 1 | -1 }

const abs = (x: bigint): bigint => (x < 0n ? -x : x)
const mdc = (a: bigint, b: bigint): bigint => {
  let x = abs(a)
  let y = abs(b)
  while (y !== 0n) [x, y] = [y, x % y]
  return x
}

/** Normaliza o SINAL do denominador antes de qualquer coisa (CE-5). */
function racional(num: bigint, den: bigint): Racional {
  if (den === 0n) throw new Error('Racional com denominador zero — caminho que não deveria existir.')
  const s = den < 0n ? -1n : 1n
  const g = mdc(num, den)
  return { num: (s * num) / g, den: (s * den) / g }
}

const fin = (num: bigint, den = 1n): Estendido => ({ k: 'fin', r: racional(num, den) })
const deRacional = (r: Racional): Estendido => ({ k: 'fin', r })

/** `a / b` estendido. `0/0` não tem valor e é recusado — quem chama decide antes. */
function dividir(a: Racional, b: Racional): Estendido {
  if (b.num === 0n) {
    if (a.num === 0n) throw new Error('0/0 em metas — caminho que não deveria existir.')
    return { k: 'inf', sinal: a.num > 0n ? 1 : -1 }
  }
  return fin(a.num * b.den, a.den * b.num)
}

/** -1, 0, 1. Com os denominadores já positivos, a multiplicação cruzada preserva a ordem. */
function comparar(a: Estendido, b: Estendido): -1 | 0 | 1 {
  if (a.k === 'inf' && b.k === 'inf') return a.sinal === b.sinal ? 0 : a.sinal < b.sinal ? -1 : 1
  if (a.k === 'inf') return a.sinal
  if (b.k === 'inf') return b.sinal === 1 ? -1 : 1
  const x = a.r.num * b.r.den
  const y = b.r.num * a.r.den
  return x < y ? -1 : x > y ? 1 : 0
}

const vezes = (a: Racional, c: Racional): Racional => racional(a.num * c.num, a.den * c.den)
const minimo = (a: Estendido, b: Estendido): Estendido => (comparar(a, b) <= 0 ? a : b)
const maximo = (a: Estendido, b: Estendido): Estendido => (comparar(a, b) >= 0 ? a : b)

/** Divisão inteira com piso, também para negativos (`bigint` trunca para zero). */
function divPiso(a: bigint, b: bigint): bigint {
  const q = a / b
  return a % b !== 0n && a < 0n !== b < 0n ? q - 1n : q
}

/** `Math.round(r × 100)` — meio para cima, como o JS — em inteiros. */
function percentualInteiro(r: Racional): number {
  return Number(divPiso(200n * r.num + r.den, 2n * r.den))
}

/* Os limiares do protótipo, como frações exatas. */
const NOVE_DECIMOS = racional(9n, 10n) // L775 e L776: `prog>=.9`, `prog>=esp*.9`
const SETE_DECIMOS = racional(7n, 10n) // L777: `prog>=esp*.7`
const UM_E_DOIS = fin(6n, 5n) // L767: progresso com prazo limitado a 1,2
const ZERO = fin(0n)
const UM = fin(1n)

/* ──────────────────────────────────────────────────────────────────────────
 * Semanas
 * ────────────────────────────────────────────────────────────────────────── */

const RE_DIA = /^\d{4}-\d{2}-\d{2}$/
const RE_MES = /^\d{4}-\d{2}$/

/** 1 = segunda … 7 = domingo, de um dia civil (aritmética de calendário, sem fuso). */
function diaDaSemanaIso(dia: string): number {
  const [a, m, d] = dia.split('-').map(Number)
  const w = new Date(Date.UTC(a ?? 1970, (m ?? 1) - 1, d ?? 1)).getUTCDay()
  return w === 0 ? 7 : w
}

/** A segunda-feira da semana que contém `dia`. */
export function segundaDaSemana(dia: string): string {
  return somarDias(dia, 1 - diaDaSemanaIso(dia))
}

/**
 * As segundas-feiras que caem no mês `yyyy-MM` (L747). São AS semanas do mês:
 * a semana de segunda 30/11/2026 pertence a novembro, mesmo com seis dias em
 * dezembro (ajuste 18). Novembro de 2026 tem 5; dezembro de 2026, 4.
 */
export function segundasDoMes(mes: string): string[] {
  if (!RE_MES.test(mes)) throw new Error(`Mês inválido: "${mes}".`)
  const primeiro = `${mes}-01`
  let d = somarDias(primeiro, (8 - diaDaSemanaIso(primeiro)) % 7)
  const out: string[] = []
  while (d.slice(0, 7) === mes) {
    out.push(d)
    d = somarDias(d, 7)
  }
  return out
}

/**
 * A semana a que a reunião de metas se refere hoje (L750): a segunda desta
 * semana se o dia da reunião já chegou, senão a da semana anterior.
 * `diaDaReuniao` vai de 1 (segunda) a 5 (sexta); o protótipo usa 1 quando a
 * cliente não tem reunião fixa (`diaReuniao`, L749). `hoje` é o dia civil no
 * fuso da carteira, do relógio do servidor (regra 24).
 */
export function semanaDaReuniao(hoje: string, diaDaReuniao: number): string {
  const seg = segundaDaSemana(hoje)
  return diaDaSemanaIso(hoje) >= diaDaReuniao ? seg : somarDias(seg, -7)
}

/**
 * Semanas do mês "passadas" para o ritmo (L759): as segundas anteriores à
 * semana da reunião, mais a própria semana da reunião se ela já foi lançada.
 */
export function semanasPassadasDoMes(
  mes: string,
  semanaDaReuniaoAtual: string,
  referenciasLancadas: readonly string[],
): number {
  const lancadas = new Set(referenciasLancadas)
  return segundasDoMes(mes).filter(
    (d) => d < semanaDaReuniaoAtual || (d === semanaDaReuniaoAtual && lancadas.has(d)),
  ).length
}

/* ──────────────────────────────────────────────────────────────────────────
 * Modelo
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * Combinação recusada (ajuste 19 do gate de números): `%` com `soma` —
 * somar percentuais semanais não mede nada.
 *
 * A segunda parte do ajuste 19 (recusar `prazo` + `soma` com valor inicial
 * ≠ 0) NÃO é aplicada: o protótipo aceita a combinação (`F.meta` L2756-2761;
 * `avaliarMeta` L765-767 calcula `(v − ini)/(alvo − ini)` sobre a soma), e a
 * decisão do dono (D-22, fidelidade ao protótipo) desempata a favor dele.
 * Divergência do gate registrada no relatório do ticket 2B.
 */
export function validarModeloDeMeta(m: {
  readonly unidade: UnidadeDeMeta
  readonly tipo: TipoDeMeta
  readonly agregacao: AgregacaoDeMeta
  readonly valorInicial: bigint | null
}): Result<true> {
  if (m.unidade === '%' && m.agregacao === 'soma') {
    return erro(erroDe('PercentualNaoSoma', 'Meta em percentual não soma as semanas: use média ou último valor.'))
  }
  return ok(true)
}

/* ──────────────────────────────────────────────────────────────────────────
 * Agregação
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * Qual recorte dos lançamentos entra no valor atual.
 * - `mensal`: o mês civil de `agora` **no fuso da carteira**. Janela
 *   semiaberta `[1º do mês, 1º do mês seguinte)` sobre a `referencia` (a
 *   segunda) — o mesmo que `mesRef(semana) === mes` do protótipo (L757).
 * - `prazo`: `[inicio, ∞)` — o protótipo conta `semana >= inicio` (L765), sem
 *   teto; a semana cuja segunda é anterior ao início fica fora (ajuste 21).
 *   `inicio = null` conta tudo (`m.inicio || ""`).
 */
export type PeriodoDaMeta = { readonly agora: Date; readonly inicio: string | null }

/**
 * Valor atual da meta a partir dos lançamentos semanais (L746, L757, L765):
 * `soma` das semanas, `media` (o racional exato `soma/n`) ou `ultimo` (o de
 * referência mais recente). `null` quando não há lançamento no período.
 *
 * Recusa referência fora da segunda-feira e referência repetida (CE-4): duas
 * linhas na mesma semana contariam a semana duas vezes.
 */
export function agregarLancamentos(
  lancamentos: readonly LancamentoDeMeta[],
  tipo: TipoDeMeta,
  agregacao: AgregacaoDeMeta,
  periodo: PeriodoDaMeta,
  fuso: string,
): Result<Racional | null> {
  const vistas = new Set<string>()
  for (const l of lancamentos) {
    if (!RE_DIA.test(l.referencia) || diaDaSemanaIso(l.referencia) !== 1) {
      return erro(erroDe('ReferenciaForaDaSegunda', `A referência ${l.referencia} não é uma segunda-feira.`))
    }
    if (vistas.has(l.referencia)) {
      return erro(erroDe('ReferenciaRepetida', `A semana de ${l.referencia} aparece mais de uma vez.`))
    }
    vistas.add(l.referencia)
  }

  let de: string
  let ate: string | null
  if (tipo === 'mensal') {
    const mes = diaCivil(periodo.agora, fuso).slice(0, 7)
    de = `${mes}-01`
    ate = primeiroDoMesSeguinte(mes)
  } else {
    de = periodo.inicio ?? ''
    ate = null
  }

  const noPeriodo = lancamentos
    .filter((l) => l.referencia >= de && (ate === null || l.referencia < ate))
    .sort((a, b) => (a.referencia < b.referencia ? -1 : a.referencia > b.referencia ? 1 : 0))
  const ultimo = noPeriodo[noPeriodo.length - 1]
  if (ultimo === undefined) return ok(null)

  if (agregacao === 'ultimo') return ok(racional(ultimo.valor, 1n))
  const soma = noPeriodo.reduce((s, l) => s + l.valor, 0n)
  return ok(racional(soma, agregacao === 'media' ? BigInt(noPeriodo.length) : 1n))
}

function primeiroDoMesSeguinte(mes: string): string {
  const [a = 1970, m = 1] = mes.split('-').map(Number)
  const ano = m === 12 ? a + 1 : a
  const mm = m === 12 ? 1 : m + 1
  return `${String(ano).padStart(4, '0')}-${String(mm).padStart(2, '0')}-01`
}

/**
 * O valor agregado arredondado SÓ para exibição, meio para longe do zero.
 * `R$` fica em centavos (a regra de `Dinheiro.media`); `%` fica em centésimos
 * (a escala de armazenamento); `un` e `dias` ganham uma casa, em décimos
 * (ajuste 20: "a média em un vira décimos só na exibição").
 */
export function valorParaExibicao(
  v: Racional,
  unidade: UnidadeDeMeta,
): { readonly valor: bigint; readonly escala: 'centavos' | 'centesimos' | 'decimos' } {
  const fator = unidade === 'un' || unidade === 'dias' ? 10n : 1n
  const q = (2n * abs(v.num) * fator + v.den) / (2n * v.den)
  return {
    valor: v.num < 0n ? -q : q,
    escala: unidade === 'R$' ? 'centavos' : unidade === '%' ? 'centesimos' : 'decimos',
  }
}

/* ──────────────────────────────────────────────────────────────────────────
 * Avaliação
 * ────────────────────────────────────────────────────────────────────────── */

export type EstadoDaMeta = 'atingida' | 'no_ritmo' | 'atencao' | 'critica' | 'sem_lancamento'

/**
 * O rótulo exato do protótipo (L772-778), para a tela não reconstruir a regra:
 * `na_meta` é o "bateu" de mensal com média ou último; `prazo_vencido` é a
 * meta com prazo que passou da data sem bater; `abaixo_do_ritmo` é o
 * "critico" por ritmo.
 */
export type DetalheDaMeta =
  | 'atingida'
  | 'na_meta'
  | 'prazo_vencido'
  | 'sem_lancamento'
  | 'no_ritmo'
  | 'atencao'
  | 'abaixo_do_ritmo'

export type EntradaDaAvaliacao = {
  readonly tipo: TipoDeMeta
  readonly agregacao: AgregacaoDeMeta
  readonly sentido: SentidoDeMeta
  /** `null` = não informado: o protótipo usa 0 para maior-melhor e "nenhum" para menor-melhor (L766). */
  readonly valorInicial: bigint | null
  readonly alvo: bigint
  /** De `agregarLancamentos` (ou da fonte configurada). `null` = sem lançamento. */
  readonly atual: Racional | null
  /** Só `mensal` + `soma`: de `semanasPassadasDoMes` e `segundasDoMes(mes).length`. */
  readonly semanasPassadas: number
  readonly semanasTotais: number
  /** Só `prazo`. Dias civis `yyyy-MM-dd`; `null` = o protótipo usa hoje (L768). */
  readonly inicio: string | null
  readonly prazo: string | null
  /** Dia civil de hoje no fuso da carteira, do relógio do servidor (regra 24). */
  readonly hoje: string
}

export type AvaliacaoDaMeta = {
  readonly estado: EstadoDaMeta
  readonly detalhe: DetalheDaMeta
  readonly bateu: boolean
  /**
   * `round(prog × 100)` meio para cima, só para exibição. `null` sem
   * lançamento e quando o progresso é infinito (divisor zero — a tela mostra
   * "—", nunca `Infinity%`).
   */
  readonly percentual: number | null
  /** `round(esp × 100)` — o marcador "Esperado para hoje" da barra (L782). */
  readonly ritmoEsperado: number
  /** As frações exatas. `progresso = null` sem lançamento ou quando infinito. */
  readonly progresso: Racional | null
  readonly esperado: Racional
}

/**
 * Avalia uma meta (L751-780), com toda decisão em racionais exatos.
 *
 * Erro só para entrada impossível (semanas fora de faixa, denominador ≤ 0, dia
 * mal formado) — nunca para divisão por zero, que tem valor definido (ajuste
 * 16). Com lançamento, nunca "sem lançamento".
 *
 * Fora daqui, de propósito: status `cancelada` e `atingida` manual (os dois
 * primeiros ramos, L771-772) são estado da meta, não cálculo — quem chama
 * verifica antes de avaliar.
 */
export function avaliarMeta(e: EntradaDaAvaliacao): Result<AvaliacaoDaMeta> {
  const invalida = validarEntrada(e)
  if (invalida !== null) return erro(invalida)

  const menor = e.sentido === 'menor_melhor'
  const alvo = racional(e.alvo, 1n)
  const v = e.atual === null ? null : racional(e.atual.num, e.atual.den)
  const mensalPorRazao = e.tipo === 'mensal' && e.agregacao !== 'soma'

  // L762, L763, L769: "bateu" é a mesma comparação nos dois tipos.
  const cmpAlvo = v === null ? null : comparar(deRacional(v), deRacional(alvo))
  const bateu = cmpAlvo !== null && (menor ? cmpAlvo <= 0 : cmpAlvo >= 0)

  let prog: Estendido | null = null
  let esp: Racional

  if (e.tipo === 'mensal') {
    if (e.agregacao === 'soma') {
      // L762: esp = passadas / semanas do mês; prog = v / alvo — também para
      // menor-melhor (o protótipo não inverte neste ramo).
      esp = racional(BigInt(e.semanasPassadas), BigInt(e.semanasTotais))
      if (v !== null) prog = razao(v, alvo, bateu)
    } else {
      // L763: esp = 1; prog = alvo/v (menor-melhor) ou v/alvo.
      esp = racional(1n, 1n)
      if (v !== null) prog = menor ? razao(alvo, v, bateu) : razao(v, alvo, bateu)
    }
  } else {
    // L766: inicial ausente vale 0 para maior-melhor e "nenhum" para menor-melhor.
    const ini = e.valorInicial !== null ? e.valorInicial : menor ? null : 0n
    if (v !== null && ini !== null && ini !== e.alvo) {
      // L767: clamp((v − ini) / (alvo − ini), 0, 1,2). O denominador pode ser
      // negativo (menor-melhor, CE-5): `racional` normaliza o sinal ANTES de
      // qualquer multiplicação cruzada.
      const r = fin(v.num - ini * v.den, (e.alvo - ini) * v.den)
      prog = maximo(ZERO, minimo(UM_E_DOIS, r))
    } else if (v !== null) {
      // L767: min(1,2, alvo/v) ou min(1,2, v/alvo). O protótipo exige `alvo`
      // truthy e, com alvo 0, cai em "Sem lançamento" mesmo com lançamento
      // (L767, L774). Aqui `alvo = 0` segue a mesma fórmula com ±∞; o único
      // 0/0 possível (v = alvo = 0) é "bateu" e não decide nada.
      prog = minimo(UM_E_DOIS, menor ? razao(alvo, v, bateu) : razao(v, alvo, bateu))
    }
    // L768: esp = clamp(dias(hoje − início) / max(1, dias(prazo − início)), 0, 1).
    const a = e.inicio ?? e.hoje
    const b = e.prazo ?? e.hoje
    const tot = Math.max(1, diasEntre(a, b))
    const decorridos = Math.min(Math.max(diasEntre(a, e.hoje), 0), tot)
    esp = racional(BigInt(decorridos), BigInt(tot))
  }

  let estado: EstadoDaMeta
  let detalhe: DetalheDaMeta
  if (bateu) {
    estado = 'atingida'
    detalhe = mensalPorRazao ? 'na_meta' : 'atingida' // L772
  } else if (e.tipo === 'prazo' && e.prazo !== null && e.prazo < e.hoje) {
    estado = 'critica'
    detalhe = 'prazo_vencido' // L773: diff(prazo) < 0
  } else if (prog === null) {
    estado = 'sem_lancamento'
    detalhe = 'sem_lancamento' // L774
  } else if (mensalPorRazao) {
    // L775: prog >= 0,9 → Atenção; senão Abaixo. Não existe "No ritmo" aqui.
    const atencao = comparar(prog, deRacional(NOVE_DECIMOS)) >= 0
    estado = atencao ? 'atencao' : 'critica'
    detalhe = atencao ? 'atencao' : 'abaixo_do_ritmo'
  } else if (comparar(prog, deRacional(vezes(esp, NOVE_DECIMOS))) >= 0) {
    estado = 'no_ritmo'
    detalhe = 'no_ritmo' // L776: prog >= esp × 0,9
  } else if (comparar(prog, deRacional(vezes(esp, SETE_DECIMOS))) >= 0) {
    estado = 'atencao'
    detalhe = 'atencao' // L777: prog >= esp × 0,7
  } else {
    estado = 'critica'
    detalhe = 'abaixo_do_ritmo' // L778
  }

  const progresso = prog !== null && prog.k === 'fin' ? prog.r : null
  return ok({
    estado,
    detalhe,
    bateu,
    percentual: progresso === null ? null : percentualInteiro(progresso),
    ritmoEsperado: percentualInteiro(esp),
    progresso,
    esperado: esp,
  })
}

/**
 * `n / d` estendido. O único `0/0` que as fórmulas do protótipo alcançam é
 * `v = alvo = 0`, que é sempre "bateu": o estado não depende do progresso, só o
 * percentual exibido, que fica em 100%. Divisor zero com numerador ≠ 0 é ±∞,
 * exatamente o que o JS dá.
 */
function razao(n: Racional, d: Racional, bateu: boolean): Estendido {
  if (n.num === 0n && d.num === 0n) {
    if (!bateu) throw new Error('0/0 numa meta que não bateu — caminho que não deveria existir.')
    return UM
  }
  return dividir(n, d)
}

function validarEntrada(e: EntradaDaAvaliacao): ErroDeDominio | null {
  if (!RE_DIA.test(e.hoje)) return erroDe('DiaInvalido', `Hoje inválido: "${e.hoje}".`)
  if (e.inicio !== null && !RE_DIA.test(e.inicio)) return erroDe('DiaInvalido', `Início inválido: "${e.inicio}".`)
  if (e.prazo !== null && !RE_DIA.test(e.prazo)) return erroDe('DiaInvalido', `Prazo inválido: "${e.prazo}".`)
  if (e.atual !== null && e.atual.den <= 0n) {
    return erroDe('RacionalInvalido', 'O valor atual tem denominador não positivo.')
  }
  if (e.tipo === 'mensal' && e.agregacao === 'soma') {
    const { semanasPassadas: p, semanasTotais: t } = e
    if (!Number.isInteger(t) || t < 1 || !Number.isInteger(p) || p < 0 || p > t) {
      return erroDe('SemanasInvalidas', `Semanas passadas ${p} de ${t} fora de faixa.`)
    }
  }
  return null
}

/**
 * Percentual de um mês do histórico (L761, L790): `x/alvo`, ou `alvo/x` se
 * menor-melhor, com a cor `>= 1` ok, `>= 0,9` atenção, senão crítica. Com
 * divisor zero, `null`: a tela mostra "—", nunca `Infinity%` nem `NaN%`
 * (ajuste 16).
 */
export function percentualDoHistorico(
  x: Racional,
  alvo: bigint,
  sentido: SentidoDeMeta,
): { readonly percentual: number; readonly faixa: 'ok' | 'atencao' | 'critica' } | null {
  if (x.den <= 0n) return null
  const xr = racional(x.num, x.den)
  const a = racional(alvo, 1n)
  const [n, d] = sentido === 'menor_melhor' ? [a, xr] : [xr, a]
  if (d.num === 0n) return null
  const r = dividir(n, d)
  if (r.k !== 'fin') return null
  const faixa = comparar(r, UM) >= 0 ? 'ok' : comparar(r, deRacional(NOVE_DECIMOS)) >= 0 ? 'atencao' : 'critica'
  return { percentual: percentualInteiro(r.r), faixa }
}
