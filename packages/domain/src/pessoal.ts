import { formatarHoras, formatarSaldoDeHoras } from './banco-de-horas'
import { diasEntre, somarDias, somarMeses } from './relogio'

/**
 * GESTÃO DE PESSOAS — férias, experiência, documentos e alertas. **Puro.**
 *
 * Nada aqui toca banco, relógio nem HTTP: `hoje` é parâmetro, e ele é o dia da
 * clínica calculado no servidor (regras 22 e 24). O protótipo chama `today()`,
 * que é o relógio do NAVEGADOR — a recepção com o celular adiantado antecipa
 * um vencimento de ASO e atrasa o prazo legal de férias de outra pessoa.
 */

/** Os cinco tipos de contrato do protótipo, na ordem em que ela os lista. */
export const CONTRATOS = ['CLT', 'PJ', 'Estágio', 'Autônomo', 'Sócia'] as const
export type Contrato = (typeof CONTRATOS)[number]

/**
 * Férias e experiência são institutos da CLT — só esse contrato os tem.
 *
 * Lista, e não `contrato === 'CLT'` espalhado: no dia em que a clínica
 * contratar por outro regime com direito a férias, a mudança é aqui.
 */
export const CONTRATOS_COM_FERIAS: readonly Contrato[] = ['CLT']

/** Banco de horas pressupõe jornada controlada — CLT e estágio, como na tela dela. */
export const CONTRATOS_COM_BANCO_DE_HORAS: readonly Contrato[] = ['CLT', 'Estágio']

/** CLT art. 130: 30 dias corridos por período aquisitivo completo. */
export const DIAS_DE_FERIAS_POR_PERIODO = 30

/** Teto de períodos calculados. 40 anos de casa é o `k < 40` dela. */
export const MAX_PERIODOS_AQUISITIVOS = 40

/** Aviso 60 dias antes do prazo legal de concessão. */
export const DIAS_PARA_AVISAR_FERIAS = 60

/** Aviso 30 dias antes de o documento vencer (MANUAL cap. 13). */
export const DIAS_PARA_AVISAR_DOCUMENTO = 30

/** Aviso 10 dias antes do fim de cada período de experiência. */
export const DIAS_PARA_AVISAR_EXPERIENCIA = 10

/**
 * Os 45 e os 90 dias de experiência, em DIAS SOMADOS À ADMISSÃO.
 *
 * 44 e 89, e não 45 e 90, porque **o dia da admissão é o dia 1** — contar a
 * partir do dia seguinte entrega um contrato de 46 dias como se fosse de 45, e
 * o aviso chega um dia depois da decisão ter de estar tomada.
 */
export const FIM_DA_PRIMEIRA_EXPERIENCIA = 44
export const FIM_DA_SEGUNDA_EXPERIENCIA = 89

/** A tarefa do alerta nasce 7 dias antes do prazo — nunca no passado. */
export const DIAS_DE_ANTECEDENCIA_DA_TAREFA = 7

// ---------------------------------------------------------------------------
// FÉRIAS
// ---------------------------------------------------------------------------

/** Um registro de férias: dias civis **inclusivos** nas duas pontas. */
export type FeriasRegistradas = { readonly inicio: string; readonly fim: string }

/** Dias corridos de um registro de férias. 01→01 é **um** dia, não zero. */
export const diasDeFerias = (f: FeriasRegistradas): number => diasEntre(f.inicio, f.fim) + 1

export type PeriodoAquisitivo = {
  /** 1 para o primeiro ano de casa, 2 para o segundo. */
  readonly indice: number
  readonly inicio: string
  readonly fim: string
  /** O prazo LEGAL de concessão: o fim do período seguinte (CLT art. 134). */
  readonly concederAte: string
  readonly diasConcedidos: number
  readonly diasRestantes: number
  /** Passou do prazo com dias a conceder — e isso custa férias em dobro. */
  readonly vencido: boolean
}

