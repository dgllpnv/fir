import type {
  KpiNaLista,
  LancamentoDeKpiNaSaida,
  LancamentoDeKpiNaTarefa,
  MetaDeKpiNaSaida,
  OkrNaSaida,
  PreviaDaMeta,
} from '@fir/contracts'
import {
  centavosDoTextoBrasileiro,
  diaCivil,
  ESCALA_DA_UNIDADE,
  type FrequenciaDeKpi,
  formatarNumeroDoKpi,
  formatarValorNaTela,
  type PilarDeKpi,
  PILARES_DE_KPI,
  type SituacaoDaMeta,
  somarMeses,
  trimestreDe,
  type UnidadeDeKpi,
} from '@fir/domain'
import { textoDeCentavos } from '@/lib/dinheiro-digitado'

/**
 * **O que a tela de Indicadores escreve, a partir do que o servidor mandou.**
 *
 * Tudo aqui é FORMATAR e ESCOLHER RÓTULO — nenhuma conta de negócio. O valor,
 * a meta, o ritmo, a situação, o progresso e a variação chegam prontos em
 * `ValorNaTela` (I-34); o texto sai do formatador central do domínio
 * (`formatarValorNaTela`). Quem não tem `valores` recebe `emDinheiro: null`
 * — e a tela não decide nada sobre isso: o que é `null` não se escreve, e o
 * percentual da meta, que o servidor deixou, ocupa o lugar.
 */

type ValorNaTela = KpiNaLista['atual']

export type Tom = 'ok' | 'atencao' | 'mau' | 'neutro'

export type SituacaoDoCartao = SituacaoDaMeta | 'sem_meta'

export const ROTULO_DA_SITUACAO: Readonly<Record<SituacaoDoCartao, string>> = {
  atingida: 'Atingida',
  no_ritmo: 'No ritmo',
  atencao: 'Atenção',
  abaixo: 'Abaixo do ritmo',
  sem_dado: 'Sem dado',
  sem_meta: 'Sem meta',
}

export const TOM_DA_SITUACAO: Readonly<Record<SituacaoDoCartao, Tom>> = {
  atingida: 'ok',
  no_ritmo: 'ok',
  atencao: 'atencao',
  abaixo: 'mau',
  sem_dado: 'neutro',
  sem_meta: 'neutro',
}

/** A ordem da faixa "Saúde da clínica" (1.9 C): vermelho, amarelo, verde; sem meta por último. */
const ORDEM_DA_SITUACAO: readonly SituacaoDoCartao[] = ['abaixo', 'atencao', 'no_ritmo', 'atingida', 'sem_dado', 'sem_meta']

export const situacaoDoCartao = (meta: MetaDeKpiNaSaida | null): SituacaoDoCartao =>
  meta === null ? 'sem_meta' : meta.situacao

const MES_ABREVIADO = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'] as const

/**
 * O texto do selo do cartão. Sem meta vigente mas com a próxima já definida
 * (`inicioDaProximaMeta`, só a data, do servidor), "Meta a partir de
 * dez/2026" no lugar de "Sem meta" — que soava como se ninguém a tivesse
 * definido.
 */
export function textoDoSelo(situacao: SituacaoDoCartao, inicioDaProximaMeta: string | null | undefined): string {
  if (situacao !== 'sem_meta' || inicioDaProximaMeta === null || inicioDaProximaMeta === undefined) return ROTULO_DA_SITUACAO[situacao]
  const mes = MES_ABREVIADO[Number(inicioDaProximaMeta.slice(5, 7)) - 1] ?? ''
  return `Meta a partir de ${mes}/${inicioDaProximaMeta.slice(0, 4)}`
}

/** "Em atenção" no resumo da faixa: amarelo ou vermelho. Contar não é calcular. */
export const emAtencao = (s: SituacaoDoCartao): boolean => s === 'atencao' || s === 'abaixo'

export function ordenarPorSituacao<T extends { readonly metaVigente: MetaDeKpiNaSaida | null; readonly nome: string }>(
  kpis: readonly T[],
): T[] {
  const pos = (k: T) => ORDEM_DA_SITUACAO.indexOf(situacaoDoCartao(k.metaVigente))
  return [...kpis].sort((a, b) => pos(a) - pos(b) || a.nome.localeCompare(b.nome, 'pt-BR'))
}

