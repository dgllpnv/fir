/**
 * O CALENDÁRIO DA ROTINA DA EQUIPE FIRMARE — G8, ticket 2A (R1–R12, R14).
 *
 * Tudo o que decide QUANDO uma `Rotina interna` gera `Tarefa interna`, como a
 * carga da equipe se distribui pelas semanas e quando é o próximo aniversário.
 * Funções puras sobre DIAS CIVIS (`yyyy-MM-dd`): o "hoje" chega pronto, já
 * calculado no fuso da carteira pelo servidor (regras 22–24) — nada aqui lê
 * relógio nem fuso. Dia útil é propriedade do calendário, não do relógio.
 *
 * Toda janela é SEMIABERTA `[de, ateExclusivo)` (regra 23). O protótipo usa
 * janelas fechadas (`d <= fim`, `datasRotina` L859); "até 7 dias à frente,
 * inclusive" vira aqui `[hoje, hoje + 8)`, o mesmo conjunto de dias.
 *
 * Feriado: o protótipo ignora, e esta fatia também (inventário R11). Fica
 * registrado — "N-ésimo dia útil" aqui é "N-ésimo dia de segunda a sexta".
 */
import { segundaDaSemana } from './metas-carteira'
import { percentualDeContagem } from './prospeccao'
import { diasEntre, fimDoMes, somarDias, somarMeses } from './relogio'
import { erro, erroDe, ok, type Result } from './resultado'

/* ────────────────────────────────────────────────────────────────────────
 * VOCABULÁRIO
 * ──────────────────────────────────────────────────────────────────────── */

export const FREQUENCIAS_DA_ROTINA = ['semanal', 'mensal', 'diaria', 'vencimento', 'reuniao'] as const
export type FrequenciaDaRotina = (typeof FREQUENCIAS_DA_ROTINA)[number]

/**
 * O "Formato" do protótipo (`por_cliente`, L2780): `global` = tarefa simples;
 * `lista` = UMA tarefa com a lista de clientes para marcar (R5); `por_cliente`
 * = uma tarefa para cada cliente.
 */
export const FORMATOS_DA_ROTINA = ['global', 'lista', 'por_cliente'] as const
export type FormatoDaRotina = (typeof FORMATOS_DA_ROTINA)[number]

/** "Para quais clientes" (L2781). `null` = todos os clientes ativos. */
export const SERVICOS_DA_ROTINA = ['semanal', 'fluxo', 'dre', 'pagamento', 'metas'] as const
export type ServicoDaRotina = (typeof SERVICOS_DA_ROTINA)[number]

/**
 * Quem executa a tarefa gerada. O protótipo atribui sempre à responsável da
 * rotina; `responsavel_do_cliente` é o `quemExecuta` (L918) trazido para a
 * rotina "uma por cliente": cai na responsável Firmare do cliente e, sem ela,
 * na da rotina.
 */
export const QUEM_EXECUTA_A_ROTINA = ['responsavel_da_rotina', 'responsavel_do_cliente'] as const
export type QuemExecutaARotina = (typeof QUEM_EXECUTA_A_ROTINA)[number]

/** As chaves de `mensagensPadrao` (L838). O texto é do ticket 3A; aqui só a chave. */
export const MENSAGENS_DA_ROTINA = ['pagamento', 'fluxo', 'dre', 'formulario', 'cobranca', 'acessos', 'semanal'] as const
export type MensagemDaRotina = (typeof MENSAGENS_DA_ROTINA)[number]

/** `FRENTES` (L629): as quatro frentes do relatório semanal. */
export const FRENTES_DA_ROTINA = [
  ['financeiro', 'Financeiro'],
  ['comercial', 'Comercial'],
  ['trafego', 'Tráfego pago'],
  ['marketing', 'Marketing'],
] as const
export type FrenteDaRotina = (typeof FRENTES_DA_ROTINA)[number][0]

export const PRIORIDADES_DA_ROTINA = ['baixa', 'normal', 'alta'] as const
export type PrioridadeDaRotina = (typeof PRIORIDADES_DA_ROTINA)[number]

export const RECORRENCIAS_DA_TAREFA_INTERNA = ['nenhuma', 'diaria', 'semanal', 'mensal'] as const
export type RecorrenciaDaTarefaInterna = (typeof RECORRENCIAS_DA_TAREFA_INTERNA)[number]

