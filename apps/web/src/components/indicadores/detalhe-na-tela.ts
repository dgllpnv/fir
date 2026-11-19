import type { DetalheDoKpi, MetaDeKpiNaSaida, SerieDoKpi } from '@fir/contracts'
import { diasEntre, fimDoMes, formatarValorNaTela, somarMeses } from '@fir/domain'
import { diaCompleto, diaEMes, nomeDoMes, textoDaMenorUnidade } from './na-tela'

/**
 * **O detalhe do KPI (1.9 E) — o que a tela escreve e desenha.**
 *
 * Duas coisas moram aqui, e nenhuma é conta de negócio:
 *
 * 1. **Qual janela pedir** a cada botão do gráfico. A data de hoje é a que o
 *    servidor mandou (`periodo.ate` do cartão), nunca o relógio do aparelho
 *    (regra 24); o AGRUPAMENTO é do servidor (`agrupamentoPara`, I-29) — a
 *    tela só o pede nos botões de 3 e 12 meses, onde a 1.9 fixa "uma barra
 *    por mês" (ou "um ponto por semana" no KPI semanal).
 *
 * 2. **A geometria.** Altura de barra e posição de linha saem dos inteiros que
 *    o servidor mandou, em `bigint` (a mesma regra de `Faisca`): nenhum valor
 *    em centavos passa por ponto flutuante antes de virar coordenada, e
 *    nenhuma coordenada vira texto. O texto de cada ponto sai de
 *    `formatarValorNaTela` sobre o `ValorNaTela` do PRÓPRIO ponto.
 *
 * A linha "real" do gráfico do período da meta é, no KPI que soma, o
 * acumulado das barras — e esse acumulado é só desenho: nunca aparece como
 * número. O número do período é `meta.atual`, que o servidor mediu.
 */

export type Botao = 'tres' | 'meta' | 'doze' | 'personalizado'

export const ROTULO_DO_BOTAO: Readonly<Record<Botao, string>> = {
  tres: '3 meses',
  meta: 'Período da meta',
  doze: '12 meses',
  personalizado: 'Personalizado',
}

export const ORDEM_DOS_BOTOES: readonly Botao[] = ['tres', 'meta', 'doze', 'personalizado']

export const ROTULO_DO_AGRUPAMENTO: Readonly<Record<SerieDoKpi['agrupamento'], string>> = {
  mes: 'Mês a mês',
  semana: 'Semana a semana',
  dia: 'Dia a dia',
}

export type Janela = {
  readonly de: string
  readonly ate: string
  /** Só quando a 1.9 fixa o agrupamento; sem ele, o servidor escolhe (I-29). */
  readonly agrupamento?: SerieDoKpi['agrupamento']
}

const primeiroDoMes = (dia: string): string => `${dia.slice(0, 7)}-01`

/** Os últimos `n` meses civis até hoje, por mês (KPI mensal) ou por semana (KPI semanal). */
export function janelaDosMeses(n: number, hoje: string, frequencia: DetalheDoKpi['frequencia']): Janela {
  return {
    de: somarMeses(primeiroDoMes(hoje), -(n - 1)),
    ate: hoje,
    agrupamento: frequencia === 'semanal' ? 'semana' : 'mes',
  }
}

/**
 * "Período da meta": do início ao prazo, cortado em hoje (a série não aceita
 * data futura). Meta que ainda não começou não tem série — só as linhas.
 */
export function janelaDaMeta(meta: Pick<MetaDeKpiNaSaida, 'inicio' | 'prazo'>, hoje: string): Janela | null {
  if (meta.inicio > hoje) return null
  return { de: meta.inicio, ate: meta.prazo < hoje ? meta.prazo : hoje }
}

export type ErroDoPersonalizado = 'vazio' | 'futuro' | 'invertido'

export const TEXTO_DO_ERRO_DO_PERSONALIZADO: Readonly<Record<ErroDoPersonalizado, string>> = {
  vazio: 'Preencha as duas datas.',
  futuro: 'A data não pode ser depois de hoje.',
  invertido: 'A data inicial está depois da final.',
}

const DIA = /^\d{4}-\d{2}-\d{2}$/