/** Os pilares na ordem da 1.9 (Financeiro, Comercial, Processos, Pessoas), só os que têm KPI. */
export function agruparPorPilar<T extends { readonly pilar: PilarDeKpi }>(kpis: readonly T[]): { pilar: PilarDeKpi; itens: T[] }[] {
  return PILARES_DE_KPI.map((pilar) => ({ pilar, itens: kpis.filter((k) => k.pilar === pilar) })).filter(
    (g) => g.itens.length > 0,
  )
}

/**
 * O número grande do cartão (C.1).
 *
 * Com o valor: o valor. Sem ele (a redação apagou `emDinheiro`, ou não há
 * dado), o percentual da meta que o servidor deixou — "78% da meta". Sem os
 * dois, um traço: nunca zero, porque "sem dado" não é zero (I-6).
 */
export function numeroDoCartao(atual: ValorNaTela): { readonly texto: string; readonly soPercentual: boolean } {
  const valor = formatarValorNaTela(atual)
  if (valor !== null) return { texto: valor, soPercentual: false }
  if (atual.percentualDaMeta !== null) return { texto: `${atual.percentualDaMeta}% da meta`, soPercentual: true }
  return { texto: '—', soPercentual: false }
}

/** "de R$ 120.000,00" — só quando o alvo veio. Sem `valores`, o alvo em reais não vem, e a frase some. */
export function textoDaMeta(meta: MetaDeKpiNaSaida | null): string | null {
  if (meta === null) return null
  const alvo = formatarValorNaTela(meta.alvo)
  return alvo === null ? null : `de ${alvo}`
}

const MESES = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
] as const

export const nomeDoMes = (dia: string): string => MESES[Number(dia.slice(5, 7)) - 1] ?? ''

/**
 * O rótulo da comparação (C.1 e I-28). O período anterior é o que o servidor
 * mediu; aqui só se diz o NOME dele. KPI que soma no mês compara com o mesmo
 * dia do mês anterior, e a frase diz isso.
 */
export function rotuloDaComparacao(k: Pick<KpiNaLista, 'frequencia' | 'agregacao' | 'chave' | 'periodo'>): string {
  if (k.chave === 'resultado_do_mes') return 'mês inteiro'
  if (k.frequencia === 'semanal') return 'vs. semana anterior'
  const anterior = nomeDoMes(somarMeses(`${k.periodo.de.slice(0, 7)}-01`, -1))
  return k.agregacao === 'soma' ? `vs. mesmo dia de ${anterior}` : `vs. ${anterior}`
}

/**
 * A variação contra o período anterior, como o servidor a mediu (I-28):
 * percentual em pontos, as outras unidades em variação relativa, "novo"
 * quando o anterior é zero. Verde se melhorou, vermelho se piorou, PELA
 * DIREÇÃO do KPI — num KPI "quanto menor, melhor", subir é piorar.
 */
export function textoDaVariacao(
  variacao: KpiNaLista['variacao'],
  direcao: KpiNaLista['direcao'],
): { readonly texto: string; readonly tom: Tom } | null {
  if (variacao === null) return null
  if (variacao.tipo === 'novo') return { texto: 'novo', tom: 'neutro' }
  const sinal =
    variacao.tipo === 'pontos'
      ? BigInt(variacao.emCentesimos) > 0n ? 1 : BigInt(variacao.emCentesimos) < 0n ? -1 : 0
      : Math.sign(variacao.percentual)
  const corpo =
    variacao.tipo === 'pontos'
      ? `${formatarNumeroDoKpi('quantidade', abs(BigInt(variacao.emCentesimos)))} p.p.`
      : `${Math.abs(variacao.percentual)}%`
  if (sinal === 0) return { texto: `= ${corpo}`, tom: 'neutro' }
  const melhorou = direcao === 'maior' ? sinal > 0 : sinal < 0
  return { texto: `${sinal > 0 ? '▲' : '▼'} ${corpo}`, tom: melhorou ? 'ok' : 'mau' }
}

const abs = (v: bigint): bigint => (v < 0n ? -v : v)

/** dd/mm/aaaa, do dia civil que o servidor mandou. */
export const diaCompleto = (dia: string): string => `${dia.slice(8, 10)}/${dia.slice(5, 7)}/${dia.slice(0, 4)}`
export const diaEMes = (dia: string): string => `${dia.slice(8, 10)}/${dia.slice(5, 7)}`