/**
 * Os períodos aquisitivos **completos** de uma ficha CLT, com os dias já
 * registrados abatidos dos mais antigos primeiro.
 *
 * Três decisões, e cada uma tem teste de propriedade:
 *
 *  1. **Os períodos são contíguos.** O período `k` termina no dia anterior ao
 *     início do `k+1`, e as bordas saem de `somarMeses` (regra 25). Escritas à
 *     mão, uma admissão em 29/02 produz um dia de buraco ou um dia contado
 *     duas vezes.
 *  2. **Só período COMPLETO aparece.** Enquanto `fim >= hoje`, ele não
 *     terminou: não há 30 dias adquiridos e não há nada a conceder.
 *  3. **FIFO.** Os dias registrados abatem o período mais antigo primeiro,
 *     porque é o mais antigo que vence primeiro. A soma dos abatimentos é
 *     exatamente `min(dias registrados, 30 × períodos)` — nem um dia se
 *     perde, nem um dia se inventa.
 *
 * `concederAte` é **ancorado na admissão** (`somarMeses(admissao, 12(k+1))`),
 * e não `somarMeses(fim, 12)`. As duas concordam quase sempre, e a segunda
 * perde a âncora quando o clamp de `somarMeses` morde: medido em admissão
 * 01/03/2020, 3º período, onde ela devolve **28/02/2024** em vez de
 * **29/02/2024** e antecipa em um dia o prazo que custa férias em dobro. A
 * mutação sobreviveu ao primeiro teste — o que a pega é a propriedade
 * `concederAte[k] === fim[k+1]`.
 */
export function periodosAquisitivos(arg: {
  readonly contrato: Contrato
  readonly admissao: string | null
  readonly ferias: readonly FeriasRegistradas[]
  readonly hoje: string
}): readonly PeriodoAquisitivo[] {
  if (!CONTRATOS_COM_FERIAS.includes(arg.contrato) || arg.admissao === null) return []
  const admissao = arg.admissao

  let aAbater = arg.ferias.reduce((soma, f) => soma + diasDeFerias(f), 0)
  const saida: PeriodoAquisitivo[] = []

  for (let k = 1; k <= MAX_PERIODOS_AQUISITIVOS; k++) {
    const fim = somarDias(somarMeses(admissao, 12 * k), -1)
    // Comparação lexicográfica de `aaaa-mm-dd` é a ordem cronológica.
    if (fim >= arg.hoje) break

    const concederAte = somarDias(somarMeses(admissao, 12 * (k + 1)), -1)
    const diasConcedidos = Math.min(DIAS_DE_FERIAS_POR_PERIODO, aAbater)
    aAbater -= diasConcedidos
    const diasRestantes = DIAS_DE_FERIAS_POR_PERIODO - diasConcedidos

    saida.push({
      indice: k,
      inicio: somarMeses(admissao, 12 * (k - 1)),
      fim,
      concederAte,
      diasConcedidos,
      diasRestantes,
      vencido: diasRestantes > 0 && concederAte < arg.hoje,
    })
  }
  return saida
}

/**
 * Se um registro novo de férias se sobrepõe a algum que já existe.
 *
 * **Aqui divergimos do protótipo**, que apenas concatena. Dois registros
 * sobrepostos inflam o total abatido, `diasRestantes` encolhe, e a clínica
 * deixa de ser avisada da dívida que tem — na direção que custa férias em
 * dobro. Registrar duas vezes o mesmo período não é um fato possível.
 *
 * O banco também cobra, por `EXCLUDE` (migration 0018): esta função é a
 * mensagem de tela, não a garantia.
 */
export const feriasSeSobrepoem = (
  nova: FeriasRegistradas,
  existentes: readonly FeriasRegistradas[],
): boolean => existentes.some((f) => nova.inicio <= f.fim && f.inicio <= nova.fim)

// ---------------------------------------------------------------------------
// TEMPO DE CASA
// ---------------------------------------------------------------------------

/**
 * Meses completos de casa, por **calendário** — `null` sem admissão.
 *
 * O protótipo faz `Math.floor(diasEntre(adm, hoje) / 30.44)`: 30,44 é a média
 * de dias do mês, então quem tem 11 meses e 29 dias aparece com 12, e um mês
 * de 31 dias desliza. Diferença de meses de calendário, corrigida quando o dia
 * do mês ainda não chegou, é exata e é o que a pessoa conta de cabeça.
 */