/** De e Até do "Personalizado". O servidor recusa do mesmo jeito (422); isto só avisa antes. */
export function conferirPersonalizado(de: string, ate: string, hoje: string): ErroDoPersonalizado | null {
  if (!DIA.test(de) || !DIA.test(ate)) return 'vazio'
  if (de > hoje || ate > hoje) return 'futuro'
  if (de > ate) return 'invertido'
  return null
}

export type Atalho = { readonly rotulo: string; readonly de: string; readonly ate: string }

/** Os atalhos do "Personalizado", nesta ordem (1.9 E). */
export function atalhosDoPersonalizado(hoje: string): Atalho[] {
  const mes = primeiroDoMes(hoje)
  const passado = somarMeses(mes, -1)
  return [
    { rotulo: 'Este mês', de: mes, ate: hoje },
    { rotulo: 'Mês passado', de: passado, ate: fimDoMes(passado.slice(0, 7)) },
    { rotulo: 'Últimos 6 meses', de: somarMeses(mes, -5), ate: hoje },
    { rotulo: 'Este ano', de: `${hoje.slice(0, 4)}-01-01`, ate: hoje },
  ]
}

// ---------------------------------------------------------------------------
// Rótulos dos pontos
// ---------------------------------------------------------------------------

type Ponto = SerieDoKpi['pontos'][number]

const MES_CURTO = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'] as const

/** O rótulo curto sob a barra: "jun", "03/11" (semana), "05" (dia). */
export function rotuloCurto(p: Pick<Ponto, 'inicio'>, agrupamento: SerieDoKpi['agrupamento']): string {
  if (agrupamento === 'mes') return MES_CURTO[Number(p.inicio.slice(5, 7)) - 1] ?? ''
  if (agrupamento === 'semana') return diaEMes(p.inicio)
  return p.inicio.slice(8, 10)
}

/** O rótulo longo da leitura: "junho de 2026", "semana de 03/11 a 09/11", "05/11". */
export function rotuloLongo(p: Pick<Ponto, 'inicio' | 'fim'>, agrupamento: SerieDoKpi['agrupamento']): string {
  if (agrupamento === 'mes') return `${nomeDoMes(p.inicio)} de ${p.inicio.slice(0, 4)}`
  if (agrupamento === 'semana') return `semana de ${diaEMes(p.inicio)} a ${diaEMes(p.fim)}`
  return diaEMes(p.inicio)
}

/**
 * O que a leitura de um ponto diz. Sempre o valor do PRÓPRIO ponto, pelo
 * formatador central. Sem o valor (a redação apagou `emDinheiro`), a altura
 * relativa que o servidor deixou — nunca um número em reais.
 */
export function leituraDoPonto(p: Ponto, agrupamento: SerieDoKpi['agrupamento']): string {
  const quando = rotuloLongo(p, agrupamento)
  if (p.diaAguardando) return `${quando}: aguardando fechamento do caixa`
  const valor = formatarValorNaTela(p.numero)
  const parcial = p.parcial ? ' (parcial)' : ''
  if (valor !== null) return `${quando}${parcial}: ${valor}`
  if (p.numero.escala !== null) return `${quando}${parcial}: ${p.numero.escala}% do maior ponto do gráfico`
  return `${quando}${parcial}: sem dado`
}

// ---------------------------------------------------------------------------
// Geometria
// ---------------------------------------------------------------------------

/** O inteiro de um `ValorNaTela`, ou `null` quando não veio (sem dado, ou redigido). */
export function inteiroDe(v: Pick<Ponto['numero'], 'unidade' | 'emDinheiro' | 'emNumero'> | null): bigint | null {
  if (v === null) return null
  const t = v.unidade === 'reais' ? v.emDinheiro : v.emNumero
  return t === null ? null : BigInt(t)
}

const escalaDe = (p: Ponto): bigint | null =>
  p.numero.escala === null || !Number.isInteger(p.numero.escala) ? null : BigInt(p.numero.escala)

/** Fração `v` em `[min, max]`, em milésimos inteiros e só então número — geometria, nunca texto. */
function fracao(v: bigint, min: bigint, max: bigint): number {
  const amplitude = max - min === 0n ? 1n : max - min
  return Number(((v - min) * 1000n) / amplitude) / 1000
}

export type BarraDoGrafico = {
  readonly chave: string
  readonly rotulo: string
  readonly leitura: string
  readonly tipo: 'cheia' | 'parcial' | 'aguardando' | 'sem_dado'
  /** Base e topo em fração da altura (0 = fundo, 1 = topo). */
  readonly de: number
  readonly ate: number
}