/**
 * **A frase da prévia D.3, montada na tela** (I-23, appsec C8).
 *
 * O servidor devolve só números estruturados — nenhuma frase pronta, porque
 * uma string com "R$" atravessaria a redação de `valores` sem que a lista de
 * campos monetários a enxergasse. Aqui ela é montada com o formatador
 * central. O alvo digitado só entra na frase quando o ritmo veio: o ritmo é
 * do mesmo KPI, e quando a redação o apagou a frase inteira sai sem o trecho
 * em reais — sem `if` de permissão, pelo `null` que o servidor mandou.
 */
export function fraseDaPrevia(previa: PreviaDaMeta, alvoDigitado: { unidade: UnidadeDeKpi; valor: bigint } | null): string {
  const ritmo = formatarValorNaTela(previa.ritmoPorDiaUtil)
  const atual = formatarValorNaTela(previa.atualPorDiaUtil)
  const prazo = diaEMes(previa.prazo)
  const dias = `${previa.diasUteis} ${previa.diasUteis === 1 ? 'dia útil' : 'dias úteis'}`
  if (ritmo === null) return `Até ${prazo} são ${dias}.`
  const alvo = alvoDigitado === null ? null : formatarNumeroDoKpi(alvoDigitado.unidade, alvoDigitado.valor)
  const inicio = alvo === null ? `Para chegar à meta em ${prazo}` : `Para chegar a ${alvo} em ${prazo}`
  const hoje = atual === null ? '' : ` Hoje a clínica está em ${atual} por dia útil.`
  return `${inicio}, o ritmo esperado é de ${ritmo} por dia útil.${hoje}`
}

/**
 * O que a pessoa DIGITOU → a menor unidade do KPI (centavos, centésimos,
 * minutos), como inteiro. Nunca `parseFloat`: a leitura é por dígitos,
 * a mesma de dinheiro (`centavosDoTextoBrasileiro`), e a escala vem de
 * `ESCALA_DA_UNIDADE` — nenhum fator de conversão mora aqui (regra 9).
 * Horas aceitam "12", "12:30" ou "12h30". `null` = texto que não é número.
 */
export function menorUnidadeDoTexto(unidade: UnidadeDeKpi, texto: string): bigint | null {
  const t = texto.trim()
  if (t === '') return null
  const escala = ESCALA_DA_UNIDADE[unidade]
  if (escala.menorUnidade === 'minutos') {
    const m = /^(\d{1,6})(?:\s*[:h]\s*(\d{1,2}))?\s*(?:h)?$/i.exec(t)
    if (m === null) return null
    const minutos = BigInt(m[2] ?? '0')
    if (minutos >= escala.porUnidade) return null
    return BigInt(m[1] ?? '0') * escala.porUnidade + minutos
  }
  // Centavos e centésimos têm a mesma forma de texto: duas casas depois da vírgula.
  const limpo = t.replace(/^R\$\s*/i, '').replace(/%$/, '').trim()
  return centavosDoTextoBrasileiro(limpo)
}

/**
 * A menor unidade → o texto do campo, para reabrir um valor que já existe.
 * Fora de horas, toda escala é de duas casas (`ESCALA_DA_UNIDADE`), e o texto
 * é o mesmo do campo de dinheiro: `textoDeCentavos`.
 */
export function textoDaMenorUnidade(unidade: UnidadeDeKpi, v: bigint): string {
  const escala = ESCALA_DA_UNIDADE[unidade]
  if (escala.menorUnidade !== 'minutos') return textoDeCentavos(v)
  const neg = v < 0n ? '-' : ''
  const a = abs(v)
  return `${neg}${a / escala.porUnidade}:${(a % escala.porUnidade).toString().padStart(2, '0')}`
}

/** O texto do campo a partir de um `ValorNaTela` — vazio quando a redação apagou o valor. */
export function textoDoCampo(v: ValorNaTela): string {
  const t = v.unidade === 'reais' ? v.emDinheiro : v.emNumero
  return t === null ? '' : textoDaMenorUnidade(v.unidade, BigInt(t))
}