/** `tipoTarefa` (L1823): a origem da tarefa, para a carga e para redistribuir. */
export const TIPOS_DE_TAREFA_INTERNA = ['checklist', 'rotina', 'reuniao', 'avulsa'] as const
export type TipoDeTarefaInterna = (typeof TIPOS_DE_TAREFA_INTERNA)[number]

const NOMES_DOS_DIAS = ['segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado', 'domingo'] as const

/* ────────────────────────────────────────────────────────────────────────
 * CALENDÁRIO
 * ──────────────────────────────────────────────────────────────────────── */

const partes = (dia: string): [number, number, number] => {
  const [a, m, d] = dia.split('-').map(Number)
  return [a ?? 1970, m ?? 1, d ?? 1]
}

/** 1 = segunda … 7 = domingo (ISO-8601), sem fuso: aritmética de calendário. */
export function diaDaSemanaIso(dia: string): number {
  const [a, m, d] = partes(dia)
  const js = new Date(Date.UTC(a, m - 1, d)).getUTCDay()
  return js === 0 ? 7 : js
}

export const ehDiaUtil = (dia: string): boolean => diaDaSemanaIso(dia) <= 5

/** Recua para o dia útil anterior quando cai no sábado ou no domingo (`datasVenc`, L888). */
export function recuarParaDiaUtil(dia: string): string {
  const ds = diaDaSemanaIso(dia)
  return ds === 6 ? somarDias(dia, -1) : ds === 7 ? somarDias(dia, -2) : dia
}

/** A posição do dia entre os dias úteis do seu mês (1 = primeiro). `null` no fim de semana. */
export function ordemDoDiaUtil(dia: string): number | null {
  if (!ehDiaUtil(dia)) return null
  let n = 0
  for (let x = `${dia.slice(0, 7)}-01`; x <= dia; x = somarDias(x, 1)) if (ehDiaUtil(x)) n++
  return n
}

/** O N-ésimo dia útil do mês `yyyy-MM`. `null` quando o mês não tem N dias úteis. */
export function nEsimoDiaUtil(mes: string, n: number): string | null {
  if (!Number.isInteger(n) || n < 1) return null
  const fim = fimDoMes(mes)
  let visto = 0
  for (let x = `${mes}-01`; x <= fim; x = somarDias(x, 1)) {
    if (ehDiaUtil(x) && ++visto === n) return x
  }
  return null
}

/**
 * O vencimento no mês `yyyy-MM` para o `dia_vencimento` do cliente. Regra 25:
 * dia 29, 30 ou 31 em mês curto cai no último dia do mês (`Math.min(dv, ult)`,
 * L886). Usa `somarMeses` com o dia original, a mesma aritmética do resto.
 */
export function vencimentoNoMes(mes: string, diaVencimento: number): string {
  return somarMeses(`${mes}-01`, 0, diaVencimento)
}

/* ────────────────────────────────────────────────────────────────────────
 * DATAS DE UMA ROTINA
 * ──────────────────────────────────────────────────────────────────────── */

export type ParametrosDeCalendario = {
  readonly frequencia: 'diaria' | 'semanal' | 'mensal'
  readonly diaSemana: number | null
  readonly diaUtil: number | null
}

/**
 * Os dias em `[de, ateExclusivo)` em que a rotina acontece (`datasRotina`,
 * L859): diária só em dia útil; semanal no dia da semana escolhido; mensal no
 * N-ésimo dia útil do mês.
 */
export function datasDaRotina(p: ParametrosDeCalendario, de: string, ateExclusivo: string): string[] {
  const out: string[] = []
  for (let d = de; d < ateExclusivo; d = somarDias(d, 1)) {
    if (p.frequencia === 'diaria' && ehDiaUtil(d)) out.push(d)
    else if (p.frequencia === 'semanal' && diaDaSemanaIso(d) === p.diaSemana) out.push(d)
    else if (p.frequencia === 'mensal' && p.diaUtil !== null && ordemDoDiaUtil(d) === p.diaUtil) out.push(d)
  }
  return out
}

export type LembreteDeVencimento = {
  /** O dia do lembrete: X dias antes do vencimento, recuado para dia útil. */
  readonly data: string
  readonly vencimento: string
  /** Primeiro dia do mês do VENCIMENTO — a chave de idempotência (ajuste 38). */
  readonly competencia: string
}