export type DesenhoDeBarras = {
  readonly modo: 'valor' | 'escala'
  readonly barras: readonly BarraDoGrafico[]
  /** A linha dourada do alvo, em fração da altura; `null` quando não se compara com uma barra. */
  readonly alvo: number | null
  /** Fração da linha do zero (para série com negativo). */
  readonly zero: number
  /**
   * A linha do ritmo diário da meta (1.9 E), em fração da altura: o valor com
   * `valores`, a `escala` (na régua destas barras) sem eles; `null` quando o
   * servidor não a mandou (fora do dia a dia, KPI que não soma, sem meta).
   */
  readonly ritmo: number | null
}

/** A altura fixa da barra do dia aguardando fechamento (números c.10): não é valor, é marca. */
export const ALTURA_DO_AGUARDANDO = 0.35

/**
 * As barras da série. Modo `valor` quando algum ponto trouxe o inteiro; senão
 * `escala` (sem `valores`, a forma relativa à série do próprio KPI, appsec
 * C10); senão nada para desenhar.
 *
 * O ponto de dia aguardando fechamento NÃO tem valor nem escala (números
 * c.10): vira uma barra clara de altura fixa, a mesma em qualquer KPI.
 *
 * `alvo` é a régua da meta, só no modo `valor` e só quando ela é comparável a
 * UMA barra (`alvoComparavel`): a meta de um mês de faturamento contra a
 * barra de um dia diria que todo dia falhou.
 */
export function desenharBarras(serie: SerieDoKpi, alvo: bigint | null): DesenhoDeBarras | null {
  const contam = serie.pontos.filter((p) => !p.diaAguardando)
  const comValor = contam.some((p) => inteiroDe(p.numero) !== null)
  const comEscala = contam.some((p) => escalaDe(p) !== null)
  const modo = comValor ? 'valor' : comEscala ? 'escala' : null
  // Nada que desenhar: nem valor, nem escala, nem dia aguardando.
  if (modo === null && contam.length === serie.pontos.length) return null
  const medida = (p: Ponto): bigint | null => (modo === 'valor' ? inteiroDe(p.numero) : escalaDe(p))

  let min = 0n
  let max = 0n
  for (const p of contam) {
    const v = medida(p)
    if (v === null) continue
    if (v < min) min = v
    if (v > max) max = v
  }
  const alvoNaRegua = modo === 'valor' ? alvo : null
  if (alvoNaRegua !== null && alvoNaRegua > max) max = alvoNaRegua
  if (alvoNaRegua !== null && alvoNaRegua < min) min = alvoNaRegua
  const ritmoDiario = serie.ritmoDiario ?? null
  const ritmoNaRegua =
    ritmoDiario === null
      ? null
      : modo === 'escala'
        ? ritmoDiario.escala === null || !Number.isInteger(ritmoDiario.escala)
          ? null
          : BigInt(ritmoDiario.escala)
        : inteiroDe(ritmoDiario)
  if (ritmoNaRegua !== null && ritmoNaRegua > max) max = ritmoNaRegua
  if (ritmoNaRegua !== null && ritmoNaRegua < min) min = ritmoNaRegua
  if (max === min) max = min + 1n
  const zero = fracao(0n, min, max)

  const barras = serie.pontos.map((p): BarraDoGrafico => {
    const base = { chave: p.inicio, rotulo: rotuloCurto(p, serie.agrupamento), leitura: leituraDoPonto(p, serie.agrupamento) }
    if (p.diaAguardando) return { ...base, tipo: 'aguardando', de: zero, ate: zero + ALTURA_DO_AGUARDANDO * (1 - zero) }
    const v = medida(p)
    if (v === null) return { ...base, tipo: 'sem_dado', de: zero, ate: zero }
    const f = fracao(v, min, max)
    return { ...base, tipo: p.parcial ? 'parcial' : 'cheia', de: Math.min(zero, f), ate: Math.max(zero, f) }
  })
  return {
    modo: modo ?? 'valor',
    barras,
    alvo: alvoNaRegua === null ? null : fracao(alvoNaRegua, min, max),
    zero,
    ritmo: ritmoNaRegua === null ? null : fracao(ritmoNaRegua, min, max),
  }
}