export const ROTULO_DA_UNIDADE: Readonly<Record<UnidadeDeKpi, string>> = {
  reais: 'R$',
  percentual: '%',
  quantidade: 'Quantidade',
  dias: 'Dias',
  nota: 'Nota de 0 a 10',
  horas: 'Horas',
}

/** A dica do campo de valor: como digitar, na unidade do KPI. */
export const EXEMPLO_DA_UNIDADE: Readonly<Record<UnidadeDeKpi, string>> = {
  reais: 'ex.: 120.000,00',
  percentual: 'ex.: 35 ou 35,5',
  quantidade: 'ex.: 30',
  dias: 'ex.: 7',
  nota: 'de 0 a 10, ex.: 9,2',
  horas: 'ex.: 12:30',
}

export const ROTULO_DA_FREQUENCIA: Readonly<Record<FrequenciaDeKpi, string>> = {
  semanal: 'Semanal',
  mensal: 'Mensal',
}

export const DIAS_DA_SEMANA_DO_LANCAMENTO = [
  'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado', 'domingo',
] as const

/**
 * **Despesas fixas sobre o recebido** tem rótulo e dica próprios (números c.5):
 * a Visão do mês mostra fixas ÷ DESPESAS; este KPI é fixas ÷ RECEBIDO, sem
 * outras entradas. Os dois números se parecem e não são o mesmo, e a dica
 * existe para ninguém conferir um contra o outro.
 */
export const DICA_DESPESAS_FIXAS_SOBRE_RECEBIDO =
  'Despesas fixas divididas pelo recebido no mês, sem contar as outras entradas. Não é a mesma conta da Visão do mês, que divide as fixas pelo total de despesas.'

export function dicaDoKpi(chave: KpiNaLista['chave']): string | null {
  return chave === 'despesas_fixas_sobre_recebido' ? DICA_DESPESAS_FIXAS_SOBRE_RECEBIDO : null
}

/** O aviso do nome do KPI manual (LGPD L-IN-18): o nome atravessa para os números agregados. */
export const AVISO_DO_NOME_DO_KPI = 'Não use nome de pessoa nem de paciente.'

// ---------------------------------------------------------------------------
// Lançamento do KPI manual (C.1, D.4 e H)
// ---------------------------------------------------------------------------

/**
 * O que a janela D.4 precisa para abrir — das DUAS portas: o cartão do KPI
 * (quem tem `indicadores`) e a tarefa "Lançar [KPI]" em Hoje (a responsável
 * que pode não ter: appsec C2, os dados chegam pela própria tarefa).
 *
 * `semanal` é `null` quando vem da tarefa: ela não diz a frequência, e a
 * referência que ela traz é o primeiro dia do período — a janela a mostra
 * como data, sem adivinhar se é semana ou mês. `comoMedir` é `null` quando
 * ainda tem de ser lido do detalhe do KPI.
 */
export type AlvoDoLancamento = {
  readonly kpiId: string
  readonly nome: string
  readonly unidade: UnidadeDeKpi
  readonly semanal: boolean | null
  readonly referencia: string
  readonly comoMedir: string | null
}

export const alvoDoKpi = (k: Pick<KpiNaLista, 'id' | 'nome' | 'unidade' | 'frequencia' | 'periodo'>): AlvoDoLancamento => ({
  kpiId: k.id,
  nome: k.nome,
  unidade: k.unidade,
  semanal: k.frequencia === 'semanal',
  referencia: k.periodo.de,
  comoMedir: null,
})

export const alvoDaTarefa = (l: LancamentoDeKpiNaTarefa): AlvoDoLancamento => ({
  kpiId: l.kpiId,
  nome: l.nome,
  unidade: l.unidade,
  semanal: null,
  referencia: l.referencia,
  comoMedir: l.comoMedir,
})

/** O recado depois de lançar: diz também que a tarefa de Hoje saiu, quando saiu. */
export const recadoDoLancamento = (r: Pick<LancamentoDeKpiNaSaida, 'tarefaConcluidaId'>): string =>
  r.tarefaConcluidaId === null ? 'Valor lançado.' : 'Valor lançado. A tarefa de lançamento foi concluída.'

/**
 * A faixa amarela do cartão (C.1): "Lançamento da semana pendente". Quem
 * decide se está pendente é o servidor (`lancamentoPendente`: o período
 * corrente sem lançamento, com o dia de lançar já chegado); a tela só escolhe
 * a palavra pela frequência.
 */