/**
 * Os lembretes de vencimento cujo dia cai em `[de, ateExclusivo)` (`datasVenc`,
 * L884). O recuo pode levar o lembrete ao mês anterior (vencimento 01/03 →
 * lembrete 26/02), e a competência continua a do vencimento.
 *
 * Os meses varridos vão do mês de `de` (o lembrete nunca é depois do
 * vencimento) até o mês de `ateExclusivo + antecedência + 3` (o recuo de fim
 * de semana é de no máximo 2 dias) — o protótipo para no mês seguinte ao fim
 * da janela, e perderia o lembrete de uma antecedência maior que um mês.
 */
export function lembretesDeVencimento(
  diaVencimento: number,
  antecedencia: number,
  de: string,
  ateExclusivo: string,
): LembreteDeVencimento[] {
  const out: LembreteDeVencimento[] = []
  if (!(diaVencimento >= 1 && diaVencimento <= 31) || de >= ateExclusivo) return out
  const ultimoMes = somarDias(ateExclusivo, antecedencia + 3).slice(0, 7)
  for (let mes = de.slice(0, 7); mes <= ultimoMes; mes = somarMeses(`${mes}-01`, 1).slice(0, 7)) {
    const vencimento = vencimentoNoMes(mes, diaVencimento)
    const data = recuarParaDiaUtil(somarDias(vencimento, -antecedencia))
    if (data >= de && data < ateExclusivo) out.push({ data, vencimento, competencia: `${mes}-01` })
  }
  return out
}

/* ────────────────────────────────────────────────────────────────────────
 * A ROTINA
 * ──────────────────────────────────────────────────────────────────────── */

export type ParametrosDaRotina = {
  readonly frequencia: FrequenciaDaRotina
  readonly escopoAplicacao: FormatoDaRotina
  readonly diaSemana: number | null
  readonly diaUtil: number | null
  readonly antecedencia: number | null
  readonly frentes: boolean
  readonly envio: boolean
}

/** As combinações que o formulário do protótipo deixa montar mas que não geram nada. */
export function validarParametrosDaRotina(r: ParametrosDaRotina): Result<true> {
  if (r.frequencia === 'semanal' && !(Number.isInteger(r.diaSemana) && r.diaSemana! >= 1 && r.diaSemana! <= 7)) {
    return erro(erroDe('DIA_DA_SEMANA', 'Escolha o dia da semana da rotina.'))
  }
  if (r.frequencia === 'mensal' && !(Number.isInteger(r.diaUtil) && r.diaUtil! >= 1 && r.diaUtil! <= 23)) {
    return erro(erroDe('DIA_UTIL', 'Informe o dia útil do mês, de 1 a 23.'))
  }
  if (r.frequencia === 'vencimento' && !(Number.isInteger(r.antecedencia) && r.antecedencia! >= 0 && r.antecedencia! <= 31)) {
    return erro(erroDe('ANTECEDENCIA', 'Informe quantos dias antes do vencimento, de 0 a 31.'))
  }
  // O protótipo só gera "vencimento" e "reunião" no formato uma-por-cliente
  // (`gerarRotinas`, L903/L909): em qualquer outro, a rotina fica muda.
  if ((r.frequencia === 'vencimento' || r.frequencia === 'reuniao') && r.escopoAplicacao !== 'por_cliente') {
    return erro(erroDe('FORMATO', 'Rotina de vencimento ou de reunião é sempre uma tarefa para cada cliente.'))
  }
  if ((r.frentes || r.envio) && r.escopoAplicacao !== 'por_cliente') {
    return erro(erroDe('FORMATO', 'Frentes e envio aos parceiros só existem na tarefa de cada cliente.'))
  }
  return ok(true)
}

/** `freqTxt` (L870). */
export function textoDaFrequencia(r: Pick<ParametrosDaRotina, 'frequencia' | 'diaSemana' | 'diaUtil' | 'antecedencia'>): string {
  if (r.frequencia === 'vencimento') return `${r.antecedencia ?? 0} dias antes do vencimento de cada cliente`
  if (r.frequencia === 'reuniao') return 'No dia da reunião fixa de cada cliente'
  if (r.frequencia === 'diaria') return 'Todo dia útil'
  if (r.frequencia === 'semanal') {
    const nome = r.diaSemana !== null ? NOMES_DOS_DIAS[r.diaSemana - 1] : undefined
    if (nome === undefined) return 'Toda semana'
    return r.diaSemana! >= 6 ? `Todo ${nome}` : `Toda ${nome}`
  }
  return `Todo ${r.diaUtil ?? 1}º dia útil do mês`
}