/** A leitura da linha do ritmo diário: o valor por dia, ou o percentual da meta por dia sem `valores`. */
export function leituraDoRitmoDiario(v: SerieDoKpi['ritmoDiario']): string | null {
  if (v === null || v === undefined) return null
  const t = formatarValorNaTela(v)
  if (t !== null) return `Ritmo diário da meta: ${t} por dia útil`
  return v.percentualDaMeta === null ? 'Ritmo diário da meta' : `Ritmo diário da meta: ${v.percentualDaMeta}% da meta por dia útil`
}

// ---------------------------------------------------------------------------
// "De onde vem o número": composição e lançamentos
// ---------------------------------------------------------------------------

export const TITULO_DO_BLOCO: Readonly<Record<'forma' | 'tipo' | 'origem', string>> = {
  forma: 'Por forma de pagamento',
  tipo: 'Por tipo de atendimento',
  origem: 'Por origem',
}

export const MOTIVO_SEM_COMPOSICAO: Readonly<Record<'sem_composicao' | 'medido_pelo_medx', string>> = {
  sem_composicao: 'Este indicador ainda não tem detalhamento por grupo.',
  medido_pelo_medx: 'O faturamento desta meta é medido pelo MedX; o detalhamento fica lá.',
}

/** O número de um grupo: o valor, ou a altura relativa ao bloco que o servidor deixou. Nunca R$ sem `valores`. */
export function numeroDoGrupo(v: Ponto['numero']): string {
  return formatarValorNaTela(v) ?? (v.escala === null ? '—' : `${v.escala}%`)
}

/** Largura da barrinha do grupo: a `escala` do servidor, relativa ao bloco. Geometria, não número. */
export const larguraDoGrupo = (v: Ponto['numero']): string =>
  `${Math.min(100, Math.max(0, v.escala ?? 0))}%`

/** O endereço do relatório já filtrado ("Ver recebimentos"): só a URL, a tela de relatórios é de quem a fez. */
export function enderecoDoRelatorio(r: { chave: string; de: string; ate: string }): string {
  const q = new URLSearchParams({ relatorio: r.chave, de: r.de, ate: r.ate })
  return `/indicadores/relatorios?${q.toString()}`
}

export const rotuloDoRelatorio = (chave: string): string => (chave === 'recebimentos' ? 'Ver recebimentos' : 'Ver no relatório')

/** O valor de um lançamento, na unidade do KPI; `—` quando a redação o apagou. */
/**
 * O lápis de uma linha da tabela de lançamentos (1.9 E): a janela D.4 abre
 * com a referência, o valor e o comentário DAQUELA linha — relançar a mesma
 * referência corrige (I-31). O valor vem como texto de campo, na unidade do
 * KPI; se a redação o apagou (reais sem `valores`), o campo fica vazio.
 */
export type CorrecaoDoLancamento = { readonly referencia: string; readonly valor: string; readonly comentario: string }

export function correcaoDoLancamento(
  unidade: Ponto['numero']['unidade'],
  l: { readonly referencia: string; readonly comentario: string; readonly lancado: { readonly emDinheiro: string | null; readonly emNumero: string | null } },
): CorrecaoDoLancamento {
  const t = unidade === 'reais' ? l.lancado.emDinheiro : l.lancado.emNumero
  return { referencia: l.referencia, valor: t === null ? '' : textoDaMenorUnidade(unidade, BigInt(t)), comentario: l.comentario }
}

export function valorDoLancamento(
  unidade: Ponto['numero']['unidade'],
  v: { readonly emDinheiro: string | null; readonly emNumero: string | null },
): string {
  return formatarValorNaTela({ unidade, emDinheiro: v.emDinheiro, emNumero: v.emNumero }) ?? '—'
}

/**
 * A meta se compara com uma barra quando a barra mede o mesmo que a meta: no
 * KPI que não soma (taxa, posição, média), qualquer barra; no que soma, só a
 * barra de mês contra a meta de um mês.
 */
export function alvoComparavel(
  agregacao: DetalheDoKpi['agregacao'],
  agrupamento: SerieDoKpi['agrupamento'],
  meta: Pick<MetaDeKpiNaSaida, 'tipo'> | null,
): boolean {
  if (meta === null) return false
  if (agregacao !== 'soma') return true
  return agrupamento === 'mes' && (meta.tipo === 'mes' || meta.tipo === 'recorrente')
}