export function mesesDeCasa(admissao: string | null, hoje: string): number | null {
  if (admissao === null || admissao > hoje) return null
  const [anoA, mesA, diaA] = admissao.split('-').map(Number)
  const [anoH, mesH, diaH] = hoje.split('-').map(Number)
  const bruto = ((anoH ?? 0) - (anoA ?? 0)) * 12 + ((mesH ?? 0) - (mesA ?? 0))
  return Math.max(0, bruto - ((diaH ?? 0) < (diaA ?? 0) ? 1 : 0))
}

// ---------------------------------------------------------------------------
// ALERTAS
// ---------------------------------------------------------------------------

export const TIPOS_DE_ALERTA = ['Férias', 'Experiência', 'Documento', 'Banco de horas'] as const
export type TipoDeAlerta = (typeof TIPOS_DE_ALERTA)[number]

/** `critico` é o `bad` dela (já aconteceu); `atencao` é o `warn` (vai acontecer). */
export type SeveridadeDeAlerta = 'atencao' | 'critico'

export type AlertaDePessoa = {
  readonly tipo: TipoDeAlerta
  readonly severidade: SeveridadeDeAlerta
  readonly texto: string
  /** O dia a que o alerta se refere: o prazo legal, a validade, o fim do mês. */
  readonly em: string
  /** O prazo da tarefa que "Gerar tarefa" cria. Do SERVIDOR (regra 24). */
  readonly prazoDaTarefa: string
}

export type DocumentoDaPessoa = {
  readonly nome: string
  readonly validade: string | null
}

export type SaldoDeHorasDoMes = {
  /** `aaaa-mm`. */
  readonly mes: string
  readonly saldoEmMinutos: number
}

export type PessoaParaAlerta = {
  readonly contrato: Contrato
  readonly admissao: string | null
  readonly ativo: boolean
  readonly ferias: readonly FeriasRegistradas[]
  readonly documentos: readonly DocumentoDaPessoa[]
  /** O saldo do ÚLTIMO mês lançado, ou `null` se nunca houve lançamento. */
  readonly ultimoSaldoDeHoras: SaldoDeHorasDoMes | null
}

/** `aaaa-mm-dd` → `dd/mm/aaaa`, para o texto do alerta. */
const emTexto = (dia: string): string =>
  `${dia.slice(8, 10)}/${dia.slice(5, 7)}/${dia.slice(0, 4)}`

/** `aaaa-mm` → `mm/aaaa`. */
const mesEmTexto = (mes: string): string => `${mes.slice(5, 7)}/${mes.slice(0, 4)}`

const plural = (n: number, um: string, varios: string): string => `${n} ${n === 1 ? um : varios}`

/** Último dia civil do mês `aaaa-mm`. */
const fimDoMesDe = (mes: string): string => somarDias(somarMeses(`${mes}-01`, 1), -1)

/**
 * **O prazo da tarefa nunca nasce no passado**, e é o mesmo clamp do
 * `Contato de retorno`: sem ele, o alerta de férias vencidas há cinco meses
 * criaria uma tarefa atrasada desde março, e a lista de hoje abre com um
 * cartão vermelho que ninguém atrasou.
 */
const prazoDaTarefaPara = (em: string, hoje: string): string => {
  const antecipado = somarDias(em, -DIAS_DE_ANTECEDENCIA_DA_TAREFA)
  return antecipado > hoje ? antecipado : hoje
}

/**
 * Os quatro alertas da pessoa, na ordem em que eles importam.
 *
 * **Ficha inativa não alerta**: quem saiu da clínica não tem férias a
 * programar nem ASO a renovar, e o alerta dela empurraria para baixo o de
 * quem está trabalhando.
 */