export type RotinaParaPlanejar = ParametrosDaRotina & {
  readonly id: string
  readonly servico: ServicoDaRotina | null
  readonly quemExecuta: QuemExecutaARotina
  readonly responsavelId: string | null
  readonly inicio: string
}

export type ClienteParaRotina = {
  readonly id: string
  readonly nome: string
  readonly status: 'onboarding' | 'ativo' | 'pausado' | 'encerrado'
  /** Início do contrato (`data_inicio`) ou, sem ele, o dia em que o cliente foi criado. */
  readonly inicio: string | null
  readonly reunioesInicio: string | null
  /** ISO 1–7 (0047, `reuniao_dia_semana`). */
  readonly reuniaoDiaSemana: number | null
  readonly diaVencimento: number | null
  /** Mensalidade maior que zero — só o fato, nunca o valor (a rotina não precisa dele). */
  readonly temMensalidade: boolean
  readonly servicos: readonly string[]
  readonly temMetaEmAndamento: boolean
  readonly responsavelId: string | null
}

/** `aplica` (L877): a rotina vale para este cliente? */
export function aplicaRotinaAoCliente(r: Pick<RotinaParaPlanejar, 'servico'>, c: ClienteParaRotina): boolean {
  if (c.status !== 'ativo' && c.status !== 'onboarding') return false
  if (r.servico === null) return true
  if (r.servico === 'pagamento') return (c.diaVencimento ?? 0) > 0 && c.temMensalidade
  if (r.servico === 'metas') return c.reuniaoDiaSemana !== null || c.temMetaEmAndamento
  return c.servicos.includes(r.servico)
}

export type ItemPlanejado = {
  readonly rotulo: string
  readonly clienteId: string | null
  readonly frente: FrenteDaRotina | null
}

export type TarefaPlanejada = {
  readonly prazo: string
  readonly clienteId: string | null
  readonly vencimento: string | null
  readonly competencia: string | null
  readonly responsavelId: string | null
  readonly itens: readonly ItemPlanejado[]
}

/** Até 7 dias à frente; 35 para vencimento (L896). */
export const DIAS_A_FRENTE_DA_ROTINA = 7
export const DIAS_A_FRENTE_DO_VENCIMENTO = 35

const maior = (...ds: readonly (string | null)[]): string =>
  ds.reduce<string>((m, d) => (d !== null && d > m ? d : m), '')

/** Reunião sem dia fixo cai na segunda (`diaReuniao`, L749). */
const diaDaReuniao = (c: ClienteParaRotina): number => c.reuniaoDiaSemana ?? 1

const itensDeFrente = (r: RotinaParaPlanejar): ItemPlanejado[] =>
  r.frentes || r.envio ? FRENTES_DA_ROTINA.map(([frente, rotulo]) => ({ rotulo, clienteId: null, frente })) : []

/**
 * As tarefas que a rotina deve ter, a partir de `hoje` (`gerarRotinas`, L894).
 * Pura e determinística: o job chama, grava com chave explícita e `ON
 * CONFLICT DO NOTHING`; rodar duas vezes planeja a mesma lista e não grava
 * nada na segunda (regra 26, A-20).
 *
 * Nunca planeja para trás de `hoje`: o job roda todo dia, e a rotina criada
 * hoje não nasce com tarefas atrasadas (o protótipo também fixa o início no
 * dia da criação, L2984).
 */