/** A linha de um KPI semanal (3 e 12 meses): os mesmos pontos das barras, ligados. */
export function pontosDaLinha(desenho: DesenhoDeBarras): ({ readonly i: number; readonly y: number } | null)[] {
  return desenho.barras.map((b, i) => (b.tipo === 'cheia' || b.tipo === 'parcial' ? { i, y: b.ate > desenho.zero ? b.ate : b.de } : null))
}

// ---------------------------------------------------------------------------
// O gráfico do período da meta (as quatro linhas)
// ---------------------------------------------------------------------------

export type PontoXY = { readonly x: number; readonly y: number }

export type DesenhoDaMeta = {
  readonly modo: 'valor' | 'percentual'
  readonly real: readonly PontoXY[]
  readonly ritmo: readonly PontoXY[]
  readonly projecao: readonly PontoXY[]
  readonly alvo: number
  /** Dias aguardando fechamento, em x — barra clara de altura fixa (c.10). */
  readonly aguardando: readonly number[]
  /** A leitura do ponto mais próximo de cada x da linha real. */
  readonly leituras: readonly { readonly x: number; readonly texto: string }[]
  readonly hoje: number | null
  /** Quantos dias o período da meta tem — a largura da barra de um dia. */
  readonly dias: number
}

/**
 * As quatro linhas da 1.9 E: real (cheia), ritmo esperado do início ao prazo
 * (tracejada), projeção de hoje ao prazo (pontilhada) e o alvo (dourada).
 *
 * **Modo `valor`** quando o alvo veio (com `valores`, ou KPI fora de reais):
 * a régua é a da unidade. **Modo `percentual`** quando a redação apagou os
 * reais: a régua é o percentual da meta que o servidor deixou em cada número
 * (alvo = 100). Nenhum dos dois inventa número: cada vértice é um
 * `ValorNaTela` do servidor, e o acumulado da linha real é só desenho.
 *
 * O ritmo passa pelo "onde deveria estar hoje" do servidor (`meta.ritmo`),
 * que conta dias úteis — uma reta do início ao prazo o contradiria.
 */
