import { Dinheiro } from './dinheiro'
import { percentualInteiro } from './financeiro/visao-do-mes'
import { diasEntre, somarDias } from './relogio'

/**
 * **O USO DIÁRIO DA FIR CLINIC, LIDO PELA CARTEIRA** (F1, V12, R13).
 *
 * As fórmulas do protótipo (`metricasUso`, `saudeUso`, `cUso`, `textoUso`,
 * L1555–1640), com os ajustes do gate de números (30 a 34) e do gate de LGPD
 * (A15, A16, A19). Uma regra, um lugar: a tela e o job de alerta (R13) leem
 * daqui, nunca recalculam.
 *
 * Onde divergimos do protótipo, e por quê (o gate vence, regra 1 do plano G8):
 *
 *  - **Hoje nunca entra** (ajuste 30). O protótipo usa `(hoje−7, hoje]`; o dia
 *    parcial contava como "sem uso" na regra dos três dias. Aqui `[hoje−7, hoje)`.
 *  - **Dias úteis pelo calendário** (ajuste 31), não pelas linhas presentes. Um
 *    dia útil sem linha é "sem dado": fica no denominador e não vira "sem uso".
 *    Por isso "Três dias sem uso" exige as três LINHAS, e "Uso muito baixo"
 *    exige que nem os dias sem dado, se tivessem uso, salvariam a semana —
 *    crítico só quando provado. Com todas as linhas presentes, as duas regras
 *    são exatamente as do protótipo.
 *  - **Inteiros.** Percentual por `percentualInteiro` (meio para cima, sem
 *    float); "dias com uso por semana" em décimos por divisão inteira.
 *  - **Sem "rotinas cumpridas" e sem "pacientes recaptados"** (ADR 0014: não
 *    há fonte) e **sem pessoas com último acesso** (ADR 0013 §2, A15).
 *    "Pessoas ativas" só como máximo da janela, nunca série diária (A16).
 */

/** Uma linha de `uso_diario_cliente`, já traduzida. `dia` é civil, no fuso da clínica. */
export type LinhaDeUsoDiario = {
  readonly dia: string
  readonly usuariosCadastrados: number
  readonly usuariosAtivos: number
  readonly tarefasCriadas: number
  readonly tarefasConcluidas: number
  readonly tarefasNoPrazo: number
  readonly tarefasVencidasAbertas: number
  readonly contatosPacientes: number
  readonly orcamentosEnviados: number
  readonly orcamentosPagos: number
  readonly faltas: number
  /** `null` = o job ainda não calculou este dia (PP-8) — nunca "zero recontatos". */
  readonly faltasRecontatadas: number | null
  readonly receitaRegistrada: Dinheiro
}

/** Janela de dias civis, semiaberta `[de, ate)` (regra 23). */
export type JanelaDeDias = { readonly de: string; readonly ate: string }

export type MetricasDeUso = {
  readonly comDados: boolean
  readonly diasUteis: number
  readonly diasComUso: number
  readonly diasSemDado: number
  /** O máximo de pessoas com login num dia da janela — agregado, nunca série (A16). */
  readonly pessoasAtivas: number
  readonly pessoasCadastradas: number | null
  readonly tarefasCriadas: number
  readonly tarefasConcluidas: number
  readonly tarefasNoPrazo: number
  readonly percentualNoPrazo: number | null
  /** Snapshot do último dia com linha na janela — o backlog não soma. */
  readonly tarefasVencidasAbertas: number | null
  readonly contatos: number
  readonly orcamentosEnviados: number
  readonly orcamentosPagos: number
  readonly percentualConversao: number | null
  readonly receita: Dinheiro
  readonly faltas: number
  readonly faltasRecontatadas: number | null
}

export type SituacaoDeUso = 'bom' | 'atencao' | 'critico'
export type SaudeDeUso = { readonly situacao: SituacaoDeUso | null; readonly rotulo: string }

export type DiaDaSerieDeUso = { readonly dia: string; readonly tarefasConcluidas: number | null }

const ehDiaUtil = (dia: string): boolean => {
  const [a, m, d] = dia.split('-').map(Number)
  const semana = new Date(Date.UTC(a ?? 1970, (m ?? 1) - 1, d ?? 1)).getUTCDay()
  return semana !== 0 && semana !== 6
}

const teveUso = (l: LinhaDeUsoDiario): boolean => l.usuariosAtivos > 0 || l.tarefasConcluidas > 0

function diasDe(j: JanelaDeDias): string[] {
  const dias: string[] = []
  for (let d = j.de; d < j.ate; d = somarDias(d, 1)) dias.push(d)
  return dias
}

const porDia = (linhas: readonly LinhaDeUsoDiario[]): Map<string, LinhaDeUsoDiario> =>
  new Map(linhas.map((l) => [l.dia, l]))