export function planejarTarefasDaRotina(
  r: RotinaParaPlanejar,
  clientes: readonly ClienteParaRotina[],
  hoje: string,
): TarefaPlanejada[] {
  const ate = somarDias(hoje, DIAS_A_FRENTE_DA_ROTINA + 1)
  const ateVencimento = somarDias(hoje, DIAS_A_FRENTE_DO_VENCIMENTO + 1)
  const deBase = maior(r.inicio, hoje)
  const out: TarefaPlanejada[] = []

  if (r.escopoAplicacao === 'por_cliente') {
    for (const c of clientes) {
      if (!aplicaRotinaAoCliente(r, c)) continue
      const de = maior(deBase, c.inicio, r.frequencia === 'reuniao' ? c.reunioesInicio : null)
      const responsavelId =
        r.quemExecuta === 'responsavel_do_cliente' && c.responsavelId !== null ? c.responsavelId : r.responsavelId
      if (r.frequencia === 'vencimento') {
        if (c.diaVencimento === null) continue
        for (const l of lembretesDeVencimento(c.diaVencimento, r.antecedencia ?? 0, de, ateVencimento)) {
          out.push({ prazo: l.data, clienteId: c.id, vencimento: l.vencimento, competencia: l.competencia, responsavelId, itens: itensDeFrente(r) })
        }
        continue
      }
      const p: ParametrosDeCalendario =
        r.frequencia === 'reuniao'
          ? { frequencia: 'semanal', diaSemana: diaDaReuniao(c), diaUtil: null }
          : { frequencia: r.frequencia, diaSemana: r.diaSemana, diaUtil: r.diaUtil }
      for (const prazo of datasDaRotina(p, de, ate)) {
        out.push({ prazo, clienteId: c.id, vencimento: null, competencia: null, responsavelId, itens: itensDeFrente(r) })
      }
    }
    return out
  }

  if (r.frequencia === 'vencimento' || r.frequencia === 'reuniao') return out
  const itens: ItemPlanejado[] =
    r.escopoAplicacao === 'lista'
      ? clientes.filter((c) => aplicaRotinaAoCliente(r, c)).map((c) => ({ rotulo: c.nome, clienteId: c.id, frente: null }))
      : []
  for (const prazo of datasDaRotina({ frequencia: r.frequencia, diaSemana: r.diaSemana, diaUtil: r.diaUtil }, deBase, ate)) {
    out.push({ prazo, clienteId: null, vencimento: null, competencia: null, responsavelId: r.responsavelId, itens })
  }
  return out
}

/** A próxima data da rotina a partir de hoje, para a lista de rotinas (R9, `prox` L1869). */
export function proximaDataDaRotina(
  r: RotinaParaPlanejar,
  clientes: readonly ClienteParaRotina[],
  hoje: string,
): string | null {
  const de = maior(r.inicio, hoje)
  const longe = somarDias(hoje, 71)
  const datas: string[] = []
  if (r.frequencia === 'reuniao') {
    for (const c of clientes) {
      if (!aplicaRotinaAoCliente(r, c)) continue
      const d = datasDaRotina({ frequencia: 'semanal', diaSemana: diaDaReuniao(c), diaUtil: null }, maior(de, c.reunioesInicio), longe)[0]
      if (d !== undefined) datas.push(d)
    }
  } else if (r.frequencia === 'vencimento') {
    for (const c of clientes) {
      if (!aplicaRotinaAoCliente(r, c) || c.diaVencimento === null) continue
      const l = lembretesDeVencimento(c.diaVencimento, r.antecedencia ?? 0, de, longe)[0]
      if (l !== undefined) datas.push(l.data)
    }
  } else {
    const d = datasDaRotina({ frequencia: r.frequencia, diaSemana: r.diaSemana, diaUtil: r.diaUtil }, de, longe)[0]
    if (d !== undefined) datas.push(d)
  }
  return datas.sort()[0] ?? null
}

export type TarefaParaCumprimento = {
  readonly prazo: string
  readonly status: 'pendente' | 'concluida' | 'cancelada'
  /** O dia civil (fuso da carteira) em que foi concluída. */
  readonly concluidaNoDia: string | null
}

/**
 * "% no prazo" (`cump`, L1868): das últimas 8 tarefas da rotina com prazo já
 * passado, quantas foram concluídas até o dia do prazo. Cancelada não conta —
 * foi a edição da rotina que a tirou, não a equipe que falhou. É contagem,
 * arredondada meio para cima em inteiros (`percentualDeContagem`).
 */
export function cumprimentoNoPrazo(tarefas: readonly TarefaParaCumprimento[], hoje: string): number | null {
  const ultimas = tarefas
    .filter((t) => t.prazo < hoje && t.status !== 'cancelada')
    .slice()
    .sort((a, b) => (a.prazo < b.prazo ? -1 : a.prazo > b.prazo ? 1 : 0))
    .slice(-8)
  const noPrazo = ultimas.filter((t) => t.status === 'concluida' && t.concluidaNoDia !== null && t.concluidaNoDia <= t.prazo)
  return percentualDeContagem(noPrazo.length, ultimas.length)
}