export function alertasDaPessoa(
  p: PessoaParaAlerta,
  limiteDeHorasEmMinutos: number,
  hoje: string,
): readonly AlertaDePessoa[] {
  if (!p.ativo) return []

  const saida: AlertaDePessoa[] = []
  const add = (
    tipo: TipoDeAlerta,
    severidade: SeveridadeDeAlerta,
    texto: string,
    em: string,
  ): void => {
    saida.push({ tipo, severidade, texto, em, prazoDaTarefa: prazoDaTarefaPara(em, hoje) })
  }

  for (const periodo of periodosAquisitivos({
    contrato: p.contrato,
    admissao: p.admissao,
    ferias: p.ferias,
    hoje,
  })) {
    if (periodo.diasRestantes === 0) continue
    const faltam = diasEntre(hoje, periodo.concederAte)
    if (faltam < 0) {
      add(
        'Férias',
        'critico',
        `Férias do período ${emTexto(periodo.inicio)}–${emTexto(periodo.fim)} vencidas (${plural(periodo.diasRestantes, 'dia', 'dias')}). Férias concedidas fora do prazo são pagas em dobro.`,
        periodo.concederAte,
      )
    } else if (faltam <= DIAS_PARA_AVISAR_FERIAS) {
      add(
        'Férias',
        'atencao',
        `Programar ${plural(periodo.diasRestantes, 'dia', 'dias')} de férias até ${emTexto(periodo.concederAte)} (faltam ${plural(faltam, 'dia', 'dias')}).`,
        periodo.concederAte,
      )
    }
  }

  if (CONTRATOS_COM_FERIAS.includes(p.contrato) && p.admissao !== null) {
    const primeiro = somarDias(p.admissao, FIM_DA_PRIMEIRA_EXPERIENCIA)
    const segundo = somarDias(p.admissao, FIM_DA_SEGUNDA_EXPERIENCIA)
    if (hoje <= primeiro && diasEntre(hoje, primeiro) <= DIAS_PARA_AVISAR_EXPERIENCIA) {
      add(
        'Experiência',
        'atencao',
        `1º período de experiência termina em ${emTexto(primeiro)}: decidir se prorroga.`,
        primeiro,
      )
    } else if (
      hoje > primeiro &&
      hoje <= segundo &&
      diasEntre(hoje, segundo) <= DIAS_PARA_AVISAR_EXPERIENCIA
    ) {
      add(
        'Experiência',
        'atencao',
        `Experiência termina em ${emTexto(segundo)}: decidir sobre a efetivação.`,
        segundo,
      )
    }
  }

  for (const doc of p.documentos) {
    if (doc.validade === null) continue
    const faltam = diasEntre(hoje, doc.validade)
    if (faltam < 0) {
      add('Documento', 'critico', `${doc.nome} vencido desde ${emTexto(doc.validade)}.`, doc.validade)
    } else if (faltam <= DIAS_PARA_AVISAR_DOCUMENTO) {
      add('Documento', 'atencao', `${doc.nome} vence em ${emTexto(doc.validade)}.`, doc.validade)
    }
  }

  const ultimo = p.ultimoSaldoDeHoras
  if (
    ultimo !== null &&
    CONTRATOS_COM_BANCO_DE_HORAS.includes(p.contrato) &&
    Math.abs(ultimo.saldoEmMinutos) > limiteDeHorasEmMinutos
  ) {
    add(
      'Banco de horas',
      // Saldo NEGATIVO é crítico e positivo é atenção, como na tela dela: horas
      // a mais são passivo trabalhista administrável; horas a menos são a
      // pessoa devendo tempo que a clínica já pagou.
      ultimo.saldoEmMinutos > 0 ? 'atencao' : 'critico',
      `Saldo de ${formatarSaldoDeHoras(ultimo.saldoEmMinutos)} em ${mesEmTexto(ultimo.mes)} (limite ±${formatarHoras(limiteDeHorasEmMinutos)}).`,
      fimDoMesDe(ultimo.mes),
    )
  }

  return saida
}

/**
 * A ordem da lista de alertas: **crítico primeiro, depois o mais antigo**.
 *
 * `em` e não `prazoDaTarefa` como segundo critério: dois alertas podem ter o
 * mesmo prazo de tarefa (os dois clampados em hoje) e datas de referência
 * muito diferentes — o que venceu há cinco meses vem antes do que vence
 * amanhã.
 */
export function ordenarAlertas<T extends { severidade: SeveridadeDeAlerta; em: string }>(
  alertas: readonly T[],
): readonly T[] {
  const peso = (s: SeveridadeDeAlerta): number => (s === 'critico' ? 0 : 1)
  return [...alertas].sort(
    (a, b) => peso(a.severidade) - peso(b.severidade) || a.em.localeCompare(b.em),
  )
}