/** `[hoje−7, hoje)` — ajuste 30. */
export const semanaDe = (hoje: string): JanelaDeDias => ({ de: somarDias(hoje, -7), ate: hoje })
/** `[hoje−14, hoje−7)` — a semana com que os deltas comparam. */
export const semanaAnteriorDe = (hoje: string): JanelaDeDias => ({
  de: somarDias(hoje, -14),
  ate: somarDias(hoje, -7),
})

const pct = (a: number, b: number): number | null => percentualInteiro(BigInt(a), BigInt(b))

export function metricasDeUso(linhas: readonly LinhaDeUsoDiario[], j: JanelaDeDias): MetricasDeUso {
  const mapa = porDia(linhas)
  const dias = diasDe(j)
  const naJanela = dias.flatMap((d) => {
    const l = mapa.get(d)
    return l === undefined ? [] : [l]
  })
  const uteis = dias.filter(ehDiaUtil)
  const soma = (f: (l: LinhaDeUsoDiario) => number): number => naJanela.reduce((s, l) => s + f(l), 0)
  const ultima = naJanela.at(-1)

  const tarefasConcluidas = soma((l) => l.tarefasConcluidas)
  const tarefasNoPrazo = soma((l) => l.tarefasNoPrazo)
  const orcamentosEnviados = soma((l) => l.orcamentosEnviados)
  const orcamentosPagos = soma((l) => l.orcamentosPagos)
  const recontatadas = naJanela.map((l) => l.faltasRecontatadas)

  return {
    comDados: naJanela.length > 0,
    diasUteis: uteis.length,
    diasComUso: uteis.filter((d) => {
      const l = mapa.get(d)
      return l !== undefined && teveUso(l)
    }).length,
    diasSemDado: uteis.filter((d) => !mapa.has(d)).length,
    pessoasAtivas: naJanela.reduce((m, l) => Math.max(m, l.usuariosAtivos), 0),
    pessoasCadastradas: ultima?.usuariosCadastrados ?? null,
    tarefasCriadas: soma((l) => l.tarefasCriadas),
    tarefasConcluidas,
    tarefasNoPrazo,
    percentualNoPrazo: pct(tarefasNoPrazo, tarefasConcluidas),
    tarefasVencidasAbertas: ultima?.tarefasVencidasAbertas ?? null,
    contatos: soma((l) => l.contatosPacientes),
    orcamentosEnviados,
    orcamentosPagos,
    percentualConversao: pct(orcamentosPagos, orcamentosEnviados),
    receita: naJanela.reduce((s, l) => s.mais(l.receitaRegistrada), Dinheiro.zero()),
    faltas: soma((l) => l.faltas),
    // Uma linha sem cálculo contamina a janela inteira: "1 de 3" com um dia
    // não calculado diria menos recontatos do que houve (PP-8).
    faltasRecontatadas:
      recontatadas.length === 0 || recontatadas.some((r) => r === null)
        ? null
        : recontatadas.reduce<number>((s, r) => s + (r ?? 0), 0),
  }
}

/** Os três últimos dias úteis ANTES de hoje (cabem sempre em `[hoje−5, hoje)`). */
function tresUltimosDiasUteis(hoje: string): string[] {
  const dias: string[] = []
  for (let d = somarDias(hoje, -1); dias.length < 3; d = somarDias(d, -1)) {
    if (ehDiaUtil(d)) dias.push(d)
  }
  return dias
}

const antesDeHoje = (linhas: readonly LinhaDeUsoDiario[], hoje: string): LinhaDeUsoDiario[] =>
  linhas.filter((l) => l.dia < hoje)

export function saudeDoUso(linhas: readonly LinhaDeUsoDiario[], hoje: string): SaudeDeUso {
  const validas = antesDeHoje(linhas, hoje)
  if (validas.length === 0) return { situacao: null, rotulo: 'Sem dados' }
  const m = metricasDeUso(validas, semanaDe(hoje))
  if (!m.comDados) return { situacao: null, rotulo: 'Sem dados na semana' }

  const mapa = porDia(validas)
  const ult3 = tresUltimosDiasUteis(hoje).map((d) => mapa.get(d))
  if (ult3.every((l) => l !== undefined && !teveUso(l))) {
    return { situacao: 'critico', rotulo: 'Três dias sem uso' }
  }
  if (m.diasUteis > 0 && m.diasComUso + m.diasSemDado <= 2) {
    return { situacao: 'critico', rotulo: 'Uso muito baixo' }
  }
  if (m.diasComUso >= Math.min(4, m.diasUteis) && (m.percentualNoPrazo ?? 0) >= 80) {
    return { situacao: 'bom', rotulo: 'Uso em dia' }
  }
  return { situacao: 'atencao', rotulo: 'Uso irregular' }
}