/* ────────────────────────────────────────────────────────────────────────
 * A LISTA DE TAREFAS, A RECORRÊNCIA E A CARGA
 * ──────────────────────────────────────────────────────────────────────── */

export type SecaoDaTarefa = 'vencidas' | 'hoje' | 'proximos7' | 'adiante'

/** As quatro colunas de `vTarefas` (L1881). */
export function secaoDaTarefa(prazo: string, hoje: string): SecaoDaTarefa {
  const d = diasEntre(hoje, prazo)
  return d < 0 ? 'vencidas' : d === 0 ? 'hoje' : d <= 7 ? 'proximos7' : 'adiante'
}

/**
 * O prazo da próxima ocorrência de uma tarefa recorrente (`proxima`, L2789).
 * O protótipo usa `setMonth`, que em JavaScript leva 31/01 a 03/03; aqui vale
 * a regra 25 (31/01 → 28/02).
 */
export function proximaDaRecorrencia(prazo: string, recorrencia: RecorrenciaDaTarefaInterna): string | null {
  if (recorrencia === 'diaria') return somarDias(prazo, 1)
  if (recorrencia === 'semanal') return somarDias(prazo, 7)
  if (recorrencia === 'mensal') return somarMeses(prazo, 1)
  return null
}

export type SemanaDaCarga = { readonly inicio: string; readonly fimExclusivo: string }

/** As quatro semanas da carga, de segunda a domingo, a primeira contendo hoje (`semanasCarga`, L1825). */
export function semanasDaCarga(hoje: string): SemanaDaCarga[] {
  const seg = segundaDaSemana(hoje)
  return [0, 1, 2, 3].map((i) => ({ inicio: somarDias(seg, 7 * i), fimExclusivo: somarDias(seg, 7 * (i + 1)) }))
}

export type TarefaParaCarga = {
  readonly prazo: string
  readonly tipo: TipoDeTarefaInterna
  readonly clienteId: string | null
}

export type CelulaDaCarga = { readonly total: number; readonly porTipo: Record<TipoDeTarefaInterna, number> }

const celula = (ts: readonly TarefaParaCarga[]): CelulaDaCarga => {
  const porTipo: Record<TipoDeTarefaInterna, number> = { checklist: 0, rotina: 0, reuniao: 0, avulsa: 0 }
  for (const t of ts) porTipo[t.tipo]++
  return { total: ts.length, porTipo }
}

/**
 * A linha de uma pessoa na carga (`cargaDe`, L1826). Recebe só as tarefas
 * ABERTAS dela. Atrasadas à parte; cada semana conta do maior entre o início
 * da semana e hoje — o que ficou para trás nesta semana já está em atrasadas.
 */
export function cargaDaPessoa(
  tarefas: readonly TarefaParaCarga[],
  hoje: string,
): { readonly atrasadas: CelulaDaCarga; readonly semanas: readonly CelulaDaCarga[] } {
  return {
    atrasadas: celula(tarefas.filter((t) => t.prazo < hoje)),
    semanas: semanasDaCarga(hoje).map((s) =>
      celula(tarefas.filter((t) => t.prazo >= s.inicio && t.prazo < s.fimExclusivo && t.prazo >= hoje)),
    ),
  }
}

export type LinhaDaCargaPorCliente = {
  readonly clienteId: string | null
  readonly total: number
  readonly atrasadas: number
  readonly porTipo: Record<TipoDeTarefaInterna, number>
}

/** O detalhe por cliente de uma pessoa: atrasadas e as próximas 4 semanas (L1836). `null` = "Interno". */
export function cargaPorCliente(tarefas: readonly TarefaParaCarga[], hoje: string): LinhaDaCargaPorCliente[] {
  const fim = semanasDaCarga(hoje)[3]!.fimExclusivo
  const grupos = new Map<string | null, TarefaParaCarga[]>()
  for (const t of tarefas) {
    if (t.prazo >= fim) continue
    const l = grupos.get(t.clienteId) ?? []
    l.push(t)
    grupos.set(t.clienteId, l)
  }
  return [...grupos.entries()]
    .map(([clienteId, ts]) => ({
      clienteId,
      total: ts.length,
      atrasadas: ts.filter((t) => t.prazo < hoje).length,
      porTipo: celula(ts).porTipo,
    }))
    .sort((a, b) => b.total - a.total)
}