export function desenharMeta(
  meta: MetaDeKpiNaSaida,
  serie: SerieDoKpi | null,
  agregacao: DetalheDoKpi['agregacao'],
  hoje: string,
): DesenhoDaMeta {
  const alvoV = inteiroDe(meta.alvo)
  const modo: DesenhoDaMeta['modo'] = alvoV !== null ? 'valor' : 'percentual'
  const em = (v: MetaDeKpiNaSaida['atual'] | null): bigint | null => {
    if (v === null) return null
    if (modo === 'valor') return inteiroDe(v)
    return v.percentualDaMeta === null ? null : BigInt(v.percentualDaMeta)
  }
  const alvo = modo === 'valor' ? (alvoV ?? 0n) : 100n
  const partida = em(meta.partida) ?? 0n
  const ritmoHoje = em(meta.ritmo)
  const atual = em(meta.atual)
  const projecao = em(meta.projecao)

  const span = Math.max(1, diasEntre(meta.inicio, meta.prazo))
  const xDe = (dia: string): number => Math.min(1, Math.max(0, diasEntre(meta.inicio, dia) / span))
  const corte = meta.prazo < hoje ? meta.prazo : hoje
  const xCorte = meta.inicio > hoje ? null : xDe(corte)

  // A linha real, em inteiros da régua escolhida.
  const contam = (serie?.pontos ?? []).filter((p) => !p.diaAguardando)
  const real: { x: number; v: bigint; texto: string }[] = []
  const agrup = serie?.agrupamento ?? 'dia'
  if (modo === 'valor') {
    let acumulado = 0n
    if (agregacao === 'soma') real.push({ x: 0, v: 0n, texto: `${diaEMes(meta.inicio)}: início da meta` })
    for (const p of contam) {
      const v = inteiroDe(p.numero)
      if (v === null) continue
      acumulado += v
      real.push({ x: xDe(p.fim), v: agregacao === 'soma' ? acumulado : v, texto: leituraDoPonto(p, agrup) })
    }
  } else if (agregacao === 'soma' && atual !== null) {
    // Sem reais: a forma do acumulado pela escala de cada ponto, ancorada no
    // percentual que o servidor mediu para o período inteiro.
    const escalas = contam.map((p) => ({ p, e: escalaDe(p) ?? 0n }))
    const total = escalas.reduce((s, x) => s + x.e, 0n)
    if (total > 0n) {
      let acumulado = 0n
      real.push({ x: 0, v: 0n, texto: `${diaEMes(meta.inicio)}: início da meta` })
      for (const { p, e } of escalas) {
        acumulado += e
        real.push({ x: xDe(p.fim), v: (acumulado * atual) / total, texto: leituraDoPonto(p, agrup) })
      }
    }
  }
  // O último vértice do acumulado é o `meta.atual` do servidor, não a soma das
  // barras: se a série e a meta medirem janelas diferentes (um dia fora, um
  // balde parcial), a linha terminaria longe do "Valor atual" impresso ao lado
  // e do começo da projeção. A soma acima só dá a FORMA até lá.
  const ultimo = real[real.length - 1]
  if (agregacao === 'soma' && atual !== null && ultimo !== undefined && real.length > 1) {
    real[real.length - 1] = { ...ultimo, v: atual }
  }
  if (real.length === 0 && atual !== null && xCorte !== null) {
    real.push({ x: 0, v: partida, texto: `${diaEMes(meta.inicio)}: partida` })
    real.push({ x: xCorte, v: atual, texto: `${diaEMes(corte)}: ${textoDaMedida(meta.atual)}` })
  }

  const ritmo: { x: number; v: bigint }[] = [{ x: 0, v: partida }]
  if (ritmoHoje !== null && xCorte !== null && xCorte > 0 && xCorte < 1) ritmo.push({ x: xCorte, v: ritmoHoje })
  ritmo.push({ x: 1, v: alvo })

  const proj: { x: number; v: bigint }[] =
    projecao !== null && atual !== null && xCorte !== null && xCorte < 1
      ? [
          { x: xCorte, v: atual },
          { x: 1, v: projecao },
        ]
      : []

  let min = 0n
  let max = alvo
  for (const v of [...real.map((r) => r.v), ...ritmo.map((r) => r.v), ...proj.map((r) => r.v), partida]) {
    if (v < min) min = v
    if (v > max) max = v
  }
  // Folga de um décimo em cima: a linha do alvo não encosta na borda.
  max = max + (max - min) / 10n
  if (max === min) max = min + 1n
  const y = (v: bigint) => fracao(v, min, max)

  return {
    modo,
    real: real.map((r) => ({ x: r.x, y: y(r.v) })),
    ritmo: ritmo.map((r) => ({ x: r.x, y: y(r.v) })),
    projecao: proj.map((r) => ({ x: r.x, y: y(r.v) })),
    alvo: y(alvo),
    aguardando: (serie?.pontos ?? []).filter((p) => p.diaAguardando).map((p) => xDe(p.inicio)),
    leituras: real.map((r) => ({ x: r.x, texto: r.texto })),
    hoje: xCorte,
    dias: span + 1,
  }
}

function textoDaMedida(v: MetaDeKpiNaSaida['atual']): string {
  const t = formatarValorNaTela(v)
  if (t !== null) return t
  return v.percentualDaMeta === null ? 'sem dado' : `${v.percentualDaMeta}% da meta`
}

// ---------------------------------------------------------------------------
// A linha de 4 números
// ---------------------------------------------------------------------------

/** Um número da linha de quatro: o valor, ou o percentual da meta que o servidor deixou. */
export function numeroOuPercentual(v: MetaDeKpiNaSaida['atual'] | null): string {
  if (v === null) return '—'
  const t = formatarValorNaTela(v)
  if (t !== null) return t
  return v.percentualDaMeta === null ? '—' : `${v.percentualDaMeta}% da meta`
}

/**
 * A projeção no prazo em duas partes: o número grande e a nota. Com
 * `valores`, "R$ 104.000,00" e "87% da meta"; sem, só "87% da meta", no
 * lugar do número.
 */
export function textoDaProjecao(meta: MetaDeKpiNaSaida): { readonly numero: string; readonly nota: string | null } {
  const p = meta.projecao
  if (p === null) return { numero: '—', nota: null }
  const t = formatarValorNaTela(p)
  const pct = p.percentualDaMeta === null ? null : `${p.percentualDaMeta}% da meta`
  if (t !== null) return { numero: t, nota: pct }
  return { numero: pct ?? '—', nota: null }
}