/**
 * R13 — a tarefa "ligar para a recepção". Só o nome da clínica e a situação,
 * nunca nome de funcionária (A19).
 */
export function alertaDeUso(
  nomeDaClinica: string,
  saude: SaudeDeUso,
): { readonly titulo: string; readonly descricao: string } | null {
  if (saude.situacao !== 'critico') return null
  return { titulo: `FIR Clinic sem uso em ${nomeDaClinica}: ligar para a recepção`, descricao: saude.rotulo }
}

/** Tarefas concluídas por dia, `[hoje−dias, hoje)`. `null` = sem linha naquele dia. */
export function serieDeConcluidas(
  linhas: readonly LinhaDeUsoDiario[],
  hoje: string,
  dias = 30,
): DiaDaSerieDeUso[] {
  const mapa = porDia(linhas)
  return diasDe({ de: somarDias(hoje, -dias), ate: hoje }).map((dia) => ({
    dia,
    tarefasConcluidas: mapa.get(dia)?.tarefasConcluidas ?? null,
  }))
}

const diferenca = (agora: number | null, antes: number | null): number | null =>
  agora === null || antes === null ? null : agora - antes

const deltaDeContatos = (semana: MetricasDeUso, anterior: MetricasDeUso): number | null =>
  anterior.comDados && semana.comDados ? semana.contatos - anterior.contatos : null

export type UsoNaVisaoGeral = {
  readonly saude: SaudeDeUso
  readonly semana: MetricasDeUso | null
  /** Ajuste 33: diferença dos valores exibidos, em pontos. */
  readonly deltaNoPrazo: number | null
  readonly deltaContatos: number | null
  readonly serie: DiaDaSerieDeUso[]
}

/** Uma linha da tela FIR Clinic (`vFirClinic`). */
export function usoNaVisaoGeral(linhas: readonly LinhaDeUsoDiario[], hoje: string): UsoNaVisaoGeral {
  const validas = antesDeHoje(linhas, hoje)
  const saude = saudeDoUso(validas, hoje)
  if (validas.length === 0) {
    return { saude, semana: null, deltaNoPrazo: null, deltaContatos: null, serie: [] }
  }
  const semana = metricasDeUso(validas, semanaDe(hoje))
  const anterior = metricasDeUso(validas, semanaAnteriorDe(hoje))
  return {
    saude,
    semana,
    deltaNoPrazo: diferenca(semana.percentualNoPrazo, anterior.percentualNoPrazo),
    deltaContatos: deltaDeContatos(semana, anterior),
    serie: serieDeConcluidas(validas, hoje),
  }
}

export type ChaveDoIndicadorDeUso =
  | 'diasComUsoPorSemana'
  | 'tarefasNoPrazo'
  | 'contatosPorSemana'
  | 'tarefasVencidasAbertas'

export type IndicadorDoRelatorioDeUso = {
  readonly chave: ChaveDoIndicadorDeUso
  readonly rotulo: string
  /** `decimos`: o número é em décimos (35 = 3,5). */
  readonly unidade: 'decimos' | '%' | 'un'
  readonly menorEMelhor: boolean
  readonly inicio: number | null
  readonly agora: number | null
  readonly evolucao: number | null
}

export type MarcoDeUso = { readonly dia: 30 | 60 | 90; readonly atingido: boolean; readonly faltam: number }

export type RelatorioDeUso = {
  readonly emUsoDesde: string
  readonly diasDesde: number
  readonly marcos: readonly MarcoDeUso[]
  readonly indicadores: readonly IndicadorDoRelatorioDeUso[]
}

export type UsoDoCliente = {
  readonly saude: SaudeDeUso
  readonly semana: MetricasDeUso
  readonly semanaAnterior: MetricasDeUso
  /** Contatos da semana contra a anterior; `null` sem dado na anterior. */
  readonly deltaContatos: number | null
  readonly serie: DiaDaSerieDeUso[]
  readonly relatorio: RelatorioDeUso
}

/** Ajuste 34: `(2·50·diasUso + úteis) div (2·úteis)` — meio décimo para cima. */
const diasPorSemanaEmDecimos = (m: MetricasDeUso): number | null =>
  m.diasUteis === 0 ? null : Math.floor((100 * m.diasComUso + m.diasUteis) / (2 * m.diasUteis))

/** Ajuste 34: `round(contatos / max(1, úteis) · 5)`, em inteiros. */
const contatosPorSemana = (m: MetricasDeUso): number => {
  const d = Math.max(1, m.diasUteis)
  return Math.floor((10 * m.contatos + d) / (2 * d))
}