export type FiltroDeRedistribuicao = {
  /** "Só onboarding e checklist" · "Só avulsas e de reunião" · "Todas, menos rotinas" (L1852). */
  readonly tipo: 'checklist' | 'avulsa' | 'todas'
  readonly clienteId: string | null
  readonly desde: string | null
}

/**
 * A tarefa aberta entra na redistribuição? Rotina NUNCA: a dona da rotina
 * muda em Rotinas, senão a tarefa voltaria para a antiga na semana seguinte.
 */
export function tarefaEntraNaRedistribuicao(t: TarefaParaCarga, f: FiltroDeRedistribuicao): boolean {
  if (t.tipo === 'rotina') return false
  if (f.clienteId !== null && t.clienteId !== f.clienteId) return false
  if (f.desde !== null && t.prazo < f.desde) return false
  if (f.tipo === 'todas') return true
  return f.tipo === 'checklist' ? t.tipo === 'checklist' : t.tipo !== 'checklist'
}

/* ────────────────────────────────────────────────────────────────────────
 * ANIVERSÁRIOS (P6) — dia e mês, nunca o ano nem a idade (LGPD A28, A46)
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * O próximo aniversário a partir de hoje (inclusive). 29/02 em ano comum é
 * lembrado em 28/02 — o protótipo (`new Date(ano, 1, 29)`) o empurraria para
 * 01/03, o que é acidente do JavaScript, não regra.
 */
export function proximaOcorrenciaDoAniversario(
  dia: number,
  mes: number,
  hoje: string,
): { readonly data: string; readonly emDias: number } {
  const mm = String(mes).padStart(2, '0')
  const ano = Number(hoje.slice(0, 4))
  let data = vencimentoNoMes(`${ano}-${mm}`, dia)
  if (data < hoje) data = vencimentoNoMes(`${ano + 1}-${mm}`, dia)
  return { data, emDias: diasEntre(hoje, data) }
}

/** Hoje e os próximos `dias` dias (`aniversariosProximos`, L1903), do mais próximo ao mais distante. */
export function aniversariosProximos<T extends { readonly dia: number; readonly mes: number }>(
  pessoas: readonly T[],
  hoje: string,
  dias: number,
): (T & { readonly data: string; readonly emDias: number })[] {
  return pessoas
    .map((p) => ({ ...p, ...proximaOcorrenciaDoAniversario(p.dia, p.mes, hoje) }))
    .filter((p) => p.emDias <= dias)
    .sort((a, b) => a.emDias - b.emDias)
}

/** `trat` (L2421): "Dra. Ana Souza" → "Dra. Ana"; "Beatriz Rocha" → "Beatriz". */
const tratamento = (nome: string): string => {
  const p = nome.trim().split(/\s+/)
  return /^dr/i.test(nome.trim()) ? p.slice(0, 2).join(' ') : (p[0] ?? '')
}

/** A mensagem do "Parabenizar" (L1912) — sem idade (A46). */
export function mensagemDeAniversario(tipo: 'cliente' | 'equipe', nome: string): string {
  const corpo =
    tipo === 'cliente'
      ? 'Toda a equipe da Firmare deseja um novo ciclo de muita saúde, alegria e conquistas, para você e para a clínica.'
      : 'Que o seu novo ciclo seja cheio de saúde, alegria e conquistas. Obrigada por fazer parte da Firmare!'
  return `Feliz aniversário, ${tratamento(nome)}! ${corpo} Um abraço!`
}

/* ────────────────────────────────────────────────────────────────────────
 * ROTINAS PADRÃO (R12, `rotinasPadrao` L848) — modelos para o formulário
 * ──────────────────────────────────────────────────────────────────────── */

export type ModeloDeRotina = ParametrosDaRotina & {
  readonly chave: string
  readonly titulo: string
  readonly servico: ServicoDaRotina | null
  readonly mensagem: MensagemDaRotina | null
  readonly prioridade: PrioridadeDaRotina
  readonly passos: readonly string[]
}