export function faixaDeLancamento(k: Pick<KpiNaLista, 'origem' | 'frequencia' | 'lancamentoPendente'>): string | null {
  if (k.origem !== 'manual' || k.lancamentoPendente !== true) return null
  return k.frequencia === 'semanal' ? 'Lançamento da semana pendente' : 'Lançamento do mês pendente'
}

/**
 * O selo da fonte (C.1): "automático" ou "lançado por Juliana em 14/11". O
 * dia é o do instante do lançamento no FUSO DA CLÍNICA (regra 22) — nunca o
 * do aparelho. Sem lançamento ainda, diz isso.
 */
export function fonteDoKpi(k: Pick<KpiNaLista, 'origem' | 'ultimoLancamento'>, fuso: string): string {
  if (k.origem === 'catalogo') return 'automático'
  const u = k.ultimoLancamento ?? null
  if (u === null) return 'ainda sem lançamento'
  const instante = new Date(u.lancadoEm)
  const dia = Number.isNaN(instante.getTime()) ? null : diaEMes(diaCivil(instante, fuso))
  const quem = u.autor === null ? null : (u.autor.trim().split(/\s+/)[0] ?? u.autor)
  return `lançado${quem === null ? '' : ` por ${quem}`}${dia === null ? '' : ` em ${dia}`}`
}

// ---------------------------------------------------------------------------
// Unidade (filtro da linha 3, backlog 1.9 B)
// ---------------------------------------------------------------------------

/**
 * As unidades que o filtro oferece: as ATIVAS da clínica, e só quando são mais
 * de uma — numa clínica de um endereço, o filtro não aparece (1.9 B).
 */
export function unidadesDoFiltro(unidades: readonly { id: string; nome: string; ativa: boolean }[] | null | undefined): { id: string; nome: string }[] {
  const ativas = (unidades ?? []).filter((u) => u.ativa).map((u) => ({ id: u.id, nome: u.nome }))
  return ativas.length > 1 ? ativas : []
}

/** Com o filtro Unidade, o KPI que não se divide por ela diz isso (o número é o da clínica). */
export const avisoDeUnidade = (k: Pick<KpiNaLista, 'naoSeDividePorUnidade'>): string | null =>
  k.naoSeDividePorUnidade === true ? 'Não se divide por unidade: número da clínica inteira' : null

// ---------------------------------------------------------------------------
// Período (filtro da linha 3 e OKR)
// ---------------------------------------------------------------------------

export type Trimestre = { readonly inicio: string; readonly fim: string; readonly rotulo: string }

const rotuloDoTrimestre = (inicio: string): string =>
  `${Math.floor((Number(inicio.slice(5, 7)) - 1) / 3) + 1}º trimestre de ${inicio.slice(0, 4)}`

/** O trimestre de `hoje` (do servidor) e os `n` anteriores — o filtro não oferece trimestre futuro. */
export function trimestresAte(hoje: string, n = 4): Trimestre[] {
  const lista: Trimestre[] = []
  let dia = hoje
  for (let i = 0; i < n; i++) {
    const t = trimestreDe(dia)
    lista.push({ inicio: t.inicio, fim: t.fim, rotulo: rotuloDoTrimestre(t.inicio) })
    dia = somarMeses(t.inicio, -3)
  }
  return lista
}

/** Os trimestres que um OKR novo pode escolher: o atual e os três seguintes. */
export function trimestresDesde(hoje: string, n = 4): Trimestre[] {
  const lista: Trimestre[] = []
  let dia = trimestreDe(hoje).inicio
  for (let i = 0; i < n; i++) {
    const t = trimestreDe(dia)
    lista.push({ inicio: t.inicio, fim: t.fim, rotulo: rotuloDoTrimestre(t.inicio) })
    dia = somarMeses(t.inicio, 3)
  }
  return lista
}

/** O OKR aparece no trimestre filtrado quando os dois períodos se tocam (datas civis inclusivas). */
export const okrNoPeriodo = (o: Pick<OkrNaSaida, 'periodo'>, t: Pick<Trimestre, 'inicio' | 'fim'>): boolean =>
  o.periodo.inicio <= t.fim && o.periodo.fim >= t.inicio