/** A aba "Uso da FIR Clinic" da ficha (`cUso`). `null` quando não há linha nenhuma. */
export function usoDoCliente(linhas: readonly LinhaDeUsoDiario[], hoje: string): UsoDoCliente | null {
  const validas = antesDeHoje(linhas, hoje)
  if (validas.length === 0) return null
  const emUsoDesde = validas.reduce((min, l) => (l.dia < min ? l.dia : min), validas[0]!.dia)
  const diasDesde = diasEntre(emUsoDesde, hoje)

  const fimDoInicio = somarDias(emUsoDesde, 14)
  const inicio = metricasDeUso(validas, { de: emUsoDesde, ate: fimDoInicio < hoje ? fimDoInicio : hoje })
  const agora = metricasDeUso(validas, { de: somarDias(hoje, -14), ate: hoje })

  const linha = (
    chave: ChaveDoIndicadorDeUso,
    rotulo: string,
    unidade: IndicadorDoRelatorioDeUso['unidade'],
    f: (m: MetricasDeUso) => number | null,
    menorEMelhor = false,
  ): IndicadorDoRelatorioDeUso => {
    const a = f(inicio)
    const b = f(agora)
    return { chave, rotulo, unidade, menorEMelhor, inicio: a, agora: b, evolucao: diferenca(b, a) }
  }

  const semana = metricasDeUso(validas, semanaDe(hoje))
  const semanaAnterior = metricasDeUso(validas, semanaAnteriorDe(hoje))
  return {
    saude: saudeDoUso(validas, hoje),
    semana,
    semanaAnterior,
    deltaContatos: deltaDeContatos(semana, semanaAnterior),
    serie: serieDeConcluidas(validas, hoje),
    relatorio: {
      emUsoDesde,
      diasDesde,
      marcos: ([30, 60, 90] as const).map((dia) => ({
        dia,
        atingido: diasDesde >= dia,
        faltam: Math.max(0, dia - diasDesde),
      })),
      indicadores: [
        linha('diasComUsoPorSemana', 'Dias com uso por semana', 'decimos', diasPorSemanaEmDecimos),
        linha('tarefasNoPrazo', 'Tarefas no prazo', '%', (m) => m.percentualNoPrazo),
        linha('contatosPorSemana', 'Contatos com pacientes por semana', 'un', contatosPorSemana),
        linha('tarefasVencidasAbertas', 'Tarefas vencidas em aberto', 'un', (m) => m.tarefasVencidasAbertas, true),
      ],
    },
  }
}

const pctTexto = (v: number | null): string => (v === null ? '—' : `${v}%`)
const numTexto = (v: number | null): string => (v === null ? '—' : String(v))
const dataBr = (dia: string): string => {
  const [a, m, d] = dia.split('-')
  return `${d}/${m}/${a}`
}

/**
 * O "Copiar relatório" (`textoUso`, L1639). Montado no servidor (A18) e sem
 * nenhum valor monetário — a redação por nome de campo não enxerga dentro de
 * uma string, então dinheiro aqui vazaria. Sem as linhas de rotinas (ADR 0014).
 */
export function textoDoRelatorioDeUso(nomeDaClinica: string, uso: UsoDoCliente): string {
  const m = uso.semana
  const ind = (k: ChaveDoIndicadorDeUso): IndicadorDoRelatorioDeUso =>
    uso.relatorio.indicadores.find((i) => i.chave === k)!
  const prazo = ind('tarefasNoPrazo')
  const vencidas = ind('tarefasVencidasAbertas')
  return [
    `USO DA FIR CLINIC · ${nomeDaClinica}`,
    `Em uso desde ${dataBr(uso.relatorio.emUsoDesde)}`,
    '',
    `Última semana: ${m.diasComUso} de ${m.diasUteis} dias com uso · tarefas no prazo ${pctTexto(m.percentualNoPrazo)} · ${m.contatos} contatos com pacientes · ${m.orcamentosPagos} de ${m.orcamentosEnviados} orçamentos pagos`,
    '',
    'Evolução (início → agora)',
    `• Tarefas no prazo: ${pctTexto(prazo.inicio)} → ${pctTexto(prazo.agora)}`,
    `• Tarefas vencidas em aberto: ${numTexto(vencidas.inicio)} → ${numTexto(vencidas.agora)}`,
  ].join('\n')
}

export type ResumoDasSituacoes = {
  readonly clinicas: number
  readonly bom: number
  readonly atencao: number
  readonly critico: number
  readonly semSituacao: number
}

/** Os KPIs da tela FIR Clinic. Fecham sempre: `bom + atencao + critico + semSituacao = clinicas`. */
export function resumoDasSituacoes(saudes: readonly SaudeDeUso[]): ResumoDasSituacoes {
  const conta = (s: SituacaoDeUso | null): number => saudes.filter((x) => x.situacao === s).length
  return {
    clinicas: saudes.length,
    bom: conta('bom'),
    atencao: conta('atencao'),
    critico: conta('critico'),
    semSituacao: conta(null),
  }
}