export const MOTIVO_SEM_PROJECAO: Readonly<Record<string, string>> = {
  sem_dado: 'Ainda não há dado para projetar.',
  cedo_para_projetar: 'Cedo para projetar: falta ao menos um dia que conte.',
  corte_no_inicio: 'A meta começou hoje; a projeção aparece amanhã.',
  sem_projecao: 'Este indicador não se projeta: cada contagem é medida sozinha.',
  fonte_fora_do_dominio: 'O número da fonte saiu do esperado e foi registrado para conferência.',
}

/** "Meta e prazo": o alvo (ou "Meta definida", sem `valores`) e "até 30/11". */
export function textoDoAlvo(meta: MetaDeKpiNaSaida): string {
  return formatarValorNaTela(meta.alvo) ?? 'Meta definida'
}


/** As metas que já terminaram, da mais recente para a mais antiga. */
export function metasAnteriores(metas: readonly MetaDeKpiNaSaida[], vigente: string | null, hoje: string): MetaDeKpiNaSaida[] {
  return metas.filter((m) => m.id !== vigente && m.prazo < hoje).sort((a, b) => (a.prazo < b.prazo ? 1 : -1))
}

/**
 * As metas que ainda não começaram, da mais próxima para a mais distante. O
 * servidor já as manda em `metas` (com o `alvo` redigido sem `valores`); sem
 * isto, a meta de dezembro salva em novembro não aparecia em lugar nenhum —
 * nem vigente, nem anterior — e o detalhe dizia só "sem meta".
 */
export function metasFuturas(metas: readonly MetaDeKpiNaSaida[], hoje: string): MetaDeKpiNaSaida[] {
  return metas.filter((m) => m.inicio > hoje).sort((a, b) => (a.inicio < b.inicio ? -1 : a.inicio > b.inicio ? 1 : 0))
}

const mesCivilInteiro = (m: Pick<MetaDeKpiNaSaida, 'inicio' | 'prazo'>): boolean =>
  m.inicio.endsWith('-01') && m.prazo === fimDoMes(m.inicio.slice(0, 7))

/** "dezembro/2026" quando a meta é um mês civil inteiro; senão "05/01/2027 a 10/02/2027". */
export function periodoDaMeta(m: Pick<MetaDeKpiNaSaida, 'inicio' | 'prazo'>): string {
  if (mesCivilInteiro(m)) return `${nomeDoMes(m.inicio)}/${m.inicio.slice(0, 4)}`
  return `${diaCompleto(m.inicio)} a ${diaCompleto(m.prazo)}`
}

/**
 * "Próxima meta: R$ 120.000,00 em dezembro/2026". Sem `valores` o servidor
 * apagou o alvo em reais, e a frase fica sem ele — "Próxima meta em
 * dezembro/2026" — sem nenhum `if` de permissão aqui.
 */
export function textoDaProximaMeta(m: MetaDeKpiNaSaida): string {
  const alvo = formatarValorNaTela(m.alvo)
  const quando = `${mesCivilInteiro(m) ? 'em' : 'de'} ${periodoDaMeta(m)}`
  return alvo === null ? `Próxima meta ${quando}` : `Próxima meta: ${alvo} ${quando}`
}

/** A meta faz parte de uma série "Todo mês" (I-24)? Quem diz é o `serieId` do servidor. */
export const daSerie = (m: Pick<MetaDeKpiNaSaida, 'serieId'>): boolean => m.serieId !== null && m.serieId !== undefined

/**
 * O próximo mês da MESMA série da meta vigente — o servidor materializa o mês
 * corrente e o seguinte (I-24). `null` fora de série, ou quando o mês seguinte
 * ainda não nasceu (ou foi ocupado por outra meta, que vale mais que a série).
 */
export function proximaDaSerie(metas: readonly MetaDeKpiNaSaida[], vigente: MetaDeKpiNaSaida | null): MetaDeKpiNaSaida | null {
  if (vigente === null || !daSerie(vigente)) return null
  const seguintes = metas
    .filter((m) => m.id !== vigente.id && m.serieId === vigente.serieId && m.inicio > vigente.inicio)
    .sort((a, b) => (a.inicio < b.inicio ? -1 : 1))
  return seguintes[0] ?? null
}