const modelo = (m: Partial<ModeloDeRotina> & Pick<ModeloDeRotina, 'chave' | 'titulo' | 'frequencia' | 'passos'>): ModeloDeRotina => ({
  escopoAplicacao: 'por_cliente',
  diaSemana: null,
  diaUtil: null,
  antecedencia: null,
  frentes: false,
  envio: false,
  servico: null,
  mensagem: null,
  prioridade: 'normal',
  ...m,
})

export const ROTINAS_PADRAO: readonly ModeloDeRotina[] = [
  modelo({
    chave: 'fluxo',
    titulo: 'Enviar o relatório de fluxo de caixa',
    frequencia: 'mensal',
    diaUtil: 2,
    servico: 'fluxo',
    mensagem: 'fluxo',
    passos: [
      'Fechar o fluxo de caixa do mês anterior',
      'Conferir entradas e saídas com o extrato',
      'Atualizar o relatório no link da cliente',
      'Concluir a tarefa e enviar a mensagem pelo WhatsApp',
    ],
  }),
  modelo({
    chave: 'dre',
    titulo: 'Atualizar a DRE e os dashboards financeiros',
    frequencia: 'mensal',
    diaUtil: 3,
    servico: 'dre',
    mensagem: 'dre',
    passos: [
      'Montar a DRE do mês anterior',
      'Lançar os números na base dos dashboards',
      'Conferir se o dashboard fez a leitura',
      'Concluir a tarefa e enviar a mensagem pelo WhatsApp',
    ],
  }),
  modelo({
    chave: 'formularios',
    titulo: 'Enviar os formulários semanais aos parceiros',
    frequencia: 'semanal',
    diaSemana: 5,
    servico: 'semanal',
    envio: true,
    passos: [
      'Enviar o formulário de cada frente para o parceiro responsável, pelo botão de WhatsApp',
      'Cada envio fica marcado sozinho; a tarefa conclui quando as 4 frentes forem enviadas',
    ],
  }),
  modelo({
    chave: 'validar_relatorio',
    titulo: 'Validar os dados e avisar sobre o relatório semanal',
    frequencia: 'semanal',
    diaSemana: 1,
    servico: 'semanal',
    mensagem: 'semanal',
    frentes: true,
    passos: [
      'Conferir o formulário da cliente',
      'Marcar cada frente que foi atualizada corretamente',
      'Cobrar o responsável pelas frentes que faltam',
      'Abrir o dashboard e confirmar que a leitura foi feita',
      'Concluir e enviar a mensagem. As frentes não marcadas entram como pendentes',
    ],
  }),
  modelo({
    chave: 'reuniao_metas',
    titulo: 'Reunião semanal de metas com a clínica',
    frequencia: 'reuniao',
    servico: 'metas',
    passos: [
      'Fazer a reunião semanal com a equipe da clínica',
      'Lançar o resultado da semana de cada meta',
      'Registrar os combinados da reunião',
    ],
  }),
  modelo({
    chave: 'lembrete_mensalidade',
    titulo: 'Lembrar a cliente do pagamento da mensalidade',
    frequencia: 'vencimento',
    antecedencia: 3,
    servico: 'pagamento',
    mensagem: 'pagamento',
    prioridade: 'alta',
    passos: ['Conferir se o pagamento ainda não entrou', 'Enviar o lembrete pelo WhatsApp com os dados do Pix'],
  }),
]

/* ────────────────────────────────────────────────────────────────────────
 * QUEM PODE RECEBER UMA TAREFA (R4, R8)
 * ──────────────────────────────────────────────────────────────────────── */

export type DestinoDaTarefa = {
  readonly escopo: 'geral' | 'grupo'
  readonly grupoId: string | null
  readonly ativo: boolean
}

/**
 * A pessoa pode ficar com uma tarefa do grupo `grupoDaTarefa`? Precisa estar
 * ativa e enxergar a tarefa: `escopo='geral'` enxerga todo grupo; `grupo`
 * só o próprio — e nunca uma tarefa da Firmare (grupo `null`). Sem isto, uma
 * transferência entregaria a tarefa a quem a RLS nem deixa ler: ela sumiria
 * da rotina de todo mundo.
 */
export function destinoPodeReceberTarefa(grupoDaTarefa: string | null, destino: DestinoDaTarefa): boolean {
  if (!destino.ativo) return false
  if (destino.escopo === 'geral') return true
  return grupoDaTarefa !== null && destino.grupoId === grupoDaTarefa
}
